import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { setGitHubToken, clearGitHubToken } from "@/lib/github";
import {
  collectQuickContext,
  collectStandardContext,
  collectDeepContext,
} from "@/lib/context";
import { buildRoutingContext, routeModel } from "@/lib/models/router";
import { getProviderForModel } from "@/lib/models/provider-factory";
import type { ModelConfig, ModelAnalysisResult } from "@/lib/models/types";
import { parseAIResponse } from "@/app/api/analyze/helpers/json-parser";
import { buildCacheKey } from "@/app/api/analyze/helpers/diff-utils";
import { buildContextSnapshot } from "@/app/api/analyze/helpers/context-snapshot";
import { buildResponse, normalizeAnalysisData } from "@/app/api/analyze/helpers/data-normalizer";
import { startAnalysisRun, completeAnalysisRun, failAnalysisRun } from "@/lib/analysis-store";
import {
  ensureNotificationTables,
  ensureReviewTables,
  insertNotification,
  replaceReviewIssues,
  upsertReviewJob,
} from "@/lib/db/mysql";
import {
  DIMENSIONS,
  DIMENSION_META,
  buildDimensionSystemPrompt,
  buildDimensionUserMessage,
  prepareDiff,
  type ReviewDimension,
} from "./prompts";
import type {
  AnalysisResponse,
  CollectedContext,
  FileChange,
  ReviewComment,
  Risk,
} from "@/types/analysis";

/**
 * LangGraph 审查编排：
 * PR → prepare(准备上下文/选模型) → [bug|security|performance|quality 并行] → merge(汇总) → validate(验证) → generate(生成 GitHub Review/落库)
 */

export type ReviewDepth = "fast" | "standard" | "deep";

interface RawFinding {
  severity?: string;
  title?: string;
  description?: string;
  file?: string;
  line?: number;
  code?: string;
  suggestion?: string;
  confidence?: string;
  category?: string;
}

interface DimensionResult {
  summary: string;
  findings: RawFinding[];
  usage?: { inputTokens: number; outputTokens: number };
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const CONFIDENCES = ["high", "medium", "low"] as const;

// ── State ──
const ReviewState = Annotation.Root({
  // 输入
  owner: Annotation<string>,
  repo: Annotation<string>,
  prNumber: Annotation<number>,
  depth: Annotation<ReviewDepth>,
  token: Annotation<string | null>,
  writeReview: Annotation<boolean>,
  /** 当前登录用户（MySQL user.id），用于持久化审查结果供用户处理 */
  userId: Annotation<number | null>,
  platform: Annotation<"github" | "gitee">,
  /** 用户偏好的模型（来自全局设置，空则自动选择） */
  preferredModel: Annotation<string | null>,

  // prepare 产出
  collected: Annotation<CollectedContext | null>,
  model: Annotation<ModelConfig | null>,
  modelProviderName: Annotation<string | null>,
  runId: Annotation<string | null>,
  startedAt: Annotation<number | null>,
  diffTruncated: Annotation<boolean>,

  // 并行维度结果（各节点写入不同 key，用 reducer 合并）
  dimensionResults: Annotation<Record<string, DimensionResult>>({
    reducer: (current, update) => ({ ...(current || {}), ...(update || {}) }),
    default: () => ({}),
  }),

  // merge / validate 产出
  summary: Annotation<string>,
  riskLevel: Annotation<"low" | "medium" | "high">,
  risks: Annotation<Risk[]>,
  reviewComments: Annotation<ReviewComment[]>,
  fileChanges: Annotation<FileChange[]>,
  tokenUsage: Annotation<{ inputTokens: number; outputTokens: number } | null>,
  latencyMs: Annotation<number | null>,

  // generate 产出
  result: Annotation<AnalysisResponse | null>,
  writtenReview: Annotation<boolean>,
  error: Annotation<string | null>,
});

type StateT = typeof ReviewState.State;

function collectByDepth(owner: string, repo: string, prNumber: number, depth: ReviewDepth) {
  switch (depth) {
    case "fast":
      return collectQuickContext(owner, repo, prNumber);
    case "deep":
      return collectDeepContext(owner, repo, prNumber);
    default:
      return collectStandardContext(owner, repo, prNumber);
  }
}

// ── 节点：准备上下文 + 选模型 + 落库 ──
async function prepare(state: StateT): Promise<Partial<StateT>> {
  const startedAt = Date.now();
  setGitHubToken(state.token ?? undefined);
  try {
    const collected = await collectByDepth(state.owner, state.repo, state.prNumber, state.depth);
    const { diffTruncated } = prepareDiff(collected);

    const routingCtx = buildRoutingContext({
      fileCount: collected.fileChanges.length,
      fileList: collected.fileChanges.map((f) => f.file),
      diffSize: collected.diff.length,
      preferredTier:
        state.depth === "fast" ? "fast" : state.depth === "deep" ? "thorough" : "balanced",
      preferredModel: state.preferredModel ?? undefined,
    });
    const decision = routeModel(routingCtx);
    const model = decision.model;

    let runId: string | null = null;
    try {
      const cacheKey = buildCacheKey(state.owner, state.repo, state.prNumber, collected.prInfo.headSha, state.depth);
      const run = await startAnalysisRun({
        owner: state.owner,
        repo: state.repo,
        defaultBranch: collected.prInfo.baseBranch,
        cacheKey,
        depth: state.depth,
        collected,
      });
      runId = run?.id ?? null;
    } catch (e) {
      console.warn("[review] startAnalysisRun failed (落库降级):", (e as Error).message);
    }

    return {
      collected,
      model,
      modelProviderName: model.provider,
      runId,
      startedAt,
      diffTruncated,
      fileChanges: collected.fileChanges,
      error: null,
    };
  } catch (e) {
    return {
      error: `上下文准备失败: ${(e as Error).message}`,
      startedAt,
    };
  } finally {
    clearGitHubToken();
  }
}

// ── 节点：维度并行分析（工厂生成四个节点） ──
function dimensionNode(dim: ReviewDimension) {
  return async (state: StateT): Promise<Partial<StateT>> => {
    const empty: DimensionResult = { summary: `${DIMENSION_META[dim].label}：分析失败`, findings: [] };
    if (!state.collected || !state.model) {
      return { dimensionResults: { [dim]: empty } };
    }
    const provider = getProviderForModel(state.model);
    const { effectiveDiff } = prepareDiff(state.collected);
    try {
      const result: ModelAnalysisResult = await provider.analyze({
        systemPrompt: buildDimensionSystemPrompt(dim, state.depth),
        userMessage: buildDimensionUserMessage(dim, state.collected, effectiveDiff),
        temperature: 0.1,
        maxTokens: 2048,
      });
      const raw = parseAIResponse(result.content) as {
        summary?: string;
        findings?: RawFinding[];
      };
      const findings = Array.isArray(raw?.findings)
        ? raw.findings.filter((f) => f && typeof f === "object")
        : [];
      return {
        dimensionResults: {
          [dim]: {
            summary: typeof raw?.summary === "string" ? raw.summary : "",
            findings,
            usage: result.usage,
          },
        },
      };
    } catch (e) {
      console.warn(`[review] 维度 ${dim} 分析失败:`, (e as Error).message);
      return { dimensionResults: { [dim]: empty } };
    }
  };
}

// ── 节点：汇总合并 ──
async function merge(state: StateT): Promise<Partial<StateT>> {
  const all: RawFinding[] = [];
  const summaries: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const dim of DIMENSIONS) {
    const r = state.dimensionResults?.[dim];
    if (!r) continue;
    all.push(...(r.findings || []));
    if (r.summary) summaries.push(`${DIMENSION_META[dim].label}：${r.summary}`);
    inputTokens += r.usage?.inputTokens ?? 0;
    outputTokens += r.usage?.outputTokens ?? 0;
  }

  const risks = normalizeRisks(all);
  const riskLevel = computeRiskLevel(risks);

  // 审查评论：把高危问题转为 concern 评论 + 一条整体正面总结
  const reviewComments: ReviewComment[] = [
    {
      id: "comment-overview",
      type: "positive",
      comment:
        summaries.length
          ? `AI 审查概览：\n${summaries.map((s) => `- ${s}`).join("\n")}`
          : "AI 审查完成，未发现明显问题。",
    },
    ...risks.slice(0, 10).map((r, i) => ({
      id: `comment-${i + 1}`,
      type: "concern" as const,
      comment: `${r.title}${r.file ? `（${r.file}${r.line ? `:${r.line}` : ""}）` : ""}\n${r.description}${r.suggestion ? `\n建议：${r.suggestion}` : ""}`,
    })),
  ];

  return {
    risks,
    riskLevel,
    reviewComments,
    tokenUsage:
      inputTokens > 0 || outputTokens > 0 ? { inputTokens, outputTokens } : null,
    summary: summaries.join("\n"),
  };
}

// ── 节点：验证 / 规范化 ──
async function validate(state: StateT): Promise<Partial<StateT>> {
  const risks = state.risks
    .filter((r) => r && r.title)
    .map((r, i) => ({ ...r, id: r.id || `risk-${i + 1}` }))
    .slice(0, 50);
  const riskLevel = computeRiskLevel(risks);
  const summary = state.summary || "AI 审查完成，未发现明显问题。";
  return { risks, riskLevel, summary };
}

// ── 节点：生成最终结果 + 落库 + 回写 GitHub Review ──
async function generate(state: StateT): Promise<Partial<StateT>> {
  const latencyMs = Date.now() - (state.startedAt ?? Date.now());
  const collected = state.collected!;
  const model = state.model!;

  const response = buildResponse(
    normalizeAnalysisData(
      {
        summary: state.summary,
        riskLevel: state.riskLevel,
        risks: state.risks,
        reviewComments: state.reviewComments,
      },
      collected,
      model.modelId,
      state.modelProviderName || model.provider,
      latencyMs,
      state.tokenUsage ?? undefined,
    ),
    {
      analysisRunId: state.runId ?? undefined,
      analyzedAt: new Date().toISOString(),
      cacheHit: false,
      prUrl: `https://github.com/${state.owner}/${state.repo}/pull/${state.prNumber}`,
      depth: state.depth,
      contextSnapshot: buildContextSnapshot(collected, state.diffTruncated),
    },
  );

  // 落库（失败不阻塞返回）
  if (state.runId) {
    try {
      await completeAnalysisRun({
        analysisRunId: state.runId,
        data: response,
        contextSnapshot: response.contextSnapshot!,
      });
    } catch (e) {
      console.warn("[review] completeAnalysisRun failed (落库降级):", (e as Error).message);
    }
  }

  // 持久化到 MySQL（供「审查处理中心」展示与用户决策：批准/评论/采纳/拒绝）
  if (state.userId) {
    try {
      await ensureReviewTables();
      const repoFullName = `${state.owner}/${state.repo}`;
      const jobId = await upsertReviewJob({
        userId: state.userId,
        platform: state.platform,
        prNumber: state.prNumber,
        repoFullName,
        prTitle: collected.prInfo.title,
        commitSha: collected.prInfo.headSha,
        triggerSource: "webhook",
        provider: state.modelProviderName || model.provider,
        model: model.modelId,
        depth: state.depth,
        status: "COMPLETED",
        summary: state.summary,
        riskLevel: state.riskLevel,
        riskCount: state.risks.length,
        suggestionCount: state.reviewComments.filter((c) => c.type !== "positive").length,
        positiveCount: state.reviewComments.filter((c) => c.type === "positive").length,
        latencyMs,
        inputTokens: state.tokenUsage?.inputTokens ?? null,
        outputTokens: state.tokenUsage?.outputTokens ?? null,
        resultJson: {
          risks: state.risks,
          reviewComments: state.reviewComments,
          fileChanges: response.fileChanges,
        },
        completedAt: new Date(),
      });
      if (jobId) {
        await replaceReviewIssues(
          jobId,
          state.userId,
          state.prNumber,
          repoFullName,
          [
            ...state.risks.map((r) => ({
              kind: "RISK" as const,
              severity: r.severity.toUpperCase(),
              title: r.title,
              description: r.description,
              file: r.file || null,
              line: r.line || null,
              code: r.code,
              suggestion: r.suggestion,
              confidence: r.confidence,
              category: r.category,
            })),
            ...state.reviewComments
              .filter((c) => c.type !== "positive")
              .map((c) => ({
                kind: "SUGGESTION" as const,
                title: c.comment.slice(0, 200),
                description: c.comment,
              })),
            ...state.reviewComments
              .filter((c) => c.type === "positive")
              .map((c) => ({ kind: "POSITIVE" as const, title: "正面总结", description: c.comment })),
          ],
        );
      }

      // 通知：审查完成（待用户处理）
      try {
        await ensureNotificationTables();
        await insertNotification({
          userId: state.userId,
          type: "review_completed",
          title: `PR #${state.prNumber} 审查完成 · ${state.riskLevel} · ${state.risks.length} 个问题`,
          body: `${state.owner}/${state.repo} · ${collected.prInfo.title.slice(0, 120)}`,
          link: "/review",
          bizType: "review_job",
          bizId: String(jobId),
        });
      } catch (e) {
        console.warn("[review] 写入通知失败（降级）:", (e as Error).message);
      }
    } catch (e) {
      console.warn("[review] MySQL 落库失败（降级）:", (e as Error).message);
    }
  }

  // 可选：回写 GitHub Review
  let writtenReview = false;
  if (state.writeReview && state.token) {
    try {
      writtenReview = await writeGithubReview(state, response);
    } catch (e) {
      console.warn("[review] 回写 GitHub Review 失败:", (e as Error).message);
    }
  }

  return { result: response, latencyMs, writtenReview };
}

async function writeGithubReview(state: StateT, response: AnalysisResponse): Promise<boolean> {
  const comments = response.risks
    .filter((r) => r.file && r.line > 0)
    .slice(0, 10)
    .map((r) => ({
      path: r.file,
      line: r.line,
      side: "RIGHT" as const,
      body: `${r.title}\n\n${r.description}${r.suggestion ? `\n\n**建议**：${r.suggestion}` : ""}`,
    }));

  const body = `${response.summary}\n\n---\n**AI 自动审查** · 检出 ${response.risks.length} 个风险（${response.riskLevel}）`;

  const res = await fetch(
    `https://api.github.com/repos/${state.owner}/${state.repo}/pulls/${state.prNumber}/reviews`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "ai-pr-review/1.0",
      },
      body: JSON.stringify({
        body,
        event: "COMMENT",
        comments,
      }),
    },
  );
  return res.ok;
}

// ── 辅助 ──
function normalizeRisks(findings: RawFinding[]): Risk[] {
  const seen = new Set<string>();
  const risks: Risk[] = [];
  let index = 0;
  for (const f of findings) {
    if (!f || typeof f !== "object") continue;
    const title = typeof f.title === "string" ? f.title.trim() : "";
    if (!title) continue;
    const file = typeof f.file === "string" ? f.file : "";
    const line = typeof f.line === "number" && f.line > 0 ? Math.floor(f.line) : 0;
    const key = `${file}:${line}:${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    index += 1;
    risks.push({
      id: `risk-${index}`,
      severity: (SEVERITIES.includes(f.severity as never)
        ? (f.severity as Risk["severity"])
        : "medium") as Risk["severity"],
      title,
      description: typeof f.description === "string" ? f.description : "",
      file,
      line,
      code: typeof f.code === "string" ? f.code : "",
      suggestion: typeof f.suggestion === "string" ? f.suggestion : "",
      confidence: (CONFIDENCES.includes(f.confidence as never)
        ? (f.confidence as Risk["confidence"])
        : "medium") as Risk["confidence"],
      confidenceRationale: undefined,
      category: typeof f.category === "string" ? (f.category as Risk["category"]) : undefined,
    });
  }
  return risks;
}

function computeRiskLevel(risks: Risk[]): "low" | "medium" | "high" {
  if (risks.some((r) => r.severity === "critical" || r.severity === "high")) return "high";
  if (risks.some((r) => r.severity === "medium")) return "medium";
  return "low";
}

// ── 图 ──
const graph = new StateGraph(ReviewState)
  .addNode("prepare", prepare)
  .addNode("bug", dimensionNode("bug"))
  .addNode("security", dimensionNode("security"))
  .addNode("performance", dimensionNode("performance"))
  .addNode("quality", dimensionNode("quality"))
  .addNode("merge", merge)
  .addNode("validate", validate)
  .addNode("generate", generate)
  .addEdge(START, "prepare")
  .addEdge("prepare", "bug")
  .addEdge("prepare", "security")
  .addEdge("prepare", "performance")
  .addEdge("prepare", "quality")
  .addEdge("bug", "merge")
  .addEdge("security", "merge")
  .addEdge("performance", "merge")
  .addEdge("quality", "merge")
  .addEdge("merge", "validate")
  .addEdge("validate", "generate")
  .addEdge("generate", END)
  .compile();

export interface RunReviewInput {
  owner: string;
  repo: string;
  prNumber: number;
  depth?: ReviewDepth;
  token?: string | null;
  writeReview?: boolean;
  /** 当前登录用户（MySQL user.id）——传入则自动审查结果持久化到 MySQL */
  userId?: number | null;
  platform?: "github" | "gitee";
  /** 用户偏好的模型（来自全局设置，空则自动选择） */
  preferredModel?: string | null;
}

export interface RunReviewResult {
  response: AnalysisResponse | null;
  error: string | null;
  writtenReview: boolean;
  riskLevel?: "low" | "medium" | "high";
  risks?: Risk[];
}

/** 运行一次完整的 LangGraph 审查流程 */
export async function runReview(input: RunReviewInput): Promise<RunReviewResult> {
  const result = await graph.invoke({
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    depth: input.depth || "standard",
    token: input.token ?? null,
    writeReview: input.writeReview ?? false,
    userId: input.userId ?? null,
    platform: input.platform ?? "github",
    preferredModel: input.preferredModel ?? null,
    collected: null,
    model: null,
    modelProviderName: null,
    runId: null,
    startedAt: null,
    diffTruncated: false,
    dimensionResults: {},
    summary: "",
    riskLevel: "low",
    risks: [],
    reviewComments: [],
    fileChanges: [],
    tokenUsage: null,
    latencyMs: null,
    result: null,
    writtenReview: false,
    error: null,
  });

  if (result.error) {
    return { response: null, error: result.error, writtenReview: false };
  }
  return {
    response: result.result,
    error: null,
    writtenReview: result.writtenReview,
    riskLevel: result.riskLevel,
    risks: result.risks,
  };
}

/** 供 webhook / 定时任务使用的兜底：失败时标记 AnalysisRun 失败 */
export async function runReviewSafe(input: RunReviewInput, runId?: string | null): Promise<RunReviewResult> {
  try {
    return await runReview(input);
  } catch (e) {
    if (runId) {
      try {
        await failAnalysisRun({ analysisRunId: runId, errorCode: "REVIEW_ERROR", errorMessage: (e as Error).message });
      } catch {
        /* ignore */
      }
    }
    return { response: null, error: (e as Error).message, writtenReview: false };
  }
}
