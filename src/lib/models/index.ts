/**
 * 模型模块——出口聚合文件。
 * 为多模型 AI 代码审查提供模型注册表、路由和供应商抽象。
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
