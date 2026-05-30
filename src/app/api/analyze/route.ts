/**
 * POST /api/analyze — Main analysis endpoint (rewritten).
 *
 * Integrates:
 * - Multi-model routing and provider abstraction
 * - Context collection pipeline (surrounding code, dependencies, commits)
 * - Modular prompt system with CoT and few-shot
 * - Zod validation with consistency checks
 * - Memory caching for GitHub and AI results
 * - SSE streaming support
 */

import { NextRequest, NextResponse } from 'next/server';
import { parsePRUrl } from '@/lib/github';
import { collectStandardContext, collectQuickContext, collectDeepContext } from '@/lib/context';
import { composeSystemPrompt, createPromptConfig } from '@/lib/prompts';
import { buildRoutingContext, routeModel } from '@/lib/models';
import { getProviderForModel } from '@/lib/models';
import { validateAnalysisOutput } from '@/lib/validation/schema';
import { checkConsistency } from '@/lib/validation/consistency';
import { evaluateQuality } from '@/lib/validation/quality';
import { analysisCache } from '@/lib/cache';
import type { AnalyzeRequest, AnalysisData, AnalyzeError, Risk, ReviewComment, SSEEvent, FileChange } from '@/types/analysis';

export const runtime = 'nodejs'; // Needed for streaming support
export const maxDuration = 120; // 2 minutes max for deep analysis (Vercel Pro)

export async function POST(request: NextRequest) {
  try {
    // ─── Parse request ───────────────────────────────────────────
    const body: AnalyzeRequest = await request.json();

    if (!body.prUrl || typeof body.prUrl !== 'string') {
      return errorResponse('请提供有效的 GitHub PR URL', 'INVALID_URL', 400);
    }

    const parsed = parsePRUrl(body.prUrl);
    if (!parsed) {
      return errorResponse(
        'URL 格式不正确，请输入标准的 GitHub PR URL（例如：https://github.com/owner/repo/pull/123）',
        'INVALID_URL', 400,
      );
    }

    const { owner, repo, prNumber } = parsed;
    const depth = body.depth || 'standard';
    const useStreaming = request.headers.get('accept') === 'text/event-stream';

    // ─── Check analysis cache ─────────────────────────────────────
    const cacheKey = `analysis:${owner}:${repo}:${prNumber}:${depth}`;
    const cached = analysisCache.get(cacheKey);
    if (cached && !useStreaming) {
      return NextResponse.json(cached as AnalysisData);
    }

    // ─── Collect context ──────────────────────────────────────────
    let collected;
    switch (depth) {
      case 'fast':
        collected = await collectQuickContext(owner, repo, prNumber);
        break;
      case 'deep':
        collected = await collectDeepContext(owner, repo, prNumber);
        break;
      default:
        collected = await collectStandardContext(owner, repo, prNumber);
    }

    // ─── Route to best model ──────────────────────────────────────
    const routingCtx = buildRoutingContext({
      fileCount: collected.fileChanges.length,
      fileList: collected.fileChanges.map((f: FileChange) => f.file),
      diffSize: collected.diff.length,
      preferredModel: body.preferredModel,
      preferredTier: depth === 'fast' ? 'fast' : depth === 'deep' ? 'thorough' : 'balanced',
      ensembleMode: body.ensembleMode,
    });

    const decision = routeModel(routingCtx);
    const provider = getProviderForModel(decision.model);

    // ─── Compose prompts ──────────────────────────────────────────
    const diffTruncated = collected.diff.length > 240000;
    const effectiveDiff = diffTruncated ? collected.diff.slice(0, 240000) : collected.diff;

    const promptConfig = createPromptConfig(
      depth,
      collected.fileChanges,
      diffTruncated,
    );

    const systemPrompt = composeSystemPrompt(promptConfig);

    // Build user message with formatted context
    const { userMessage } = await buildUserMessage(collected, effectiveDiff, diffTruncated);

    // ─── Run AI analysis ──────────────────────────────────────────
    const startTime = Date.now();

    if (useStreaming) {
      return handleStreamingResponse(provider, systemPrompt, userMessage, decision.model.modelId);
    }

    const result = await provider.analyze({
      systemPrompt,
      userMessage,
      temperature: 0.1,
      maxTokens: decision.model.maxOutputTokens,
    });

    const latencyMs = Date.now() - startTime;

    // ─── Parse and validate ───────────────────────────────────────
    const parsedOutput = parseAIResponse(result.content);

    const validation = validateAnalysisOutput(parsedOutput);

    if (!validation.success) {
      const errorMessages = (validation as { success: false; errors: string[] }).errors;
      console.error('Validation errors:', errorMessages);
      // Attempt recovery — return partial analysis with validation warnings
      if (parsedOutput && typeof parsedOutput === 'object') {
        const partial = normalizeAnalysisData(
          parsedOutput as Record<string, unknown>,
          collected,
          decision.model.modelId,
          decision.model.provider,
          latencyMs,
          result.usage,
          result.estimatedCost,
        );
        return NextResponse.json(partial);
      }
      return errorResponse(
        `AI 响应解析失败: ${errorMessages.join('; ')}`,
        'AI_PARSE_ERROR', 502,
      );
    }

    // ─── Run consistency checks ───────────────────────────────────
    const consistencyIssues = checkConsistency(
      validation.data,
      collected.fileChanges,
      collected.diff.length,
    );

    // Log issues for monitoring
    if (consistencyIssues.length > 0) {
      console.warn('Consistency issues:', consistencyIssues);
    }

    // ─── Quality evaluation ───────────────────────────────────────
    const quality = evaluateQuality(validation.data);
    if (quality.flags.length > 0) {
      console.info('Quality flags:', quality.flags);
    }

    // ─── Build response ───────────────────────────────────────────
    const analysisData: AnalysisData = {
      prInfo: collected.prInfo,
      summary: validation.data.summary,
      riskLevel: validation.data.riskLevel,
      risks: validation.data.risks.map((r, i) => ({
        id: r.id || `risk-${i + 1}`,
        severity: r.severity,
        title: r.title,
        description: r.description,
        file: r.file,
        line: r.line,
        code: r.code,
        suggestion: r.suggestion,
        confidence: r.confidence || 'medium',
        confidenceRationale: r.confidenceRationale,
        category: r.category,
      })),
      reviewComments: validation.data.reviewComments.map((c, i) => ({
        id: c.id || `comment-${i + 1}`,
        type: c.type,
        comment: c.comment,
      })),
      fileChanges: collected.fileChanges,
      modelUsed: decision.model.modelId,
      provider: decision.model.provider,
      estimatedCost: result.estimatedCost,
      latencyMs,
      tokenUsage: result.usage,
    };

    // Cache the result
    analysisCache.set(cacheKey, analysisData);

    return NextResponse.json(analysisData);
  } catch (error: any) {
    console.error('Analysis error:', error);

    const code = error.code || 'INTERNAL_ERROR';
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404, INVALID_URL: 400, GITHUB_ERROR: 502,
      AI_ERROR: 502, AI_PARSE_ERROR: 502, AI_RATE_LIMIT: 429,
      AI_CONFIG_ERROR: 500, RATE_LIMIT: 429, INTERNAL_ERROR: 500,
    };

    return errorResponse(
      error.message || '分析过程中出现未知错误',
      code as AnalyzeError['code'],
      statusMap[code] || 500,
    );
  }
}

// ─── Streaming handler ───────────────────────────────────────────────

async function handleStreamingResponse(
  provider: ReturnType<typeof getProviderForModel>,
  systemPrompt: string,
  userMessage: string,
  modelId: string,
): Promise<NextResponse> {
  const startTime = Date.now();
  const encoder = new TextEncoder();
  let accumulatedContent = '';

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };

      try {
        // Phase 1: Progress
        send({ type: 'progress', phase: 'analyzing', message: '正在获取代码变更...' });

        // Phase 2: Stream AI analysis
        const streamIter = provider.analyzeStream({
          systemPrompt,
          userMessage,
          temperature: 0.1,
        });

        let riskCount = 0;
        let commentCount = 0;

        for await (const chunk of streamIter) {
          if (chunk.done) break;
          accumulatedContent += chunk.content;

          // Try to parse partial JSON for progressive rendering
          const partial = tryParsePartialJSON(accumulatedContent);
          if (partial) {
            if (partial.summary && partial.summary.length > 50) {
              send({
                type: 'partial',
                payloadType: 'summary',
                content: partial.summary,
              });
            }
            if (partial.risks && partial.risks.length > riskCount) {
              for (let i = riskCount; i < partial.risks.length; i++) {
                send({
                  type: 'partial',
                  payloadType: 'risk',
                  risk: partial.risks[i],
                });
              }
              riskCount = partial.risks.length;
            }
            if (partial.reviewComments && partial.reviewComments.length > commentCount) {
              for (let i = commentCount; i < partial.reviewComments.length; i++) {
                send({
                  type: 'partial',
                  payloadType: 'comment',
                  comment: partial.reviewComments[i],
                });
              }
              commentCount = partial.reviewComments.length;
            }
          }
        }

        // Phase 3: Complete
        const parsed = parseAIResponse(accumulatedContent);
        const validation = validateAnalysisOutput(parsed);

        if (validation.success) {
          const latencyMs = Date.now() - startTime;
          send({
            type: 'complete',
            riskLevel: validation.data.riskLevel,
            totalRisks: validation.data.risks.length,
            totalComments: validation.data.reviewComments.length,
            modelUsed: modelId,
            estimatedCost: 0,
            latencyMs,
          });
        } else {
          send({
            type: 'error',
            message: 'AI 响应解析失败: ' + (validation as { errors: string[] }).errors.join('; '),
            code: 'AI_PARSE_ERROR',
          });
        }

        controller.close();
      } catch (error: any) {
        send({
          type: 'error',
          message: error.message || '分析过程中出现错误',
          code: error.code || 'AI_ERROR',
        });
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────

function errorResponse(message: string, code: string, status: number): NextResponse {
  const err: AnalyzeError = { error: message, code: code as AnalyzeError['code'] };
  return NextResponse.json(err, { status });
}

/**
 * Build the user message from collected context.
 * For now uses a simplified formatter; the full formatter is in context/formatter.ts.
 */
async function buildUserMessage(
  collected: Awaited<ReturnType<typeof collectStandardContext>>,
  effectiveDiff: string,
  diffTruncated: boolean,
): Promise<{ userMessage: string }> {
  let msg = '';

  // PR metadata
  msg += '## PR 元数据\n```json\n';
  msg += JSON.stringify({
    title: collected.prInfo.title,
    author: collected.prInfo.author,
    branch: collected.prInfo.branch,
    filesChanged: collected.prInfo.filesChanged,
    additions: collected.prInfo.additions,
    deletions: collected.prInfo.deletions,
  }, null, 2);
  msg += '\n```\n\n';

  // PR description
  if (collected.prInfo.body) {
    const desc = collected.prInfo.body.length > 3000
      ? collected.prInfo.body.slice(0, 3000) + '\n...(已截断)'
      : collected.prInfo.body;
    msg += `### PR 描述\n\n${desc}\n\n`;
  }

  // Commit history
  if (collected.commits.length > 0) {
    msg += '## Commit 历史\n\n';
    for (const c of collected.commits.slice(0, 30)) {
      const firstLine = c.message.split('\n')[0].slice(0, 80);
      msg += `- \`${c.sha}\` ${firstLine} (by ${c.author})\n`;
    }
    msg += '\n';
  }

  // Dependency graph
  if (collected.dependencyGraph && collected.dependencyGraph.edges.length > 0) {
    msg += '## 文件依赖关系\n\n';
    const bySource = new Map<string, string[]>();
    for (const e of collected.dependencyGraph.edges) {
      const deps = bySource.get(e.from) || [];
      deps.push(e.to);
      bySource.set(e.from, deps);
    }
    for (const [src, deps] of bySource) {
      msg += `- **${src}** → depends on: [${[...new Set(deps)].join(', ')}]\n`;
    }
    if (collected.dependencyGraph.externalDependents.length > 0) {
      msg += `\n外部依赖 (不在变更中但受影响): ${collected.dependencyGraph.externalDependents.join(', ')}\n`;
    }
    msg += '\n';
  }

  // Surrounding context
  if (collected.filesWithContext.length > 0) {
    const relevant = collected.filesWithContext.filter(
      (f) => f.surroundingContext.some((b) => b.hasChanges),
    );
    if (relevant.length > 0) {
      msg += '## 变更文件完整上下文\n\n';
      for (const fwc of relevant.slice(0, 10)) {
        const changedBlocks = fwc.surroundingContext.filter((b) => b.hasChanges);
        if (changedBlocks.length === 0) continue;
        const lang = fwc.path.slice(fwc.path.lastIndexOf('.') + 1);
        msg += `### ${fwc.path}\n\n\`\`\`${lang}\n`;
        for (const block of changedBlocks.slice(0, 3)) {
          msg += `// === ${block.type}: ${block.name} (L${block.startLine}-L${block.endLine}) ===\n`;
          msg += block.code + '\n\n';
        }
        msg += '```\n\n';
      }
    }
  }

  // ★ Related Files (RAG) — AI-retrieved files from the broader repo
  if (collected.relatedFiles && collected.relatedFiles.length > 0) {
    msg += '## 关联文件（仓库中与本次变更相关的文件，不在 PR 变更范围内）\n\n';
    msg += '以下文件由 AI 检索确定为与本次变更相关。请审查时考虑跨文件影响：\n\n';

    const sorted = [...collected.relatedFiles].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.relevance] - order[b.relevance];
    });

    for (const rf of sorted) {
      const label = rf.relevance === 'high' ? '★★★' : rf.relevance === 'medium' ? '★★☆' : '★☆☆';
      msg += `### ${rf.path} — ${label} ${rf.reason}\n\n`;

      if (rf.relevantSections && rf.relevantSections.length > 0) {
        const lang = rf.path.slice(rf.path.lastIndexOf('.') + 1);
        msg += '```' + lang + '\n';
        for (const sec of rf.relevantSections.slice(0, 5)) {
          msg += `// === ${sec.type}: ${sec.name} (L${sec.startLine}-L${sec.endLine}) ===\n`;
          msg += sec.code + '\n\n';
        }
        msg += '```\n\n';
      } else if (rf.content) {
        const truncated = rf.content.length > 2000
          ? rf.content.slice(0, 2000) + '\n// ... (文件过长，已截断)'
          : rf.content;
        const lang = rf.path.slice(rf.path.lastIndexOf('.') + 1);
        msg += '```' + lang + '\n' + truncated + '\n```\n\n';
      }
    }
  }

  // Diff
  msg += '## Git Diff\n\n';
  if (diffTruncated) {
    msg += '**警告：diff 内容过长，已截断至前 240,000 字符。请基于可见部分进行分析。可能存在遗漏。**\n\n';
  }
  msg += '```diff\n' + effectiveDiff + '\n```';

  return { userMessage: msg };
}

/**
 * Parse AI response text into JSON, handling markdown code blocks.
 */
function parseAIResponse(textContent: string): unknown {
  let jsonStr = textContent.trim();

  // Strip markdown code fences
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // Handle case where JSON is embedded in text (extract first { ... } block)
  const firstBrace = jsonStr.indexOf('{');
  const lastBrace = jsonStr.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
  }

  return JSON.parse(jsonStr);
}

/**
 * Try to parse partial JSON (for streaming progressive rendering).
 * Returns null if parsing fails.
 */
function tryParsePartialJSON(accumulated: string): any | null {
  try {
    return parseAIResponse(accumulated);
  } catch {
    return null;
  }
}

/**
 * Normalize partially valid AI response into AnalysisData.
 */
function normalizeAnalysisData(
  raw: Record<string, unknown>,
  collected: Awaited<ReturnType<typeof collectStandardContext>>,
  modelId: string,
  providerName: string,
  latencyMs: number,
  usage?: { inputTokens: number; outputTokens: number },
  estimatedCost?: number,
): AnalysisData {
  const rawSummary = typeof raw.summary === 'string' ? raw.summary : 'AI 未返回有效的摘要信息。';
  const rawRiskLevel = raw.riskLevel as string;
  const rawRisks = Array.isArray(raw.risks) ? raw.risks as Array<Record<string, unknown>> : [];
  const rawComments = Array.isArray(raw.reviewComments) ? raw.reviewComments as Array<Record<string, unknown>> : [];

  return {
    prInfo: collected.prInfo,
    summary: rawSummary,
    riskLevel: rawRiskLevel === 'high' || rawRiskLevel === 'medium' ? rawRiskLevel : 'low',
    risks: rawRisks.map((r: Record<string, unknown>, i: number) => ({
      id: (typeof r.id === 'string' ? r.id : `risk-${i + 1}`) as string,
      severity: (typeof r.severity === 'string' ? r.severity : 'medium') as Risk['severity'],
      title: (typeof r.title === 'string' ? r.title : '未命名风险') as string,
      description: (typeof r.description === 'string' ? r.description : '') as string,
      file: (typeof r.file === 'string' ? r.file : '') as string,
      line: (typeof r.line === 'number' ? r.line : 0) as number,
      code: (typeof r.code === 'string' ? r.code : '') as string,
      suggestion: (typeof r.suggestion === 'string' ? r.suggestion : '') as string,
      confidence: (typeof r.confidence === 'string' ? r.confidence : 'low') as Risk['confidence'],
      confidenceRationale: (typeof r.confidenceRationale === 'string' ? r.confidenceRationale : 'AI 响应格式异常，置信度自动调低') as string,
      category: (typeof r.category === 'string' ? r.category : undefined) as Risk['category'],
    })),
    reviewComments: rawComments.map((c: Record<string, unknown>, i: number) => ({
      id: (typeof c.id === 'string' ? c.id : `comment-${i + 1}`) as string,
      type: (typeof c.type === 'string' ? c.type : 'suggestion') as ReviewComment['type'],
      comment: (typeof c.comment === 'string' ? c.comment : '') as string,
    })),
    fileChanges: collected.fileChanges,
    modelUsed: modelId,
    provider: providerName,
    estimatedCost,
    latencyMs,
    tokenUsage: usage,
  };
}
