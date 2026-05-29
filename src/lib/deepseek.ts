import OpenAI from 'openai';
import type { PRInfo, FileChange } from '@/types/analysis';

const MAX_DIFF_CHARS = 240000;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw Object.assign(new Error('DEEPSEEK_API_KEY is not configured'), { code: 'AI_CONFIG_ERROR' });
    }
    client = new OpenAI({
      apiKey,
      baseURL: 'https://api.deepseek.com',
    });
  }
  return client;
}

function truncateDiff(diff: string, maxChars: number): { diff: string; truncated: boolean } {
  if (diff.length <= maxChars) {
    return { diff, truncated: false };
  }
  return { diff: diff.slice(0, maxChars), truncated: true };
}

const SYSTEM_PROMPT = `你是一名资深的全栈代码审查专家，具有以下背景：
- 10年以上软件开发经验
- 精通多种编程语言和框架（JavaScript, TypeScript, Python, Go, Java, Rust等）
- 深入了解 Web 安全、性能优化、架构设计
- 擅长识别代码中的潜在风险和安全漏洞

你的任务是审查提供的 GitHub PR diff，给出专业的中文代码审查报告。

## 审查重点

1. **安全漏洞**：SQL 注入、XSS、CSRF、认证绕过、敏感信息泄露、不安全的依赖
2. **逻辑错误**：边界条件、空值处理、异常处理、竞态条件
3. **性能问题**：N+1 查询、不必要的循环、内存泄漏、阻塞操作
4. **代码质量**：可读性、可维护性、命名规范、过度耦合
5. **架构问题**：违反 SOLID 原则、不合理的设计模式使用、循环依赖

## 严重程度判定标准

- **严重 (critical)**：可直接导致系统崩溃、数据丢失或严重安全漏洞（如明文存储密码、SQL 注入、未验证的用户输入执行系统命令）
- **高 (high)**：可能导致部分功能异常、安全风险或重大性能影响（如缺少认证检查、密钥硬编码、不安全的加密算法）
- **中 (medium)**：影响代码可维护性、存在潜在风险或不太可能立即出现问题（如缺少错误处理、不完善的日志、轻微的代码异味）
- **低 (low)**：小的改进建议，不影响功能（如命名建议、注释缺失、代码风格）

## 输出格式

你必须返回一个严格的 JSON 对象，不要添加任何额外的文字、markdown 标记或解释。JSON 结构如下：

{
  "summary": "PR 变更的简洁中文总结，200-300字，涵盖变更目的、主要修改、影响范围",
  "riskLevel": "low" | "medium" | "high",
  "risks": [
    {
      "id": "risk-1",
      "severity": "critical" | "high" | "medium" | "low",
      "title": "简短的风险标题（中文，15字以内）",
      "description": "详细的风险描述（中文，50-150字）",
      "file": "文件路径",
      "line": 代码行号数字,
      "code": "相关代码片段（1-5行）",
      "suggestion": "具体的修复建议（中文，50-150字）"
    }
  ],
  "reviewComments": [
    {
      "id": "comment-1",
      "type": "positive" | "suggestion" | "concern",
      "comment": "评审意见（中文，30-100字）"
    }
  ]
}

## 输出规则

- 只返回上述 JSON 结构，不要包含任何 markdown 代码块标记（不要 \`\`\`json）
- 识别 3-8 个风险项；如果代码质量很高可以少于3个，如果问题很多也不要超过10个以保持评审聚焦
- 风险项按严重程度排序：critical > high > medium > low
- 提供 3-6 个 review 意见，至少包含 1 个正面（positive）和 1 个改进建议（suggestion）
- riskLevel（总体风险等级）取所有 risk 中最高的 severe 级别
- 如果 diff 被截断，在 summary 中提及"（注：diff 内容过长已被截断，可能存在遗漏）"
- 所有文字内容使用中文`;

export async function analyzeDiffWithDeepSeek(
  prInfo: PRInfo,
  fileChanges: FileChange[],
  diff: string,
): Promise<{ summary: string; riskLevel: string; risks: any[]; reviewComments: any[] }> {
  const openai = getClient();
  const { diff: effectiveDiff, truncated } = truncateDiff(diff, MAX_DIFF_CHARS);

  const prMetadata = {
    title: prInfo.title,
    author: prInfo.author,
    branch: prInfo.branch,
    filesChanged: prInfo.filesChanged,
    additions: prInfo.additions,
    deletions: prInfo.deletions,
    changedFiles: fileChanges.map((f) => `${f.file} (${f.status}: +${f.additions}/-${f.deletions})`),
  };

  const userMessage = `## PR 元数据
\`\`\`json
${JSON.stringify(prMetadata, null, 2)}
\`\`\`

## Git Diff
${truncated ? `**警告：diff 内容过长，已截断至前 ${MAX_DIFF_CHARS} 字符。请基于可见部分进行分析。**\n\n` : ''}
\`\`\`diff
${effectiveDiff}
\`\`\``;

  try {
    const response = await openai.chat.completions.create({
      model: 'deepseek-chat',
      max_tokens: 4096,
      temperature: 0.1,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    });

    const textContent = response.choices[0]?.message?.content || '';

    let jsonStr = textContent.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const result = JSON.parse(jsonStr);

    if (!result.summary || !result.riskLevel || !Array.isArray(result.risks) || !Array.isArray(result.reviewComments)) {
      throw new Error('DeepSeek response missing required fields');
    }

    return {
      summary: result.summary,
      riskLevel: result.riskLevel,
      risks: result.risks,
      reviewComments: result.reviewComments,
    };
  } catch (error: any) {
    if (error.code === 'AI_CONFIG_ERROR') throw error;
    if (error.status === 429) {
      throw Object.assign(new Error('AI API rate limit exceeded. Please try again later.'), { code: 'AI_RATE_LIMIT' });
    }
    if (error instanceof SyntaxError) {
      throw Object.assign(new Error(`Failed to parse DeepSeek response: ${error.message}`), { code: 'AI_PARSE_ERROR' });
    }
    console.error('DeepSeek API error:', error);
    throw Object.assign(new Error(`DeepSeek analysis failed: ${error.message}`), { code: 'AI_ERROR' });
  }
}
