/**
 * Helper functions for parsing and repairing AI responses
 */

export function parseAIResponse(textContent: string): unknown {
  let jsonString = textContent.trim();

  // 去除 markdown 代码块包裹
  if (jsonString.startsWith('```')) {
    jsonString = jsonString.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  // 提取最外层 JSON 对象
  const firstBrace = jsonString.indexOf('{');
  const lastBrace = jsonString.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    jsonString = jsonString.slice(firstBrace, lastBrace + 1);
  }

  // 尝试解析，失败则逐步修复
  try {
    return JSON.parse(jsonString);
  } catch {
    return JSON.parse(repairJSON(jsonString));
  }
}

/** 修复 AI 模型常见 JSON 格式错误 */
function repairJSON(raw: string): string {
  let fixed = raw;

  // 1. 去除 trailing commas（}, 或 ], 前多余的逗号）
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // 2. 修复属性名缺少引号（如 { foo: "bar" } → { "foo": "bar" }）
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z_]\w*)(\s*:)/g, '$1"$2"$3');

  // 3. 修复字符串值内未转义的换行符（在双引号字符串内）
  fixed = fixed.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (_match, content) => {
    const escaped = content.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    return `"${escaped}"`;
  });

  return fixed;
}

export function tryParsePartialJSON(accumulated: string): any | null {
  try {
    return parseAIResponse(accumulated);
  } catch {
    return null;
  }
}
