import { NextRequest, NextResponse } from 'next/server';
import { analysisCache } from '@/lib/cache';
import { collectDeepContext, collectQuickContext, collectStandardContext } from '@/lib/context';
import { findCachedAnalysis, findLatestAnalysisByPR, startAnalysisRun, completeAnalysisRun, failAnalysisRun } from '@/lib/analysis-store';
import { fetchPRInfo, parsePRUrl, setGitHubToken, clearGitHubToken } from '@/lib/github';
import { composeSystemPrompt, createPromptConfig } from '@/lib/prompts';
import { checkConsistency } from '@/lib/validation/consistency';
import { validateAnalysisOutput } from '@/lib/validation/schema';
import { evaluateQuality } from '@/lib/validation/quality';
import { createCustomProvider } from '@/lib/models/providers/custom';
import { parseAIResponse, tryParsePartialJSON } from './helpers/json-parser';
import { buildUserMessage } from './helpers/message-builder';
import { normalizeAnalysisData, buildResponse } from './helpers/data-normalizer';
import { truncateDiffSmart, buildCacheKey } from './helpers/diff-utils';
import { buildContextSnapshot } from './helpers/context-snapshot';
import { REVIEW_MODE_INSTRUCTIONS } from '@/lib/prompts/review-mode-instructions';
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

    // Set GitHub token from request if provided
    if (body.githubToken) {
      setGitHubToken(body.githubToken);
    }

    const parsed = parsePRUrl(body.prUrl);
    if (!parsed) {
      clearGitHubToken();
      return errorResponse(
        'URL 格式不正确，请输入标准的 GitHub PR URL（例如：https://github.com/owner/repo/pull/123）',
        'INVALID_URL',
        400,
      );
    }

    const { owner, repo, prNumber } = parsed;
    const depth = body.depth || 'standard';
    const reviewMode = body.reviewMode || false; // 是否为二次审查模式
    const useStreaming = request.headers.get('accept') === 'text/event-stream';

    const prInfo = await fetchPRInfo(owner, repo, prNumber);
    const cacheKey = buildCacheKey(owner, repo, prNumber, prInfo.headSha, depth);

    // 获取当前 depth 对应的缓存结果
    const latestCached = (analysisCache.get(cacheKey) as AnalysisResponse | null) ?? (await findCachedAnalysis(cacheKey));

    // 二次审查模式：不受 depth 限制，查找该 PR 最新的任意一次成功分析
    let previousAnalysis: AnalysisResponse | null = null;
    if (reviewMode) {
      previousAnalysis = latestCached ?? (await findLatestAnalysisByPR(owner, repo, prNumber));
      if (!previousAnalysis) {
        clearGitHubToken();
        return errorResponse('未找到可用于二次审查的分析结果，请先进行初次分析', 'NOT_FOUND', 404);
      }
      console.log(`[Review Mode] 基于分析结果进行二次审查，分析 ID: ${previousAnalysis.analysisRunId}，depth: ${previousAnalysis.depth}`);
    } else {
      // 非二次审查模式：如果有缓存且非流式，直接返回
      if (latestCached && !useStreaming) {
        clearGitHubToken();
        const response = {
          ...latestCached,
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

    let provider;
    let modelId;
    let providerName;
    let maxOutputTokens = 4096; // Default max tokens

    // Check if user has configured a custom model
    if (body.customModels && body.customModels.length > 0) {
      // Use the custom model
      const customModel = body.customModels[0];
      provider = createCustomProvider(
        customModel.name,
        customModel.apiUrl,
        customModel.apiKey,
        customModel.name
      );
      modelId = customModel.name;
      providerName = 'custom';
    } else {
      // No model configured
      clearGitHubToken();
      return errorResponse(
        '未配置模型。请在设置页面配置至少一个大模型。',
        'AI_CONFIG_ERROR',
        400
      );
    }

    const { effectiveDiff, diffTruncated } = truncateDiffSmart(collected.diff, 240000);
    const promptConfig = createPromptConfig(depth, collected.fileChanges, diffTruncated);

    // 如果是二次审查模式，添加初次分析结果到 customInstructions
    if (reviewMode && previousAnalysis) {
      promptConfig.customInstructions = (promptConfig.customInstructions || '') + buildReviewModeContext(previousAnalysis);
    }

    const systemPrompt = composeSystemPrompt(promptConfig);
    const { userMessage } = await buildUserMessage(collected, effectiveDiff, diffTruncated);

    if (useStreaming) {
      return handleStreamingResponse(provider, systemPrompt, userMessage, modelId, body.githubToken);
    }

    const startTime = Date.now();
    const result = await provider.analyze({
      systemPrompt,
      userMessage,
      temperature: 0.1,
      maxTokens: maxOutputTokens,
    });
    const latencyMs = Date.now() - startTime;

    // Clear GitHub token after analysis
    clearGitHubToken();

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
            modelId,
            providerName,
            latencyMs,
            result.usage,
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
        modelUsed: modelId,
        provider: providerName,
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

    // Clear GitHub token on error
    clearGitHubToken();

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
  provider: ReturnType<typeof createCustomProvider>,
  systemPrompt: string,
  userMessage: string,
  modelId: string,
  githubToken?: string,
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
            latencyMs: Date.now() - startTime,
          });
        } else {
          send({
            type: 'error',
            message: 'AI 响应解析失败: ' + (validation as { errors: string[] }).errors.join('; '),
            code: 'AI_PARSE_ERROR',
          });
        }

        // Clear GitHub token after streaming completes
        clearGitHubToken();
        controller.close();
      } catch (error: any) {
        send({
          type: 'error',
          message: error.message || '分析过程中出现错误',
          code: error.code || 'AI_ERROR',
        });
        // Clear GitHub token on error
        clearGitHubToken();
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

/**
 * 构建二次审查模式的上下文
 * 将初次分析结果格式化为提示词的一部分
 */
function buildReviewModeContext(previousAnalysis: AnalysisResponse): string {
  return `

${REVIEW_MODE_INSTRUCTIONS}

## 初次分析结果

以下是对同一 PR 的初次分析结果，请基于此进行二次审查：

### 初次分析总结
${previousAnalysis.summary}

### 初次分析风险等级
${previousAnalysis.riskLevel}

### 初次分析识别的风险（共 ${previousAnalysis.risks.length} 个）

${previousAnalysis.risks.map((risk, index) => `
#### 风险 ${index + 1}：${risk.title}
- **严重程度**：${risk.severity}
- **置信度**：${risk.confidence}
- **文件**：${risk.file}:${risk.line}
- **描述**：${risk.description}
- **建议**：${risk.suggestion}
${risk.confidenceRationale ? `- **理由**：${risk.confidenceRationale}` : ''}
`).join('\n')}

### 初次分析的审查评论（共 ${previousAnalysis.reviewComments.length} 个）

${previousAnalysis.reviewComments.map((comment, index) => `
#### 评论 ${index + 1}
- **类型**：${comment.type}
- **内容**：${comment.comment}
`).join('\n')}

---

**请注意：**
1. 你的任务是验证以上分析的准确性，并发现可能遗漏的问题
2. 不要简单重复初次分析的内容
3. 如果初次分析已经很完善，可以简单确认
4. 重点关注初次分析可能遗漏或误判的地方
`;
}

