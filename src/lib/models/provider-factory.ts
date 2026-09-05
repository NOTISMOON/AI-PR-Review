/**
 * 供应商工厂——将 ModelConfig 条目映射到其对应的供应商实现。
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
 * 获取给定模型配置对应的供应商实例。
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
