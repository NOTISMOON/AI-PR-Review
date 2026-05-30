import { NextRequest, NextResponse } from 'next/server';
import { analysisCache } from '@/lib/cache';
import { collectDeepContext, collectQuickContext, collectStandardContext } from '@/lib/context';
import { findCachedAnalysis, startAnalysisRun, completeAnalysisRun, failAnalysisRun } from '@/lib/analysis-store';
import { fetchPRInfo, parsePRUrl } from '@/lib/github';
import { getProviderForModel } from '@/lib/models';
import { buildRoutingContext, routeModel } from '@/lib/models';
import { composeSystemPrompt, createPromptConfig } from '@/lib/prompts';
import { checkConsistency } from '@/lib/validation/consistency';
import { validateAnalysisOutput } from '@/lib/validation/schema';
import { evaluateQuality } from '@/lib/validation/quality';
import type {
  AnalyzeError,
  AnalyzeRequest,
  AnalysisData,
  AnalysisResponse,
  CollectedContext,
  FileChange,
  ReviewComment,
  Risk,
  SSEEvent,
} from '@/types/analysis';

export const runtime = 'nodejs';
export const maxDuration = 120;

type AnalysisDepth = 'fast' | 'standard' | 'deep';

export async function POST(request: NextRequest) {
  let analysisRunId: string | undefined;

  try {
    const body: AnalyzeRequest = await request.json();

    if (!body.prUrl || typeof body.prUrl !== 'string') {
      return errorResponse('请提供有效的 GitHub PR URL', 'INVALID_URL', 400);
    }

    const parsed = parsePRUrl(body.prUrl);
    if (!parsed) {
      return errorResponse(
        'URL 格式不正确，请输入标准的 GitHub PR URL（例如：https://github.com/owner/repo/pull/123）',
        'INVALID_URL',
        400,
      );
    }

    const { owner, repo, prNumber } = parsed;
    const depth = body.depth || 'standard';
    const useStreaming = request.headers.get('accept') === 'text/event-stream';

    const prInfo = await fetchPRInfo(owner, repo, prNumber);
    const cacheKey = buildCacheKey(owner, repo, prNumber, prInfo.headSha, depth);

    if (!useStreaming) {
      const cached = (analysisCache.get(cacheKey) as AnalysisResponse | null) ?? (await findCachedAnalysis(cacheKey));
      if (cached) {
        const response = {
          ...cached,
          cacheHit: true,
        } satisfies AnalysisResponse;
        analysisCache.set(cacheKey, response);
        return NextResponse.json(response);
      }
    }

    const collected = await collectByDepth(owner, repo, prNumber, depth);

    const run = await startAnalysisRun({
      owner,
      repo,
      defaultBranch: collected.prInfo.baseBranch,
      cacheKey,
      depth,
      collected,
    });
    analysisRunId = run.id;

    const routingCtx = buildRoutingContext({
      fileCount: collected.fileChanges.length,
      fileList: collected.fileChanges.map((file: FileChange) => file.file),
      diffSize: collected.diff.length,
      preferredModel: body.preferredModel,
      preferredTier: depth === 'fast' ? 'fast' : depth === 'deep' ? 'thorough' : 'balanced',
      ensembleMode: body.ensembleMode,
    });

    const decision = routeModel(routingCtx);
    const provider = getProviderForModel(decision.model);
    const { effectiveDiff, diffTruncated } = truncateDiffSmart(collected.diff, 240000);
    const promptConfig = createPromptConfig(depth, collected.fileChanges, diffTruncated);
    const systemPrompt = composeSystemPrompt(promptConfig);
    const { userMessage } = await buildUserMessage(collected, effectiveDiff, diffTruncated);

    if (useStreaming) {
      return handleStreamingResponse(provider, systemPrompt, userMessage, decision.model.modelId);
    }

    const startTime = Date.now();
    const result = await provider.analyze({
      systemPrompt,
      userMessage,
      temperature: 0.1,
      maxTokens: decision.model.maxOutputTokens,
    });
    const latencyMs = Date.now() - startTime;

    const parsedOutput = parseAIResponse(result.content);
    const validation = validateAnalysisOutput(parsedOutput);

    let response: AnalysisResponse;

    if (!validation.success) {
      const errorMessages = (validation as { success: false; errors: string[] }).errors;
      console.error('Validation errors:', errorMessages);

      if (parsedOutput && typeof parsedOutput === 'object') {
        response = buildResponse(
          normalizeAnalysisData(
            parsedOutput as Record<string, unknown>,
            collected,
            decision.model.modelId,
            decision.model.provider,
            latencyMs,
            result.usage,
            result.estimatedCost,
          ),
          {
            analysisRunId,
            analyzedAt: new Date().toISOString(),
            cacheHit: false,
            prUrl: body.prUrl,
            depth,
            contextSnapshot: buildContextSnapshot(collected, diffTruncated),
          },
        );
      } else {
        await failIfNeeded(analysisRunId, 'AI_PARSE_ERROR', `AI 响应解析失败: ${errorMessages.join('; ')}`);
        return errorResponse(`AI 响应解析失败: ${errorMessages.join('; ')}`, 'AI_PARSE_ERROR', 502);
      }
    } else {
      const consistencyIssues = checkConsistency(
        validation.data,
        collected.fileChanges,
        collected.diff.length,
      );
      if (consistencyIssues.length > 0) {
        console.warn('Consistency issues:', consistencyIssues);
      }

      const quality = evaluateQuality(validation.data);
      if (quality.flags.length > 0) {
        console.info('Quality flags:', quality.flags);
      }

      const analysisData: AnalysisData = {
        prInfo: collected.prInfo,
        summary: validation.data.summary,
        riskLevel: validation.data.riskLevel,
        risks: validation.data.risks.map((risk, index) => ({
          id: risk.id || `risk-${index + 1}`,
          severity: risk.severity,
          title: risk.title,
          description: risk.description,
          file: risk.file,
          line: risk.line,
          code: risk.code,
          suggestion: risk.suggestion,
          confidence: risk.confidence || 'medium',
          confidenceRationale: risk.confidenceRationale,
          category: risk.category,
        })),
        reviewComments: validation.data.reviewComments.map((comment, index) => ({
          id: comment.id || `comment-${index + 1}`,
          type: comment.type,
          comment: comment.comment,
        })),
        fileChanges: collected.fileChanges,
        modelUsed: decision.model.modelId,
        provider: decision.model.provider,
        estimatedCost: result.estimatedCost,
        latencyMs,
        tokenUsage: result.usage,
      };

      response = buildResponse(analysisData, {
        analysisRunId,
        analyzedAt: new Date().toISOString(),
        cacheHit: false,
        prUrl: body.prUrl,
        depth,
        contextSnapshot: buildContextSnapshot(collected, diffTruncated),
      });
    }

    analysisCache.set(cacheKey, response);

    if (analysisRunId) {
      await completeAnalysisRun({
        analysisRunId,
        data: response,
        contextSnapshot: response.contextSnapshot!,
      });
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Analysis error:', error);

    const code = error.code || 'INTERNAL_ERROR';
    const statusMap: Record<string, number> = {
      NOT_FOUND: 404,
      INVALID_URL: 400,
      GITHUB_ERROR: 502,
      AI_ERROR: 502,
      AI_PARSE_ERROR: 502,
      AI_RATE_LIMIT: 429,
      AI_CONFIG_ERROR: 500,
      RATE_LIMIT: 429,
      INTERNAL_ERROR: 500,
    };

    await failIfNeeded(
      analysisRunId,
      code,
      error.message || '分析过程中出现未知错误',
    );

    return errorResponse(
      error.message || '分析过程中出现未知错误',
      code as AnalyzeError['code'],
      statusMap[code] || 500,
    );
  }
}

async function collectByDepth(owner: string, repo: string, prNumber: number, depth: AnalysisDepth) {
  switch (depth) {
    case 'fast':
      return collectQuickContext(owner, repo, prNumber);
    case 'deep':
      return collectDeepContext(owner, repo, prNumber);
    default:
      return collectStandardContext(owner, repo, prNumber);
  }
}

function buildCacheKey(owner: string, repo: string, prNumber: number, headSha: string, depth: AnalysisDepth) {
  return `analysis:${owner}:${repo}:${prNumber}:${headSha}:${depth}`;
}

/**
 * Smart diff truncation - preserves complete file blocks
 */
function truncateDiffSmart(diff: string, maxSize: number): { effectiveDiff: string; diffTruncated: boolean } {
  if (diff.length <= maxSize) {
    return { effectiveDiff: diff, diffTruncated: false };
  }

  // Find the last complete diff block before maxSize
  const lastFileHeader = diff.lastIndexOf('\ndiff --git', maxSize);

  if (lastFileHeader > 0) {
    return {
      effectiveDiff: diff.slice(0, lastFileHeader) + '\n\n... (remaining files truncated)',
      diffTruncated: true,
    };
  }

  // Fallback: simple truncation
  return {
    effectiveDiff: diff.slice(0, maxSize) + '\n\n... (truncated)',
    diffTruncated: true,
  };
}

function buildContextSnapshot(collected: CollectedContext, diffTruncated: boolean) {
  return {
    diff: collected.diff,
    diffTruncated,
    commits: collected.commits,
    prComments: collected.prComments,
    repoStructure: collected.repoStructure,
    languageConfigs: collected.languageConfigs,
    dependencyGraph: collected.dependencyGraph,
    relatedFiles: collected.relatedFiles,
    filesWithContext: collected.filesWithContext,
  };
}

function buildResponse(
  data: AnalysisData,
  extras: Omit<AnalysisResponse, keyof AnalysisData>,
): AnalysisResponse {
  return {
    ...data,
    ...extras,
  };
}

async function failIfNeeded(analysisRunId: string | undefined, errorCode: string, errorMessage: string) {
  if (!analysisRunId) {
    return;
  }

  try {
    await failAnalysisRun({ analysisRunId, errorCode, errorMessage });
  } catch (error) {
    console.error('Failed to persist analysis error:', error);
  }
}

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
        send({ type: 'progress', phase: 'analyzing', message: '正在获取代码变更并进行分析...' });

        const streamIter = provider.analyzeStream({
          systemPrompt,
          userMessage,
          temperature: 0.1,
        });

        let riskCount = 0;
        let commentCount = 0;

        for await (const chunk of streamIter) {
          if (chunk.done) {
            break;
          }

          accumulatedContent += chunk.content;

          const partial = tryParsePartialJSON(accumulatedContent);
          if (!partial) {
            continue;
          }

          if (partial.summary && partial.summary.length > 50) {
            send({
              type: 'partial',
              payloadType: 'summary',
              content: partial.summary,
            });
          }

          if (partial.risks && partial.risks.length > riskCount) {
            for (let index = riskCount; index < partial.risks.length; index += 1) {
              send({
                type: 'partial',
                payloadType: 'risk',
                risk: partial.risks[index],
              });
            }
            riskCount = partial.risks.length;
          }

          if (partial.reviewComments && partial.reviewComments.length > commentCount) {
            for (let index = commentCount; index < partial.reviewComments.length; index += 1) {
              send({
                type: 'partial',
                payloadType: 'comment',
                comment: partial.reviewComments[index],
              });
            }
            commentCount = partial.reviewComments.length;
          }
        }

        const parsed = parseAIResponse(accumulatedContent);
        const validation = validateAnalysisOutput(parsed);

        if (validation.success) {
          send({
            type: 'complete',
            riskLevel: validation.data.riskLevel,
            totalRisks: validation.data.risks.length,
            totalComments: validation.data.reviewComments.length,
            modelUsed: modelId,
            estimatedCost: 0,
            latencyMs: Date.now() - startTime,
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

function errorResponse(message: string, code: string, status: number): NextResponse {
  const error: AnalyzeError = { error: message, code: code as AnalyzeError['code'] };
  return NextResponse.json(error, { status });
}

async function buildUserMessage(
  collected: Awaited<ReturnType<typeof collectStandardContext>>,
  effectiveDiff: string,
  diffTruncated: boolean,
): Promise<{ userMessage: string }> {
  let message = '';

  message += '## PR 元数据\n```json\n';
  message += JSON.stringify(
    {
      title: collected.prInfo.title,
      author: collected.prInfo.author,
      branch: collected.prInfo.branch,
      filesChanged: collected.prInfo.filesChanged,
      additions: collected.prInfo.additions,
      deletions: collected.prInfo.deletions,
    },
    null,
    2,
  );
  message += '\n```\n\n';

  if (collected.prInfo.body) {
    const description =
      collected.prInfo.body.length > 3000
        ? `${collected.prInfo.body.slice(0, 3000)}\n...(已截断)`
        : collected.prInfo.body;
    message += `### PR 描述\n\n${description}\n\n`;
  }

  if (collected.commits.length > 0) {
    message += '## Commit 历史\n\n';
    for (const commit of collected.commits.slice(0, 30)) {
      const firstLine = commit.message.split('\n')[0].slice(0, 80);
      message += `- \`${commit.sha}\` ${firstLine} (by ${commit.author})\n`;
    }
    message += '\n';
  }

  if (collected.dependencyGraph && collected.dependencyGraph.edges.length > 0) {
    message += '## 文件依赖关系\n\n';
    const bySource = new Map<string, string[]>();

    for (const edge of collected.dependencyGraph.edges) {
      const deps = bySource.get(edge.from) || [];
      deps.push(edge.to);
      bySource.set(edge.from, deps);
    }

    for (const [source, deps] of bySource) {
      message += `- **${source}** -> depends on: [${[...new Set(deps)].join(', ')}]\n`;
    }

    if (collected.dependencyGraph.externalDependents.length > 0) {
      message += `\n外部依赖: ${collected.dependencyGraph.externalDependents.join(', ')}\n`;
    }

    message += '\n';
  }

  if (collected.filesWithContext.length > 0) {
    const relevant = collected.filesWithContext.filter((file) =>
      file.surroundingContext.some((block) => block.hasChanges),
    );

    if (relevant.length > 0) {
      message += '## 变更文件上下文\n\n';
      for (const file of relevant.slice(0, 10)) {
        const changedBlocks = file.surroundingContext.filter((block) => block.hasChanges);
        if (changedBlocks.length === 0) {
          continue;
        }

        const language = file.path.slice(file.path.lastIndexOf('.') + 1);
        message += `### ${file.path}\n\n\`\`\`${language}\n`;
        for (const block of changedBlocks.slice(0, 3)) {
          message += `// === ${block.type}: ${block.name} (L${block.startLine}-L${block.endLine}) ===\n`;
          message += `${block.code}\n\n`;
        }
        message += '```\n\n';
      }
    }
  }

  if (collected.relatedFiles.length > 0) {
    message += '## 关联文件\n\n';
    const sorted = [...collected.relatedFiles].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.relevance] - order[b.relevance];
    });

    for (const relatedFile of sorted) {
      message += `### ${relatedFile.path} - ${relatedFile.reason}\n\n`;
      if (relatedFile.relevantSections.length > 0) {
        const language = relatedFile.path.slice(relatedFile.path.lastIndexOf('.') + 1);
        message += `\`\`\`${language}\n`;
        for (const section of relatedFile.relevantSections.slice(0, 5)) {
          message += `// === ${section.type}: ${section.name} (L${section.startLine}-L${section.endLine}) ===\n`;
          message += `${section.code}\n\n`;
        }
        message += '```\n\n';
      } else if (relatedFile.content) {
        const truncated =
          relatedFile.content.length > 2000
            ? `${relatedFile.content.slice(0, 2000)}\n// ... (文件已截断)`
            : relatedFile.content;
        const language = relatedFile.path.slice(relatedFile.path.lastIndexOf('.') + 1);
        message += `\`\`\`${language}\n${truncated}\n\`\`\`\n\n`;
      }
    }
  }

  message += '## Git Diff\n\n';
  if (diffTruncated) {
    message += '**警告：diff 内容过长，已截断至前 240,000 字符。**\n\n';
  }
  message += `\`\`\`diff\n${effectiveDiff}\n\`\`\``;

  return { userMessage: message };
}

function parseAIResponse(textContent: string): unknown {
  let jsonString = textContent.trim();

  // 去除 markdown 代码块包裹
  if (jsonString.startsWith('```')) {
    jsonString = jsonString.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // 提取最外层 JSON 对象
  const firstBrace = jsonString.indexOf('{');
  const lastBrace = jsonString.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    jsonString = jsonString.slice(firstBrace, lastBrace + 1);
  }

  // 尝试解析，失败则逐步修复
  try {
    return JSON.parse(jsonString);
  } catch {
    return JSON.parse(repairJSON(jsonString));
  }
}

/** 修复 AI 模型常见 JSON 格式错误 */
function repairJSON(raw: string): string {
  let fixed = raw;

  // 1. 去除 trailing commas（}, 或 ], 前多余的逗号）
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // 2. 修复属性名缺少引号（如 { foo: "bar" } → { "foo": "bar" }）
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3');

  // 3. 修复字符串值内未转义的换行符（在双引号字符串内）
  fixed = fixed.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (_match, content) => {
    const escaped = content.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    return `"${escaped}"`;
  });

  return fixed;
}

function tryParsePartialJSON(accumulated: string): any | null {
  try {
    return parseAIResponse(accumulated);
  } catch {
    return null;
  }
}

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
  const rawRisks = Array.isArray(raw.risks) ? (raw.risks as Array<Record<string, unknown>>) : [];
  const rawComments = Array.isArray(raw.reviewComments)
    ? (raw.reviewComments as Array<Record<string, unknown>>)
    : [];

  return {
    prInfo: collected.prInfo,
    summary: rawSummary,
    riskLevel: rawRiskLevel === 'high' || rawRiskLevel === 'medium' ? rawRiskLevel : 'low',
    risks: rawRisks.map((risk, index) => ({
      id: (typeof risk.id === 'string' ? risk.id : `risk-${index + 1}`) as string,
      severity: (typeof risk.severity === 'string' ? risk.severity : 'medium') as Risk['severity'],
      title: (typeof risk.title === 'string' ? risk.title : '未命名风险') as string,
      description: (typeof risk.description === 'string' ? risk.description : '') as string,
      file: (typeof risk.file === 'string' ? risk.file : '') as string,
      line: (typeof risk.line === 'number' ? risk.line : 0) as number,
      code: (typeof risk.code === 'string' ? risk.code : '') as string,
      suggestion: (typeof risk.suggestion === 'string' ? risk.suggestion : '') as string,
      confidence: (typeof risk.confidence === 'string' ? risk.confidence : 'low') as Risk['confidence'],
      confidenceRationale:
        (typeof risk.confidenceRationale === 'string'
          ? risk.confidenceRationale
          : 'AI 响应格式异常，置信度自动调低') as string,
      category: (typeof risk.category === 'string' ? risk.category : undefined) as Risk['category'],
    })),
    reviewComments: rawComments.map((comment, index) => ({
      id: (typeof comment.id === 'string' ? comment.id : `comment-${index + 1}`) as string,
      type: (typeof comment.type === 'string' ? comment.type : 'suggestion') as ReviewComment['type'],
      comment: (typeof comment.comment === 'string' ? comment.comment : '') as string,
    })),
    fileChanges: collected.fileChanges,
    modelUsed: modelId,
    provider: providerName,
    estimatedCost,
    latencyMs,
    tokenUsage: usage,
  };
}
