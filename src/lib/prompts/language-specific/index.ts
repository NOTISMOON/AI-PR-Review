/**
 * Language-specific review instructions.
 * Each language has unique pitfalls that the model should check for.
 */

export interface LanguageInstructions {
  language: string;
  extensions: string[];
  instructions: string;
}

export const LANGUAGE_INSTRUCTIONS: Record<string, LanguageInstructions> = {
  typescript: {
    language: 'TypeScript',
    extensions: ['.ts', '.tsx'],
    instructions: `
## TypeScript 特定检查

- 是否使用了 \`any\` 类型（应尽量避免）
- 是否正确处理了 null/undefined（strict null checks）
- 是否有未处理的 Promise rejection
- 类型断言 (as) 是否安全
- 是否使用了 \`// @ts-ignore\` 或 \`// @ts-expect-error\`
- 泛型约束是否合理
- readonly 修饰符是否恰当使用
- 是否存在类型守卫缺失
`,
  },

  python: {
    language: 'Python',
    extensions: ['.py'],
    instructions: `
## Python 特定检查

- 是否使用了 \`eval()\` 或 \`exec()\`（安全风险）
- 是否使用了 \`pickle\` 加载不可信数据
- 是否使用了不安全的 \`yaml.load()\`（应使用 yaml.safe_load()）
- list/dict 作为默认参数的正确性
- 异常处理是否捕获了过于宽泛的 Exception
- 是否有 SQL 注入（字符串格式化构造查询）
- 是否使用了 \`subprocess\` 且 shell=True 的风险
`,
  },

  go: {
    language: 'Go',
    extensions: ['.go'],
    instructions: `
## Go 特定检查

- 错误处理是否完整（未忽略 error 返回值）
- goroutine 是否存在泄漏风险（缺少 context 取消或 channel 关闭）
- defer 的使用是否正确（循环中的 defer 问题）
- 是否有竞态条件（并发访问共享变量）
- interface 是否设计合理（是否过大）
- 指针使用是否正确（nil pointer dereference）
- slice/map 的并发安全性
`,
  },

  rust: {
    language: 'Rust',
    extensions: ['.rs'],
    instructions: `
## Rust 特定检查

- unsafe 块的使用是否必要且安全
- unwrap()/expect() 的使用是否恰当（是否可能 panic）
- 是否存在内存泄漏（循环引用 Rc/Arc）
- Send/Sync trait 实现是否正确
- 是否过度使用 clone()
- 错误类型设计是否合理
- 生命周期标注是否过于复杂（可能需要重构）
`,
  },

  java: {
    language: 'Java',
    extensions: ['.java'],
    instructions: `
## Java 特定检查

- 资源是否正确关闭（try-with-resources 使用）
- 是否存在 SQL 注入（Statement vs PreparedStatement）
- 异常处理是否合理（空 catch 块、吞没异常）
- 线程安全性（共享可变状态）
- equals()/hashCode() 是否一致
- 是否避免使用已废弃的 API
`,
  },

  default: {
    language: '通用',
    extensions: [],
    instructions: '',
  },
};

/**
 * Get language-specific instructions based on file extensions in the PR.
 * Detects the primary language and returns relevant checks.
 */
export function getInstructionsForFiles(filePaths: string[]): string {
  const langCounts: Record<string, number> = {};

  for (const path of filePaths) {
    const ext = path.slice(path.lastIndexOf('.'));
    for (const [, lang] of Object.entries(LANGUAGE_INSTRUCTIONS)) {
      if (lang.extensions.includes(ext)) {
        langCounts[lang.language] = (langCounts[lang.language] || 0) + 1;
        break;
      }
    }
  }

  // Get the top 2 languages by file count
  const topLanguages = Object.entries(langCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2);

  if (topLanguages.length === 0) return LANGUAGE_INSTRUCTIONS.default.instructions;

  const instructions = topLanguages
    .map(([langName]) => {
      const lang = Object.values(LANGUAGE_INSTRUCTIONS).find((l) => l.language === langName);
      return lang?.instructions || '';
    })
    .filter(Boolean)
    .join('\n');

  return instructions || LANGUAGE_INSTRUCTIONS.default.instructions;
}
