/**
 * Models module — barrel export.
 * Provides model registry, routing, and provider abstraction for multi-model AI code review.
 */

export type {
  ModelConfig,
  ModelProvider,
  ModelAnalysisRequest,
  ModelAnalysisResult,
  RouterDecision,
  RoutingContext,
} from './types';

export {
  MODEL_REGISTRY,
  getAvailableModels,
  getModelsByTier,
  getBestAvailableModel,
  getModel,
  hasAnyModel,
} from './registry';

export {
  routeModel,
  estimateCost,
  buildRoutingContext,
} from './router';

export {
  getProviderForModel,
  getProvider,
  listProviders,
  listAvailableProviders,
} from './provider-factory';

// Re-export providers for direct use
export { deepseekProvider } from './providers/deepseek';
export { openaiProvider } from './providers/openai';
export { anthropicProvider } from './providers/anthropic';
