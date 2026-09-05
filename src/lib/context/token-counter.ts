/**
 * Token 计数器——为上下文窗口管理估算 token 数量。
 * 使用启发式方法：英文大约每 4 个字符 1 个 token，中文大约每 2 个字符 1 个 token。
 * 生产环境可集成 tiktoken 或 @anthropic-ai/tokenizer。
 */

// CJK 字符范围（简体中文、日文、韩文）
const CJK_REGEX = /[一-鿿぀-ゟ゠-ヿ가-힯]/g;

/**
 * 粗略的 token 估算。不精确但足以满足预算管理。
 * 英文：每个 token 约 4 个字符
 * 中文/CJK：每个 token 约 1.5 个字符（中文通常是每 2-3 个字符 1 个 token）
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  const cjkCount = (text.match(CJK_REGEX) || []).length;
  const nonCjkLength = text.length - cjkCount;

  // CJK 字符在 token 空间中更密集
  const cjkTokens = cjkCount / 1.8;
  const nonCjkTokens = nonCjkLength / 3.5;

  return Math.ceil(cjkTokens + nonCjkTokens);
}
