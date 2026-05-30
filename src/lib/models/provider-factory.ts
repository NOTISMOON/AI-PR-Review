/**
 * Provider Factory — maps ModelConfig entries to their provider implementations.
 */

import type { ModelConfig, ModelProvider } from './types';
import { deepseekProvider } from './providers/deepseek';
import { openaiProvider } from './providers/openai';
import { anthropicProvider } from './providers/anthropic';

const providerMap: Record<string, ModelProvider> = {
  deepseek: deepseekProvider,
  openai: openaiProvider,
  anthropic: anthropicProvider,
};

/**
 * Get the provider instance for a given model config.
 */
export function getProviderForModel(model: ModelConfig): ModelProvider {
  const provider = providerMap[model.provider];
  if (!provider) {
    throw Object.assign(
      new Error(`No provider implementation found for "${model.provider}"`),
      { code: 'AI_CONFIG_ERROR' }
    );
  }
  return provider;
}
