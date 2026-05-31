/**
 * DeepSeek Chat provider — refactored from the original deepseek.ts.
 * Uses OpenAI-compatible SDK with baseURL pointing to api.deepseek.com.
 */

import OpenAI from 'openai';
import type { ModelProvider, ModelConfig, ModelAnalysisRequest, ModelAnalysisResult } from '../types';
import { MODEL_REGISTRY } from '../registry';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw Object.assign(new Error('DEEPSEEK_API_KEY is not configured'), { code: 'AI_CONFIG_ERROR' });
    }
    client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com',
    });
  }
  return client;
}

export const deepseekProvider: ModelProvider = {
  name: 'deepseek',

  getConfig(): ModelConfig {
    return MODEL_REGISTRY['deepseek-chat'];
  },

  isAvailable(): boolean {
    return !!process.env.DEEPSEEK_API_KEY;
  },

  async analyze(request: ModelAnalysisRequest): Promise<ModelAnalysisResult> {
    const openai = getClient();
    const startTime = Date.now();

    try {
      const response = await openai.chat.completions.create({
        model: 'deepseek-chat',
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.1,
        messages: [
          { role: 'system', content: request.systemPrompt },
          { role: 'user', content: request.userMessage },
        ],
      });

      const latencyMs = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || '';

      return {
        content,
        modelId: 'deepseek-chat',
        provider: 'deepseek',
        latencyMs,
        usage: response.usage
          ? {
              inputTokens: response.usage.prompt_tokens,
              outputTokens: response.usage.completion_tokens,
            }
          : undefined,
      };
    } catch (error: any) {
      if (error.status === 429) {
        throw Object.assign(
          new Error('AI API rate limit exceeded. Please try again later.'),
          { code: 'AI_RATE_LIMIT' }
        );
      }
      console.error('DeepSeek API error:', error);
      throw Object.assign(
        new Error(`DeepSeek analysis failed: ${error.message}`),
        { code: 'AI_ERROR' }
      );
    }
  },

  async *analyzeStream(request: ModelAnalysisRequest): AsyncIterable<{ content: string; done: boolean }> {
    const openai = getClient();

    try {
      const stream = await openai.chat.completions.create({
        model: 'deepseek-chat',
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
          new Error('AI API rate limit exceeded. Please try again later.'),
          { code: 'AI_RATE_LIMIT' }
        );
      }
      console.error('DeepSeek streaming error:', error);
      throw Object.assign(
        new Error(`DeepSeek streaming failed: ${error.message}`),
        { code: 'AI_ERROR' }
      );
    }
  },
};
