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
} from './registry';

export {
  routeModel,
  buildRoutingContext,
} from './router';

export {
  getProviderForModel,
} from './provider-factory';
