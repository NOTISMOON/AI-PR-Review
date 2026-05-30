/**
 * Token counter — estimates token counts for context window management.
 * Uses a heuristic: ~1 token per 4 characters for English, ~1 per 2 for Chinese.
 * For production use, integrate with tiktoken or @anthropic-ai/tokenizer.
 */

// CJK character range (simplified Chinese, Japanese, Korean)
const CJK_REGEX = /[一-鿿぀-ゟ゠-ヿ가-힯]/g;

/**
 * Rough token estimation. Not exact but sufficient for budget management.
 * English: ~4 chars per token
 * Chinese/CJK: ~1.5 chars per token (typically 2-3 chars per token for Chinese)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  const cjkCount = (text.match(CJK_REGEX) || []).length;
  const nonCjkLength = text.length - cjkCount;

  // CJK characters are denser in token space
  const cjkTokens = cjkCount / 1.8;
  const nonCjkTokens = nonCjkLength / 3.5;

  return Math.ceil(cjkTokens + nonCjkTokens);
}

/**
 * Estimate tokens for a batch of content items.
 */
export function estimateTotalTokens(
  items: { content: string; weight?: number }[],
): number {
  return items.reduce((sum, item) => sum + estimateTokens(item.content), 0);
}

export interface TokenBudget {
  /** Total token budget available */
  total: number;
  /** Tokens reserved for system prompt */
  systemPrompt: number;
  /** Tokens reserved for output */
  outputReserve: number;
  /** Tokens available for user message content */
  available: number;
  /** Tokens currently allocated */
  allocated: number;
  /** Remaining budget */
  remaining: number;
}

/**
 * Create a token budget for a given model context window.
 */
export function createBudget(
  contextWindow: number,
  systemPromptLength: number,
  maxOutputTokens: number,
): TokenBudget {
  const systemPrompt = estimateTokens(systemPromptLength.toString());
  const outputReserve = maxOutputTokens || 4096;
  const available = contextWindow - systemPrompt - outputReserve;

  return {
    total: contextWindow,
    systemPrompt,
    outputReserve,
    available,
    allocated: 0,
    remaining: available,
  };
}

/**
 * Check if adding content would exceed the budget.
 */
export function canFit(budget: TokenBudget, content: string): boolean {
  return estimateTokens(content) <= budget.remaining;
}

/**
 * Allocate tokens from the budget for a piece of content.
 */
export function allocate(budget: TokenBudget, content: string): TokenBudget {
  const tokens = estimateTokens(content);
  return {
    ...budget,
    allocated: budget.allocated + tokens,
    remaining: budget.remaining - tokens,
  };
}

/**
 * Percentage of budget used.
 */
export function usagePercent(budget: TokenBudget): number {
  return budget.total > 0 ? Math.round((budget.allocated / budget.available) * 100) : 0;
}
