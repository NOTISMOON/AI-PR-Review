/**
 * Prompt Composer — assembles the complete system prompt from modular pieces
 * based on PR characteristics (size, language, analysis depth).
 */

import { BASE_SYSTEM_PROMPT } from './system-base';
import { COT_INSTRUCTIONS } from './cot-instructions';
import { SMALL_PR_EXAMPLE, LARGE_PR_EXAMPLE } from './few-shot/examples';
import { getInstructionsForFiles } from './language-specific/index';
import type { FileChange } from '@/types/analysis';

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

  // 1. Base persona + review criteria (always included)
  parts.push(BASE_SYSTEM_PROMPT);

  // 2. Chain-of-Thought (standard + deep)
  if (config.includeCoT && config.depth !== 'fast') {
    parts.push(COT_INSTRUCTIONS);
  }

  // 3. Language-specific checks
  if (config.filePaths.length > 0) {
    const langInstructions = getInstructionsForFiles(config.filePaths);
    if (langInstructions) {
      parts.push(langInstructions);
    }
  }

  // 4. Few-shot examples (standard + deep)
  if (config.includeFewShot && config.depth !== 'fast') {
    parts.push(SMALL_PR_EXAMPLE);
    if (config.depth === 'deep') {
      parts.push(LARGE_PR_EXAMPLE);
    }
  }

  // 5. Custom instructions (e.g., user-defined rules)
  if (config.customInstructions) {
    parts.push(config.customInstructions);
  }

  // 6. Truncation notice (if applicable)
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
        customInstructions: (customInstructions || '') + '\n\n## 深度审查模式\n\n这是深度审查，请更加仔细地检查以下方面：\n- 跨文件依赖的兼容性\n- 全局状态的变更影响\n- 安全上下文中的敏感操作\n- 长期维护性影响\n请为每个发现提供更加详细的 justification。',
        diffTruncated,
      };
  }
}
