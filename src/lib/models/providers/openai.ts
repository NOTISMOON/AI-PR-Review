/**
 * OpenAI provider — supports GPT-4o, GPT-4o-mini, and compatible endpoints.
 */

import OpenAI from 'openai';
import type { ModelProvider, ModelConfig, ModelAnalysisRequest, ModelAnalysisResult } from '../types';
import { MODEL_REGISTRY } from '../registry';

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw Object.assign(new Error('OPENAI_API_KEY is not configured'), { code: 'AI_CONFIG_ERROR' });
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

export const openaiProvider: ModelProvider = {
  name: 'openai',

  getConfig(): ModelConfig {
    return MODEL_REGISTRY['gpt-4o'];
  },

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
  },

  async analyze(request: ModelAnalysisRequest): Promise<ModelAnalysisResult> {
    const openai = getClient();
    const startTime = Date.now();
    const modelId = 'gpt-4o';

    try {
      const response = await openai.chat.completions.create({
        model: modelId,
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
        modelId,
        provider: 'openai',
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
          new Error('OpenAI API rate limit exceeded. Please try again later.'),
          { code: 'AI_RATE_LIMIT' }
        );
      }
      console.error('OpenAI API error:', error);
      throw Object.assign(
        new Error(`OpenAI analysis failed: ${error.message}`),
        { code: 'AI_ERROR' }
      );
    }
  },

  async *analyzeStream(request: ModelAnalysisRequest): AsyncIterable<{ content: string; done: boolean }> {
    const openai = getClient();
    const modelId = 'gpt-4o';

    try {
      const stream = await openai.chat.completions.create({
        model: modelId,
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
          new Error('OpenAI API rate limit exceeded.'),
          { code: 'AI_RATE_LIMIT' }
        );
      }
      console.error('OpenAI streaming error:', error);
      throw Object.assign(
        new Error(`OpenAI streaming failed: ${error.message}`),
        { code: 'AI_ERROR' }
      );
    }
  },
};
