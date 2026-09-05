/**
 * 模型供应商抽象类型。
 * 定义了所有 AI 模型供应商的通用接口。
 */

export interface ModelConfig {
  /** 唯一的供应商标识符 */
  provider: string;
  /** 用于 API 调用的模型名称/ID */
  modelId: string;
  /** 在 UI 中显示的展示名称 */
  displayName: string;
  /** token 最大上下文窗口 */
  contextWindow: number;
  /** 最大输出 token 数 */
  maxOutputTokens: number;
  /** 每 100 万输入 token 的成本（USD） */
  costPer1MInput: number;
  /** 每 100 万输出 token 的成本（USD） */
  costPer1MOutput: number;
  /** 支持扩展思考/推理 */
  extendedThinking: boolean;
  /** 支持流式输出 */
  streaming: boolean;
  /** 原生支持结构化的 JSON 输出 */
  structuredOutput: boolean;
  /** 该模型擅长的语言（空 = 所有语言） */
  strengths: string[];
  /** 模型被考虑使用的最小 PR 大小 */
  minPRSize?: number;
  /** 升级到更强模型前的最大 PR 大小 */
  maxPRSize?: number;
  /** 优先级层级：'primary' | 'quality' | 'fast' | 'specialized' */
  tier: 'primary' | 'quality' | 'fast' | 'specialized';
  /** 该供应商当前是否已配置（是否有 API key） */
  available: boolean;
}

export interface ModelAnalysisRequest {
  /** 系统提示词 */
  systemPrompt: string;
  /** 包含全部上下文的用户消息 */
  userMessage: string;
  /** 期望的温度（0-2） */
  temperature?: number;
  /** 覆盖最大输出 token 数 */
  maxTokens?: number;
  /** 是否流式返回响应 */
  stream?: boolean;
}

export interface ModelAnalysisResult {
  /** 模型输出的原始文本 */
  content: string;
  /** 本次分析使用的模型 */
  modelId: string;
  /** 使用的供应商 */
  provider: string;
  /** token 使用量 */
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  /** 延迟（毫秒） */
  latencyMs: number;
}

export interface ModelProvider {
  /** 供应商标识符 */
  readonly name: string;
  /** 获取模型配置 */
  getConfig(): ModelConfig;
  /** 检查供应商是否可用（是否有有效的 API key） */
  isAvailable(): boolean;
  /** 向模型发送分析请求 */
  analyze(request: ModelAnalysisRequest): Promise<ModelAnalysisResult>;
  /** 发送流式分析请求 */
  analyzeStream(request: ModelAnalysisRequest): AsyncIterable<{ content: string; done: boolean }>;
}

export interface RouterDecision {
  /** 选中的模型配置 */
  model: ModelConfig;
  /** 选择原因 */
  reason: string;
  /** 曾经考虑过的备选模型 */
  alternatives: ModelConfig[];
}

export interface RoutingContext {
  /** 变更的文件数量 */
  fileCount: number;
  /** 总 diff 大小（字符数） */
  diffSize: number;
  /** 检测到的主要语言 */
  language?: string;
  /** PR 是否涉及安全敏感路径 */
  hasSecurityPaths: boolean;
  /** 用户偏好的模型（如果有） */
  preferredModel?: string;
  /** 用户偏好的层级 */
  preferredTier?: 'fast' | 'balanced' | 'thorough';
  /** 是否请求集成模式 */
  ensembleMode?: boolean;
}
