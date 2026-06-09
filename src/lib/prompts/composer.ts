/**
 * Prompt Composer — assembles the complete system prompt from modular pieces
 * based on PR characteristics (size, language, analysis depth).
 */

import { BASE_SYSTEM_PROMPT } from './system-base';
import { COT_INSTRUCTIONS } from './cot-instructions';
import { SMALL_PR_EXAMPLE, LARGE_PR_EXAMPLE } from './few-shot/examples';
import { getInstructionsForFiles } from './language-specific/index';
import { FAST_MODE_INSTRUCTIONS } from './fast-mode-instructions';
import { STANDARD_MODE_INSTRUCTIONS } from './standard-mode-instructions';
import { DEEP_MODE_INSTRUCTIONS } from './deep-mode-instructions';
import type { FileChange } from '@/styles/types/analysis';

export interface PromptConfig {
  /** Analysis depth: fast (skip examples), standard, or deep (full CoT + examples) */
  depth: 'fast' | 'standard' | 'deep';
  /** File paths for language detection */
  filePaths: string[];
  /** Whether to include chain-of-thought instructions */
  includeCoT: boolean;
  /** Whether to include few-shot examples */
  includeFewShot: boolean;
  /** Custom additional instructions */
  customInstructions?: string;
  /** Whether the diff was truncated */
  diffTruncated: boolean;
}

/**
 * Compose the full system prompt based on configuration.
 */
export function composeSystemPrompt(config: PromptConfig): string {
  const parts: string[] = [];

  // 1. Fast mode: ONLY fast mode instructions (override base prompt)
  if (config.depth === 'fast') {
    parts.push(FAST_MODE_INSTRUCTIONS);

    // Add minimal base rules for JSON format only
    parts.push(`
## 输出格式（必须遵守）

返回严格的 JSON 对象：

{
  "summary": "PR 变更的简洁中文总结",
  "riskLevel": "low" | "medium" | "high",
  "risks": [],
  "reviewComments": []
}

**JSON 格式要求：**
- 所有字符串必须正确转义
- 不要在字符串中使用未转义的双引号
- 不要在字符串中使用未转义的换行符（使用 \\n 代替）
`);

    // 6. Custom instructions (e.g., review mode context, user-defined rules)
    if (config.customInstructions) {
      parts.push(config.customInstructions);
    }
  } else {
    // 2. Standard/Deep mode: Full base prompt
    parts.push(BASE_SYSTEM_PROMPT);

    // 3. Mode-specific instructions
    if (config.depth === 'standard') {
      parts.push(STANDARD_MODE_INSTRUCTIONS);
    } else if (config.depth === 'deep') {
      parts.push(DEEP_MODE_INSTRUCTIONS);
    }

    // 4. Chain-of-Thought (standard + deep)
    if (config.includeCoT) {
      parts.push(COT_INSTRUCTIONS);
    }

    // 5. Language-specific checks
    if (config.filePaths.length > 0) {
      const langInstructions = getInstructionsForFiles(config.filePaths);
      if (langInstructions) {
        parts.push(langInstructions);
      }
    }

    // 6. Few-shot examples (standard + deep)
    if (config.includeFewShot) {
      parts.push(SMALL_PR_EXAMPLE);
      if (config.depth === 'deep') {
        parts.push(LARGE_PR_EXAMPLE);
      }
    }

    // 7. Custom instructions (e.g., user-defined rules)
    if (config.customInstructions) {
      parts.push(config.customInstructions);
    }
  }

  // 7. Truncation notice (if applicable)
  if (config.diffTruncated) {
    parts.push(`
## 注意

提供的 diff 内容可能已被截断。如果发现文件内容不完整，请在 summary 中注明哪部分代码未包含在分析范围内。对不完整的文件，降低相关风险项的置信度。
`);
  }

  return parts.join('\n\n---\n\n');
}

/**
 * Create prompt config based on analysis depth.
 */
export function createPromptConfig(
  depth: 'fast' | 'standard' | 'deep',
  fileChanges: FileChange[],
  diffTruncated: boolean,
  customInstructions?: string,
): PromptConfig {
  const filePaths = fileChanges.map((f) => f.file);

  switch (depth) {
    case 'fast':
      return {
        depth: 'fast',
        filePaths,
        includeCoT: false,
        includeFewShot: false,
        customInstructions,
        diffTruncated,
      };

    case 'standard':
      return {
        depth: 'standard',
        filePaths,
        includeCoT: true,
        includeFewShot: true,
        customInstructions,
        diffTruncated,
      };

    case 'deep':
      return {
        depth: 'deep',
        filePaths,
        includeCoT: true,
        includeFewShot: true,
        customInstructions,
        diffTruncated,
      };
  }
}
