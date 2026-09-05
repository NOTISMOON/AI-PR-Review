/**
 * 自定义供应商——支持用户配置的 OpenAI 兼容端点。
 * 用于本地模型（Ollama、LM Studio）以及使用自定义配置的云服务。
 */

import OpenAI from 'openai';
import type { ModelProvider, ModelConfig, ModelAnalysisRequest, ModelAnalysisResult } from '../types';
import { estimateTokens } from '@/lib/context/token-counter';

export function createCustomProvider(
  name: string,
  apiUrl: string,
  apiKey: string,
  modelName: string
): ModelProvider {
  let client: OpenAI | null = null;

  function getClient(): OpenAI {
    if (!client) {
      client = new OpenAI({
        apiKey: apiKey || 'dummy-key', // 某些本地模型不需要 API key
        baseURL: apiUrl,
      });
    }
    return client;
  }

  const modelConfig: ModelConfig = {
    provider: 'custom',
    modelId: modelName,
    displayName: name,
    contextWindow: 128000,
    maxOutputTokens: 4096,
    costPer1MInput: 0,
    costPer1MOutput: 0,
    extendedThinking: false,
    streaming: true,
    structuredOutput: false,
    strengths: ['general-coding'],
    tier: 'primary',
    available: true,
  };

  return {
    name: 'custom',

    getConfig(): ModelConfig {
      return modelConfig;
    },

    isAvailable(): boolean {
      return true;
    },

    async analyze(request: ModelAnalysisRequest): Promise<ModelAnalysisResult> {
      const openai = getClient();
      const startTime = Date.now();

      try {
        const response = await openai.chat.completions.create({
          model: modelName,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature ?? 0.1,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userMessage },
          ],
        });

        const latencyMs = Date.now() - startTime;
        const content = response.choices[0]?.message?.content || '';

        // 如果 API 未返回 usage，则估算它
        let usage = response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
            }
          : undefined;

        if (!usage) {
          const estimatedInput = estimateTokens(request.systemPrompt + '\n\n' + request.userMessage);
          const estimatedOutput = estimateTokens(content);

          usage = {
            inputTokens: estimatedInput,
            outputTokens: estimatedOutput,
          };

          console.warn(
            `[Custom Provider] API did not return usage, estimated: ${estimatedInput} input + ${estimatedOutput} output tokens`
          );
        }

        return {
          content,
          modelId: modelName,
          provider: 'custom',
          latencyMs,
          usage,
        };
      } catch (error: any) {
        if (error.status === 429) {
          throw Object.assign(
            new Error('Custom model API rate limit exceeded. Please try again later.'),
            { code: 'AI_RATE_LIMIT' }
          );
        }
        console.error('Custom model API error:', error);
        throw Object.assign(
          new Error(`Custom model analysis failed: ${error.message}`),
          { code: 'AI_ERROR' }
        );
      }
    },

    async *analyzeStream(request: ModelAnalysisRequest): AsyncIterable<{ content: string; done: boolean }> {
      const openai = getClient();

      try {
        const stream = await openai.chat.completions.create({
          model: modelName,
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature ?? 0.1,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userMessage },
          ],
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            yield { content: delta, done: false };
          }
        }
        yield { content: '', done: true };
      } catch (error: any) {
        if (error.status === 429) {
          throw Object.assign(
            new Error('Custom model API rate limit exceeded.'),
            { code: 'AI_RATE_LIMIT' }
          );
        }
        console.error('Custom model streaming error:', error);
        throw Object.assign(
          new Error(`Custom model streaming failed: ${error.message}`),
          { code: 'AI_ERROR' }
        );
      }
    },
  };
}
