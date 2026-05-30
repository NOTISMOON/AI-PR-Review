/**
 * Anthropic Claude provider — supports Claude Haiku, Sonnet, and Opus models.
 * Uses the Anthropic Messages API directly via fetch (no additional SDK required).
 */

import type { ModelProvider, ModelConfig, ModelAnalysisRequest, ModelAnalysisResult } from '../types';
import { MODEL_REGISTRY } from '../registry';

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw Object.assign(new Error('ANTHROPIC_API_KEY is not configured'), { code: 'AI_CONFIG_ERROR' });
  }
  return key;
}

/** Default model to use when provider is selected */
const DEFAULT_MODEL = 'claude-sonnet-4-6';

export const anthropicProvider: ModelProvider = {
  name: 'anthropic',

  getConfig(): ModelConfig {
    return MODEL_REGISTRY[DEFAULT_MODEL] || MODEL_REGISTRY['claude-haiku-4-5'];
  },

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  },

  async analyze(request: ModelAnalysisRequest): Promise<ModelAnalysisResult> {
    const apiKey = getApiKey();
    const startTime = Date.now();
    const modelId = DEFAULT_MODEL;

    try {
      const body: Record<string, unknown> = {
        model: modelId,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.1,
        system: request.systemPrompt,
        messages: [
          { role: 'user', content: request.userMessage },
        ],
      };

      const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 429) {
          throw Object.assign(
            new Error('Anthropic API rate limit exceeded.'),
            { code: 'AI_RATE_LIMIT' }
          );
        }
        throw Object.assign(
          new Error(`Anthropic API error: ${(errorData as any).error?.message || response.statusText}`),
          { code: 'AI_ERROR' }
        );
      }

      const data = await response.json() as any;
      const latencyMs = Date.now() - startTime;

      // Extract text from content blocks
      const textBlocks = data.content?.filter((b: any) => b.type === 'text') || [];
      const content = textBlocks.map((b: any) => b.text).join('\n');

      return {
        content,
        modelId,
        provider: 'anthropic',
        latencyMs,
        usage: data.usage
          ? {
              inputTokens: data.usage.input_tokens,
              outputTokens: data.usage.output_tokens,
            }
          : undefined,
        estimatedCost: data.usage
          ? (data.usage.input_tokens / 1_000_000) * 3.00 +
            (data.usage.output_tokens / 1_000_000) * 15.00
          : undefined,
      };
    } catch (error: any) {
      if (error.code === 'AI_CONFIG_ERROR' || error.code === 'AI_RATE_LIMIT') throw error;
      console.error('Anthropic API error:', error);
      throw Object.assign(
        new Error(`Anthropic analysis failed: ${error.message}`),
        { code: 'AI_ERROR' }
      );
    }
  },

  async *analyzeStream(request: ModelAnalysisRequest): AsyncIterable<{ content: string; done: boolean }> {
    const apiKey = getApiKey();
    const modelId = DEFAULT_MODEL;

    try {
      const body: Record<string, unknown> = {
        model: modelId,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.1,
        system: request.systemPrompt,
        messages: [
          { role: 'user', content: request.userMessage },
        ],
        stream: true,
      };

      const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw Object.assign(
          new Error(`Anthropic streaming error: ${(errorData as any).error?.message || response.statusText}`),
          { code: 'AI_ERROR' }
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw Object.assign(new Error('No response body'), { code: 'AI_ERROR' });
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done: readerDone, value } = await reader.read();
        if (readerDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const data = trimmed.slice(6);
          if (data === '[DONE]') {
            yield { content: '', done: true };
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield { content: parsed.delta.text, done: false };
            } else if (parsed.type === 'message_stop') {
              yield { content: '', done: true };
              return;
            }
          } catch {
            // Skip unparseable chunks
          }
        }
      }
      yield { content: '', done: true };
    } catch (error: any) {
      if (error.code === 'AI_CONFIG_ERROR' || error.code === 'AI_RATE_LIMIT') throw error;
      console.error('Anthropic streaming error:', error);
      throw Object.assign(
        new Error(`Anthropic streaming failed: ${error.message}`),
        { code: 'AI_ERROR' }
      );
    }
  },
};
