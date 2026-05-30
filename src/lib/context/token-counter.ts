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
