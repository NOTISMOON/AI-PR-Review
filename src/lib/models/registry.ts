/**
 * 模型注册表——定义所有可用的 AI 模型、其能力与成本。
 * 仅当相应的 API key 已配置时，模型才变为“可用”。
 */

import type { ModelConfig } from './types';

function isConfigured(envKey: string): boolean {
  return !!process.env[envKey];
}

export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  'deepseek-chat': {
    provider: 'deepseek',
    modelId: 'deepseek-chat',
    displayName: 'DeepSeek Chat (V3)',
    contextWindow: 65536,
    maxOutputTokens: 8192,
    costPer1MInput: 0.14,
    costPer1MOutput: 0.28,
    extendedThinking: false,
    streaming: true,
    structuredOutput: false,
    strengths: ['chinese', 'general-coding'],
    tier: 'primary',
    available: isConfigured('DEEPSEEK_API_KEY'),
  },

  'gpt-4o-mini': {
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    displayName: 'GPT-4o Mini',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.60,
    extendedThinking: false,
    streaming: true,
    structuredOutput: true,
    strengths: ['general-coding', 'structured-output'],
    tier: 'fast',
    available: isConfigured('OPENAI_API_KEY'),
  },

  'gpt-4o': {
    provider: 'openai',
    modelId: 'gpt-4o',
    displayName: 'GPT-4o',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    costPer1MInput: 2.50,
    costPer1MOutput: 10.00,
    extendedThinking: false,
    streaming: true,
    structuredOutput: true,
    strengths: ['general-coding', 'chinese', 'architecture'],
    tier: 'quality',
    minPRSize: 50,
    available: isConfigured('OPENAI_API_KEY'),
  },

  'claude-haiku-4-5': {
    provider: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPer1MInput: 1.00,
    costPer1MOutput: 5.00,
    extendedThinking: false,
    streaming: true,
    structuredOutput: false,
    strengths: ['fast-code-review'],
    tier: 'fast',
    available: isConfigured('ANTHROPIC_API_KEY'),
  },

  'claude-sonnet-4-6': {
    provider: 'anthropic',
    modelId: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPer1MInput: 3.00,
    costPer1MOutput: 15.00,
    extendedThinking: true,
    streaming: true,
    structuredOutput: false,
    strengths: ['code-review', 'security', 'logic', 'architecture'],
    tier: 'quality',
    minPRSize: 50,
    available: isConfigured('ANTHROPIC_API_KEY'),
  },

  'claude-opus-4-8': {
    provider: 'anthropic',
    modelId: 'claude-opus-4-8',
    displayName: 'Claude Opus 4.8',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    costPer1MInput: 15.00,
    costPer1MOutput: 75.00,
    extendedThinking: true,
    streaming: true,
    structuredOutput: false,
    strengths: ['code-review', 'security', 'logic', 'architecture', 'complex-reasoning'],
    tier: 'specialized',
    minPRSize: 200,
    available: isConfigured('ANTHROPIC_API_KEY'),
  },
};

/**
 * 获取所有可用的模型（已配置 API key 的模型）。
 */
export function getAvailableModels(): ModelConfig[] {
  return Object.values(MODEL_REGISTRY).filter((m) => m.available);
}

/**
 * 按层级获取模型。
 */
export function getModelsByTier(tier: ModelConfig['tier']): ModelConfig[] {
  return getAvailableModels().filter((m) => m.tier === tier);
}

/**
 * 获取指定层级的最佳可用模型，若不可用则回退到较低层级。
 */
export function getBestAvailableModel(preferredTier?: string): ModelConfig | null {
  const tiers: ModelConfig['tier'][] = ['specialized', 'quality', 'primary', 'fast'];

  if (preferredTier) {
    // 重新排列层级，使首选层级排在最前
    const idx = tiers.indexOf(preferredTier as ModelConfig['tier']);
    if (idx >= 0) {
      tiers.splice(idx, 1);
      tiers.unshift(preferredTier as ModelConfig['tier']);
    }
  }

  for (const tier of tiers) {
    const models = getModelsByTier(tier);
    if (models.length > 0) {
      // 返回该层级中第一个（质量最高的）可用模型
      return models[0];
    }
  }

  return null;
}

/**
 * 按 ID 获取指定模型（如果可用）。
 */
export function getModel(modelId: string): ModelConfig | null {
  const model = MODEL_REGISTRY[modelId];
  return model?.available ? model : null;
}
