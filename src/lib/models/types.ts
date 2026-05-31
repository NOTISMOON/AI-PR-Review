/**
 * Model provider abstraction types.
 * Defines the common interface for all AI model providers.
 */

export interface ModelConfig {
  /** Unique provider identifier */
  provider: string;
  /** Model name/ID for API calls */
  modelId: string;
  /** Display name shown in UI */
  displayName: string;
  /** Maximum context window in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxOutputTokens: number;
  /** Cost per 1M input tokens (USD) */
  costPer1MInput: number;
  /** Cost per 1M output tokens (USD) */
  costPer1MOutput: number;
  /** Supports extended thinking / reasoning */
  extendedThinking: boolean;
  /** Supports streaming */
  streaming: boolean;
  /** Supports structured JSON output natively */
  structuredOutput: boolean;
  /** Languages this model excels at (empty = all) */
  strengths: string[];
  /** Minimum PR size for this model to be considered */
  minPRSize?: number;
  /** Maximum PR size before upgrading to a stronger model */
  maxPRSize?: number;
  /** Priority tier: 'primary' | 'quality' | 'fast' | 'specialized' */
  tier: 'primary' | 'quality' | 'fast' | 'specialized';
  /** Whether this provider is currently configured (has API key) */
  available: boolean;
}

export interface ModelAnalysisRequest {
  /** System prompt */
  systemPrompt: string;
  /** User message with all context */
  userMessage: string;
  /** Desired temperature (0-2) */
  temperature?: number;
  /** Override max output tokens */
  maxTokens?: number;
  /** Whether to stream the response */
  stream?: boolean;
}

export interface ModelAnalysisResult {
  /** Raw text output from the model */
  content: string;
  /** Model used for this analysis */
  modelId: string;
  /** Provider used */
  provider: string;
  /** Token usage */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** Latency in milliseconds */
  latencyMs: number;
}

export interface ModelProvider {
  /** Provider identifier */
  readonly name: string;
  /** Get model configuration */
  getConfig(): ModelConfig;
  /** Check if provider is available (has valid API key) */
  isAvailable(): boolean;
  /** Send analysis request to the model */
  analyze(request: ModelAnalysisRequest): Promise<ModelAnalysisResult>;
  /** Send streaming analysis request */
  analyzeStream(request: ModelAnalysisRequest): AsyncIterable<{ content: string; done: boolean }>;
}

export interface RouterDecision {
  /** Selected model config */
  model: ModelConfig;
  /** Reason for selection */
  reason: string;
  /** Alternative models that were considered */
  alternatives: ModelConfig[];
}

export interface RoutingContext {
  /** Number of files changed */
  fileCount: number;
  /** Total diff size in characters */
  diffSize: number;
  /** Primary language detected */
  language?: string;
  /** Whether the PR touches security-sensitive paths */
  hasSecurityPaths: boolean;
  /** User's preferred model (if any) */
  preferredModel?: string;
  /** User's preferred tier */
  preferredTier?: 'fast' | 'balanced' | 'thorough';
  /** Whether ensemble mode is requested */
  ensembleMode?: boolean;
}
