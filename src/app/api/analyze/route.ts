import { NextRequest, NextResponse } from 'next/server';
import { analysisCache } from '@/lib/cache';
import { collectDeepContext, collectQuickContext, collectStandardContext } from '@/lib/context';
import { findCachedAnalysis, findLatestAnalysisByPR, findRunningAnalysis, startAnalysisRun, completeAnalysisRun, failAnalysisRun } from '@/lib/analysis-store';
import { fetchPRInfo, parsePRUrl, runWithGitHubToken } from '@/lib/github';
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
} from '@/styles/types/analysis';

export const runtime = 'nodejs';
export const maxDuration = 120;

type AnalysisDepth = 'fast' | 'standard' | 'deep';

export async function POST(request: NextRequest) {
  let body: AnalyzeRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse('请求体解析失败，请提交合法的 JSON', 'INVALID_URL', 400);
  }

  if (!body.prUrl || typeof body.prUrl !== 'string') {
    return errorResponse('请提供有效的 GitHub PR URL', 'INVALID_URL', 400);
  }

  // 整个请求绑定到独立的 token 上下文，并发请求互不干扰
  return runWithGitHubToken(body.githubToken, () => handleAnalyze(request, body));
}

async function handleAnalyze(request: NextRequest, body: AnalyzeRequest): Promise<NextResponse> {
  let analysisRunId: string | undefined;

  try {
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
    const reviewMode = body.reviewMode || false; // 是否为二次审查模式
    const useStreaming = request.headers.get('accept') === 'text/event-stream';

    const prInfo = await fetchPRInfo(owner, repo, prNumber);
    const cacheKey = buildCacheKey(owner, repo, prNumber, prInfo.headSha, depth);

    // 并发保护：同一 cacheKey 不允许同时运行多个分析
    const running = await findRunningAnalysis(cacheKey);
    if (running) {
      return errorResponse(
        '该 PR 在当前模式下已有分析正在运行中，请等待完成后再试',
        'ANALYSIS_RUNNING',
        409,
      );
    }

    // 获取当前 depth 对应的缓存结果
    const latestCached = (analysisCache.get(cacheKey) as AnalysisResponse | null) ?? (await findCachedAnalysis(cacheKey));

    // 二次审查模式：不受 depth 限制，查找该 PR 最新的任意一次成功分析
    let previousAnalysis: AnalysisResponse | null = null;
    if (reviewMode) {
      previousAnalysis = latestCached ?? (await findLatestAnalysisByPR(owner, repo, prNumber, prInfo.headSha));
      if (!previousAnalysis) {
        return errorResponse('未找到可用于二次审查的分析结果，请先进行初次分析', 'NOT_FOUND', 404);
      }
      console.log(`[Review Mode] 基于分析结果进行二次审查，分析 ID: ${previousAnalysis.analysisRunId}，depth: ${previousAnalysis.depth}`);
    } else if (latestCached && !body.skipCache) {
      // 非审查模式 + 有缓存 + 未强制跳过 → 直接返回，不走 AI（token 消耗为 0）
      const cachedResponse: AnalysisResponse = {
        ...latestCached,
        cacheHit: true,
        analyzedAt: new Date().toISOString(),
        latencyMs: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
      };
      analysisCache.set(cacheKey, cachedResponse);

      if (useStreaming) {
        // 流式路径：通过 SSE 直接推送缓存结果
        const encoder = new TextEncoder();
        const cachedStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `event: complete\ndata: ${JSON.stringify({
                  type: 'complete',
                  analysisRunId: cachedResponse.analysisRunId,
                  riskLevel: cachedResponse.riskLevel,
                  totalRisks: cachedResponse.risks.length,
                  totalComments: cachedResponse.reviewComments.length,
                  modelUsed: cachedResponse.modelUsed,
                  latencyMs: 0,
                  response: cachedResponse,
                })}\n\n`,
              ),
            );
            controller.close();
          },
        });
        return new NextResponse(cachedStream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        });
      }

      return NextResponse.json(cachedResponse);
    }

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
      return errorResponse(
        '未配置模型。请在设置页面配置至少一个大模型。',
        'AI_CONFIG_ERROR',
        400
      );
    }

    // 流式模式：整个分析管线（拉取 → 分析 → 校验）都在流内执行，逐阶段反馈
    if (useStreaming) {
      return handleStreamingResponse({
        owner,
        repo,
        prNumber,
        depth,
        cacheKey,
        reviewMode,
        previousAnalysis,
        provider,
        modelId,
        providerName,
        prUrl: body.prUrl,
        token: body.githubToken,
      });
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

    const { effectiveDiff, diffTruncated } = truncateDiffSmart(collected.diff, 240000);
    const promptConfig = createPromptConfig(depth, collected.fileChanges, diffTruncated);

    // 如果是二次审查模式，添加初次分析结果到 customInstructions
    if (reviewMode && previousAnalysis) {
      promptConfig.customInstructions = (promptConfig.customInstructions || '') + buildReviewModeContext(previousAnalysis);
    }

    const systemPrompt = composeSystemPrompt(promptConfig);
    const { userMessage } = await buildUserMessage(collected, effectiveDiff, diffTruncated);

    const startTime = Date.now();
    const result = await provider.analyze({
      systemPrompt,
      userMessage,
      temperature: 0.1,
      maxTokens: maxOutputTokens,
    });
    const latencyMs = Date.now() - startTime;

    const parsedOutput = parseAIResponse(result.content);
    const validation = validateAnalysisOutput(parsedOutput);

    let response: AnalysisResponse;

    if (!validation.success) {
      const errorMessages = (validation as { success: false; errors: string[] }).errors;
      console.error('Validation errors:', errorMessages);

      if (parsedOutput && typeof parsedOutput === 'object') {
        // 返回部分结果给用户以便排查，但标记运行失败，避免脏数据污染历史记录
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
        await failIfNeeded(analysisRunId, 'AI_PARSE_ERROR', `AI 响应校验失败: ${errorMessages.join('; ')}`);
        return NextResponse.json(response);
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

    if (analysisRunId) {
      await completeAnalysisRun({
        analysisRunId,
        data: response,
        contextSnapshot: response.contextSnapshot!,
      });
    }

    // DB 写入成功后才更新内存缓存，防止缓存与 DB 状态不一致
    analysisCache.set(cacheKey, response);

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
      ANALYSIS_RUNNING: 409,
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

async function handleStreamingResponse(ctx: {
  owner: string;
  repo: string;
  prNumber: number;
  depth: AnalysisDepth;
  cacheKey: string;
  reviewMode: boolean;
  previousAnalysis: AnalysisResponse | null;
  provider: ReturnType<typeof createCustomProvider>;
  modelId: string;
  providerName: string;
  prUrl: string;
  token: string | undefined;
}): Promise<NextResponse> {
  const { owner, repo, prNumber, depth, cacheKey, reviewMode, previousAnalysis, provider, modelId, providerName, prUrl, token } = ctx;
  const startTime = Date.now();
  const encoder = new TextEncoder();
  let accumulatedContent = '';

  const stream = new ReadableStream({
    // 流在 POST 返回后才执行，需重新绑定 token 上下文（外层 als.run 已退出）
    start(controller) {
      const send = (event: SSEEvent) => {
        controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
      };

      return runWithGitHubToken(token, async () => {
      let analysisRunId: string | undefined;

      try {
        // 阶段 1：拉取代码变更与上下文
        send({ type: 'progress', phase: 'fetching', message: '正在拉取 PR 代码变更与上下文...' });

        const collected = await collectByDepth(owner, repo, prNumber, depth);

        // 二次并发检查：防止流式路径下两个请求都通过初始 findRunningAnalysis，
        // 但在 startAnalysisRun 之前产生了竞态窗口
        const runningNow = await findRunningAnalysis(cacheKey);
        if (runningNow) {
          send({
            type: 'error',
            message: '该 PR 在当前模式下已有分析正在运行中，请等待完成后再试',
            code: 'ANALYSIS_RUNNING',
          });
          controller.close();
          return;
        }

        const run = await startAnalysisRun({
          owner,
          repo,
          defaultBranch: collected.prInfo.baseBranch,
          cacheKey,
          depth,
          collected,
        });
        analysisRunId = run.id;

        const { effectiveDiff, diffTruncated } = truncateDiffSmart(collected.diff, 240000);
        const promptConfig = createPromptConfig(depth, collected.fileChanges, diffTruncated);
        if (reviewMode && previousAnalysis) {
          promptConfig.customInstructions = (promptConfig.customInstructions || '') + buildReviewModeContext(previousAnalysis);
        }
        const systemPrompt = composeSystemPrompt(promptConfig);
        const { userMessage } = await buildUserMessage(collected, effectiveDiff, diffTruncated);

        // 阶段 2：模型分析，风险/评论逐条推送
        send({ type: 'progress', phase: 'analyzing', message: '正在调用模型分析代码变更...' });

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

        // 阶段 3：校验与整理结果
        send({ type: 'progress', phase: 'validating', message: '正在校验与整理分析结果...' });

        const parsed = parseAIResponse(accumulatedContent);
        const validation = validateAnalysisOutput(parsed);

        if (!validation.success) {
          const message = 'AI 响应解析失败: ' + (validation as { errors: string[] }).errors.join('; ');
          await failIfNeeded(analysisRunId, 'AI_PARSE_ERROR', message);
          send({ type: 'error', message, code: 'AI_PARSE_ERROR' });
          controller.close();
          return;
        }

        const latencyMs = Date.now() - startTime;
        const analysisData = normalizeAnalysisData(
          parsed as Record<string, unknown>,
          collected,
          modelId,
          providerName,
          latencyMs,
        );
        const contextSnapshot = buildContextSnapshot(collected, diffTruncated);
        const response = buildResponse(analysisData, {
          analysisRunId,
          analyzedAt: new Date().toISOString(),
          cacheHit: false,
          prUrl,
          depth,
          contextSnapshot,
        });

        await completeAnalysisRun({ analysisRunId, data: response, contextSnapshot });
        // DB 写入成功后才更新内存缓存
        analysisCache.set(cacheKey, response);

        send({
          type: 'complete',
          analysisRunId,
          riskLevel: response.riskLevel,
          totalRisks: response.risks.length,
          totalComments: response.reviewComments.length,
          modelUsed: modelId,
          latencyMs,
          response,
        });

        controller.close();
      } catch (error: any) {
        await failIfNeeded(analysisRunId, error.code || 'AI_ERROR', error.message || '分析过程中出现错误');
        send({
          type: 'error',
          message: error.message || '分析过程中出现错误',
          code: error.code || 'AI_ERROR',
        });
        controller.close();
      }
      });
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
 * 将初次分析结果格式化为提示词的一部分，自动截断以防止超出 token 限制
 */
function buildReviewModeContext(previousAnalysis: AnalysisResponse): string {
  const SEVERITY_ORDER: Record<string, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  // 按严重程度排序，优先保留高严重度风险
  const sortedRisks = [...previousAnalysis.risks].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2),
  );

  const MAX_RISKS = 30;
  const MAX_DESC_LEN = 500;
  const MAX_COMMENTS = 30;
  const TOTAL_CHAR_LIMIT = 15000;

  const truncate = (text: string, maxLen: number) =>
    text.length <= maxLen ? text : text.slice(0, maxLen) + '…';

  const risksBlock = sortedRisks
    .slice(0, MAX_RISKS)
    .map(
      (risk, index) => `
#### 风险 ${index + 1}：${risk.title}
- **严重程度**：${risk.severity}
- **置信度**：${risk.confidence}
- **文件**：${risk.file}:${risk.line}
- **描述**：${truncate(risk.description, MAX_DESC_LEN)}
- **建议**：${truncate(risk.suggestion, MAX_DESC_LEN)}
${risk.confidenceRationale ? `- **理由**：${truncate(risk.confidenceRationale, MAX_DESC_LEN)}` : ''}`,
    )
    .join('\n');

  const commentsBlock = previousAnalysis.reviewComments
    .slice(0, MAX_COMMENTS)
    .map(
      (comment, index) => `
#### 评论 ${index + 1}
- **类型**：${comment.type}
- **内容**：${truncate(comment.comment, MAX_DESC_LEN)}`,
    )
    .join('\n');

  const truncatedNotice =
    previousAnalysis.risks.length > MAX_RISKS || previousAnalysis.reviewComments.length > MAX_COMMENTS
      ? `\n> ⚠️ 初次分析共有 ${previousAnalysis.risks.length} 个风险和 ${previousAnalysis.reviewComments.length} 条评论，以上仅展示优先项（按严重程度排序）。\n`
      : '';

  let context = `

${REVIEW_MODE_INSTRUCTIONS}

## 初次分析结果

以下是对同一 PR 的初次分析结果，请基于此进行二次审查：

### 初次分析总结
${truncate(previousAnalysis.summary, 2000)}

### 初次分析风险等级
${previousAnalysis.riskLevel}
${truncatedNotice}
### 初次分析识别的风险（展示 ${Math.min(previousAnalysis.risks.length, MAX_RISKS)} / 共 ${previousAnalysis.risks.length} 个）

${risksBlock}

### 初次分析的审查评论（展示 ${Math.min(previousAnalysis.reviewComments.length, MAX_COMMENTS)} / 共 ${previousAnalysis.reviewComments.length} 个）

${commentsBlock}

---

**请注意：**
1. 你的任务是验证以上分析的准确性，并发现可能遗漏的问题
2. 不要简单重复初次分析的内容
3. 如果初次分析已经很完善，可以简单确认
4. 重点关注初次分析可能遗漏或误判的地方
`;

  // 最终整体截断，防止极端情况下超出限制
  if (context.length > TOTAL_CHAR_LIMIT) {
    context = context.slice(0, TOTAL_CHAR_LIMIT) + '\n\n... (二次审查上下文已截断)';
  }

  return context;
}

