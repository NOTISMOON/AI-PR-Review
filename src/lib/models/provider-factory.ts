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

/**
 * Get a provider by name.
 */
export function getProvider(name: string): ModelProvider | null {
  return providerMap[name] || null;
}

/**
 * List all registered providers (regardless of availability).
 */
export function listProviders(): ModelProvider[] {
  return Object.values(providerMap);
}

/**
 * List available providers.
 */
export function listAvailableProviders(): ModelProvider[] {
  return Object.values(providerMap).filter((p) => p.isAvailable());
}
