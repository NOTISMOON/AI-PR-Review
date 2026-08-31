import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { setGitHubToken, clearGitHubToken, fetchFileContent } from "@/lib/github";
import * as gitee from "@/lib/gitee/client";
import {
  collectQuickContext,
  collectStandardContext,
  collectDeepContext,
} from "@/lib/context";
import { collectGiteeContext } from "@/lib/gitee/review-context";
import { buildRoutingContext, routeModel } from "@/lib/models/router";
import { getProviderForModel } from "@/lib/models/provider-factory";
import type { ModelConfig, ModelAnalysisResult } from "@/lib/models/types";
import { parseAIResponse } from "@/app/api/analyze/helpers/json-parser";
import { buildCacheKey } from "@/app/api/analyze/helpers/diff-utils";
import { buildContextSnapshot } from "@/app/api/analyze/helpers/context-snapshot";
import { buildResponse, normalizeAnalysisData } from "@/app/api/analyze/helpers/data-normalizer";
import {
  ensureNotificationTables,
  ensureReviewTables,
  insertNotification,
  replaceReviewIssues,
  upsertReviewJob,
} from "@/lib/db/mysql";
import { redisPublish, NOTIFY_CHANNEL, cacheDel, cacheDelPattern } from "@/lib/cache/redis";
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
  DependencyEdge,
  DependencyGraph,
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
  /** 风险阈值：宽松 | 默认 | 严格（影响严重级别判定） */
  riskThreshold: Annotation<string>,
  /** 采样温度（全局设置，默认 0.1） */
  temperature: Annotation<number>,
  /** 单次最大评论数（全局设置，默认 10） */
  maxComments: Annotation<number>,
  /** 仅审查变更行（diff_only） */
  diffOnly: Annotation<boolean>,
  /** 设置提交状态检查（set_status，仅 GitHub） */
  writeStatus: Annotation<boolean>,

  // buildGraph 产出（AI 依赖图，按深度决定是否跳过）
  dependencyGraph: Annotation<DependencyGraph | null>,

  // prepare 产出
  collected: Annotation<CollectedContext | null>,
  model: Annotation<ModelConfig | null>,
  modelProviderName: Annotation<string | null>,
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

async function collectByDepth(
  owner: string,
  repo: string,
  prNumber: number,
  depth: ReviewDepth,
  platform: "github" | "gitee",
  token: string | null,
) {
  // Gitee：用 Gitee API 收集（PR 详情 + files patch.diff）
  if (platform === "gitee") {
    return collectGiteeContext(token!, owner, repo, prNumber);
  }
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
    const collected = await collectByDepth(state.owner, state.repo, state.prNumber, state.depth, state.platform, state.token);
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

    return {
      collected,
      model,
      modelProviderName: model.provider,
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
        temperature: state.temperature ?? 0.1,
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

// ── 节点：AI 依赖图（按深度由条件边决定是否跳过；fast 不执行）──
async function buildGraph(state: StateT): Promise<Partial<StateT>> {
  const collected = state.collected;
  if (!collected || !state.model || !state.token) return {};
  try {
    // 抓取变更文件 import/require 区域（文件头前 80 行），供 AI 分析依赖关系
    const files = collected.fileChanges.slice(0, 15).map((f) => f.file);
    const heads: Record<string, string> = {};
    for (const file of files) {
      const head = await fetchFileHead(state, file);
      if (head) heads[file] = head;
    }
    if (!Object.keys(heads).length) return { dependencyGraph: null };

    const graph = await analyzeDependenciesWithAI(getProviderForModel(state.model), state, heads);
    if (!graph) return { dependencyGraph: null };
    // 同步更新 collected，供 contextSnapshot / generate 使用
    return { dependencyGraph: graph, collected: { ...collected, dependencyGraph: graph } };
  } catch (e) {
    console.warn("[review] AI 依赖图分析失败（降级）:", (e as Error).message);
    return { dependencyGraph: null };
  }
}

/** 抓取某文件头部（import 区域）用于依赖分析；失败返回空串 */
async function fetchFileHead(state: StateT, file: string, limit = 80): Promise<string> {
  try {
    const ref = state.collected?.prInfo.headSha || state.collected?.prInfo.baseBranch || "HEAD";
    if (state.platform === "gitee") {
      const res = await gitee.getContents(state.token!, state.owner, state.repo, file, ref);
      const entry = res as any;
      if (entry && !Array.isArray(entry) && (entry.content || entry.base64Content)) {
        const decoded = Buffer.from(String(entry.content || entry.base64Content), "base64").toString("utf-8");
        return decoded.split("\n").slice(0, limit).join("\n");
      }
      return "";
    }
    const content = await fetchFileContent(state.owner, state.repo, file, ref);
    return content ? content.split("\n").slice(0, limit).join("\n") : "";
  } catch {
    return "";
  }
}

/** 用 AI 分析依赖关系，输出结构化 DependencyGraph */
async function analyzeDependenciesWithAI(
  provider: ReturnType<typeof getProviderForModel>,
  state: StateT,
  heads: Record<string, string>,
): Promise<DependencyGraph | null> {
  const systemPrompt =
    "你是代码依赖分析器。分析给定文件的 import/require/use/from 等导入语句，输出代码依赖关系。只输出 JSON（不要 markdown 代码块）：" +
    '{"edges":[{"from":"文件名","to":"被依赖文件","type":"import"}],"externalDependents":["可能引用这些文件的其他文件"]}。' +
    "规则：edges 的 from 必须是给定的变更文件之一（表示 from 依赖 to）；type 取值 import|require|dynamic-import；externalDependents 依据导入语义推断可能受影响但未列出的文件，无法确定时给空数组。";
  const userMessage =
    "本次 PR 变更文件的文件头（import/require 区域，前 80 行）：\n" +
    Object.entries(heads)
      .map(([f, c]) => `### ${f}\n${c}`)
      .join("\n\n");
  try {
    const result = await provider.analyze({
      systemPrompt,
      userMessage,
      temperature: 0,
      maxTokens: 1024,
    });
    const raw = parseAIResponse(result.content) as {
      edges?: { from?: string; to?: string; type?: string }[];
      externalDependents?: string[];
    };
    const edges: DependencyEdge[] = (Array.isArray(raw?.edges) ? raw.edges : [])
      .filter((e) => e && typeof e.from === "string" && typeof e.to === "string")
      .slice(0, 60)
      .map((e) => ({
        from: e.from!,
        to: e.to!,
        type: (["import", "require", "dynamic-import"].includes(e.type ?? "")
          ? e.type
          : "import") as DependencyEdge["type"],
      }));
    const externalDependents = Array.isArray(raw?.externalDependents)
      ? raw.externalDependents.filter((x): x is string => typeof x === "string").slice(0, 20)
      : [];
    return { edges, externalDependents };
  } catch (e) {
    console.warn("[review] AI 依赖图调用失败:", (e as Error).message);
    return null;
  }
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

  let risks = applyRiskThreshold(normalizeRisks(all), state.riskThreshold);
  // 仅审查变更行：只保留行号确实落在 diff 变更行集合内的问题（与审查深度正交，深度决定上下文）
  if (state.diffOnly) {
    const changedLines = buildChangedLines(state.collected?.diff ?? "");
    if (changedLines.size > 0) {
      risks = risks.filter((r) => r.file && r.line > 0 && changedLines.get(r.file)?.has(r.line));
    } else {
      // diff 无法解析（如 Gitee 拼接的片段）时回退：仅保留能定位到文件/行的风险
      risks = risks.filter((r) => r.file && r.line > 0);
    }
  }
  const riskLevel = computeRiskLevel(risks);
  const maxComments = state.maxComments || 10;

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
    ...risks.slice(0, maxComments).map((r, i) => ({
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
      analyzedAt: new Date().toISOString(),
      cacheHit: false,
      prUrl: `${state.platform === "gitee" ? "https://gitee.com" : "https://github.com"}/${state.owner}/${state.repo}/pull/${state.prNumber}`,
      depth: state.depth,
      contextSnapshot: buildContextSnapshot(collected, state.diffTruncated),
    },
  );

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

      // 审查结果已落库，主动失效该用户相关缓存（dashboard/repos/pulls/contributions），
      // 消除"外部变更但要等 TTL/手动同步才可见"问题；失败仅降级不影响审查结果与落库
      try {
        await cacheDel(`${state.platform}:dashboard:${state.userId}`);
        await cacheDel(`${state.platform}:repos:${state.userId}`);
        await cacheDelPattern(`${state.platform}:pulls:${state.userId}:*`);
        await cacheDelPattern(`${state.platform}:contributions:${state.userId}:*`);
      } catch (e) {
        console.warn("[review] 缓存主动失效失败（降级）:", (e as Error).message);
      }

      // 通知：审查完成（待用户处理）
      try {
        await ensureNotificationTables();
        const notiTitle = `PR #${state.prNumber} 审查完成 · ${state.riskLevel} · ${state.risks.length} 个问题`;
        const inserted = await insertNotification({
          userId: state.userId,
          type: "review_completed",
          title: notiTitle,
          body: `${state.owner}/${state.repo} · ${collected.prInfo.title.slice(0, 120)}`,
          link: "/review",
          bizType: "review_job",
          bizId: String(jobId),
          platform: state.platform,
        });
        // 仅当真正新增通知时才实时广播，避免重复事件导致的重复通知/重复推送
        if (inserted) {
          await redisPublish(NOTIFY_CHANNEL, {
            userId: state.userId,
            type: "review_completed",
            title: notiTitle,
            link: "/review",
          });
        }
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

  // 可选：设置提交状态检查（set_status，仅 GitHub）
  if (state.writeStatus && state.token && state.platform === "github" && collected.prInfo.headSha) {
    try {
      const statusState =
        state.riskLevel === "high" ? "failure" : state.riskLevel === "medium" ? "pending" : "success";
      await fetch(
        `https://api.github.com/repos/${state.owner}/${state.repo}/statuses/${collected.prInfo.headSha}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${state.token}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "ai-pr-review/1.0",
          },
          body: JSON.stringify({
            state: statusState,
            context: "AI PR Review",
            description: `${state.riskLevel} · ${state.risks.length} 个问题`,
          }),
        },
      );
    } catch (e) {
      console.warn("[review] 设置提交状态失败:", (e as Error).message);
    }
  }

  return { result: response, latencyMs, writtenReview };
}

async function writeGithubReview(state: StateT, response: AnalysisResponse): Promise<boolean> {
  const comments = response.risks
    .filter((r) => r.file && r.line > 0)
    .slice(0, state.maxComments || 10)
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

/**
 * 解析 diff，构建「文件 → 变更行号集合」。
 * 变更行 = 新文件中被新增/修改的行（`+` 开头，含 hunk 头 `@@ -a,b +c,d @@` 定位行号）。
 * 无法解析（如非标准 diff）时该文件不加入集合。
 */
function buildChangedLines(diff: string): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  let curFile: string | null = null;
  let newLine = 0;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    const line = raw;
    if (line.startsWith("diff --git ")) {
      const m = line.match(/diff --git a\/(.+?) b\//);
      curFile = m ? m[1] : null;
      if (curFile) map.set(curFile, new Set());
      inHunk = false;
      continue;
    }
    if (!inHunk || !curFile) {
      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        newLine = Number(hunk[2]);
        inHunk = true;
      }
      continue;
    }
    if (line.startsWith("+")) {
      if (!line.startsWith("+++")) map.get(curFile)!.add(newLine);
      newLine += 1;
    } else if (!line.startsWith("-")) {
      newLine += 1;
    }
  }
  return map;
}

/**
 * 应用风险阈值（全局设置「宽松 / 默认 / 严格」）：
 * - 宽松：medium 降为 low（只把 high/critical 视为风险，更宽容）
 * - 严格：low 升为 medium、medium 升为 high（更严格）
 * - 默认：保持模型原判定
 */
function applyRiskThreshold(risks: Risk[], threshold: string): Risk[] {
  if (threshold === "宽松") {
    return risks.map((r) => (r.severity === "medium" ? { ...r, severity: "low" as const } : r));
  }
  if (threshold === "严格") {
    return risks.map((r) =>
      r.severity === "low"
        ? { ...r, severity: "medium" as const }
        : r.severity === "medium"
          ? { ...r, severity: "high" as const }
          : r,
    );
  }
  return risks;
}

// ── 图 ──
const graph = new StateGraph(ReviewState)
  .addNode("prepare", prepare)
  .addNode("build_graph", buildGraph)
  .addNode("bug", dimensionNode("bug"))
  .addNode("security", dimensionNode("security"))
  .addNode("performance", dimensionNode("performance"))
  .addNode("quality", dimensionNode("quality"))
  .addNode("merge", merge)
  .addNode("validate", validate)
  .addNode("generate", generate)
  .addEdge(START, "prepare")
  // 按审查深度决定是否执行依赖图 AI 分析节点：fast 跳过（直接并行维度），standard/deep 先构建依赖图
  .addConditionalEdges("prepare", (state) =>
    state.depth === "fast"
      ? ["bug", "security", "performance", "quality"]
      : ["build_graph"],
  )
  .addEdge("build_graph", "bug")
  .addEdge("build_graph", "security")
  .addEdge("build_graph", "performance")
  .addEdge("build_graph", "quality")
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
  /** 风险阈值：宽松 | 默认 | 严格（默认「默认」） */
  riskThreshold?: string | null;
  /** 采样温度（默认 0.1） */
  temperature?: number;
  /** 单次最大评论数（默认 10） */
  maxComments?: number;
  /** 仅审查变更行（默认关闭） */
  diffOnly?: boolean;
  /** 设置提交状态检查（默认关闭） */
  writeStatus?: boolean;
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
    riskThreshold: input.riskThreshold ?? "默认",
    temperature: input.temperature ?? 0.1,
    maxComments: input.maxComments ?? 10,
    diffOnly: input.diffOnly ?? false,
    writeStatus: input.writeStatus ?? false,
    collected: null,
    model: null,
    modelProviderName: null,
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

/** 供 webhook / 定时任务使用的兜底：捕获异常返回错误，不中断 */
export async function runReviewSafe(input: RunReviewInput): Promise<RunReviewResult> {
  try {
    return await runReview(input);
  } catch (e) {
    return { response: null, error: (e as Error).message, writtenReview: false };
  }
}
