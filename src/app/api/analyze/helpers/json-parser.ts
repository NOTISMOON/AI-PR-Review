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

  // 3. 修复字符串值内未转义的引号和换行符
  // 这是一个更健壮的字符串修复逻辑
  fixed = fixed.replace(/"((?:[^"\\]|\\.)*)"/g, (match, content) => {
    // 如果字符串内容看起来已经正确转义，直接返回
    if (!content.includes('\n') && !content.includes('\r') && !content.includes('\t')) {
      return match;
    }

    // 转义换行符和制表符
    let escaped = content
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');

    return `"${escaped}"`;
  });

  // 4. 修复字符串中未转义的双引号（但保留已转义的）
  // 匹配 "..." 字符串，查找其中未转义的引号
  fixed = fixed.replace(/"([^"]*(?:\\"[^"]*)*)"/g, (match, content) => {
    // 临时替换已转义的引号
    const temp = content.replace(/\\"/g, '\x00');
    // 转义未转义的引号
    const escaped = temp.replace(/"/g, '\\"');
    // 恢复已转义的引号
    const restored = escaped.replace(/\x00/g, '\\"');
    return `"${restored}"`;
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
