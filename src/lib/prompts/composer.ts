/**
 * Prompt 组合器——根据 PR 特征（大小、语言、分析深度）
 * 从模块化片段组装出完整的系统提示词。
 */

import { BASE_SYSTEM_PROMPT } from './system-base';
import { COT_INSTRUCTIONS } from './cot-instructions';
import { SMALL_PR_EXAMPLE, LARGE_PR_EXAMPLE } from './few-shot/examples';
import { getInstructionsForFiles } from './language-specific/index';
import { FAST_MODE_INSTRUCTIONS } from './fast-mode-instructions';
import { STANDARD_MODE_INSTRUCTIONS } from './standard-mode-instructions';
import { DEEP_MODE_INSTRUCTIONS } from './deep-mode-instructions';
import type { FileChange } from '@/types/analysis';

export interface PromptConfig {
  /** 分析深度：fast（跳过示例）、standard 或 deep（完整 CoT + 示例） */
  depth: 'fast' | 'standard' | 'deep';
  /** 用于语言检测的文件路径 */
  filePaths: string[];
  /** 是否包含思维链（chain-of-thought）指令 */
  includeCoT: boolean;
  /** 是否包含 few-shot 示例 */
  includeFewShot: boolean;
  /** 自定义附加指令 */
  customInstructions?: string;
  /** diff 是否被截断 */
  diffTruncated: boolean;
}

/**
 * 根据配置组合出完整的系统提示词。
 */
export function composeSystemPrompt(config: PromptConfig): string {
  const parts: string[] = [];

  // 1. 快速模式：仅使用快速模式指令（覆盖基础提示词）
  if (config.depth === 'fast') {
    parts.push(FAST_MODE_INSTRUCTIONS);

    // 仅添加最简 JSON 格式的基础规则
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
  } else {
    // 2. 标准/深度模式：完整的基础提示词
    parts.push(BASE_SYSTEM_PROMPT);

    // 3. 模式专属指令
    if (config.depth === 'standard') {
      parts.push(STANDARD_MODE_INSTRUCTIONS);
    } else if (config.depth === 'deep') {
      parts.push(DEEP_MODE_INSTRUCTIONS);
    }

    // 4. 思维链（standard + deep）
    if (config.includeCoT) {
      parts.push(COT_INSTRUCTIONS);
    }

    // 5. 语言专属检查
    if (config.filePaths.length > 0) {
      const langInstructions = getInstructionsForFiles(config.filePaths);
      if (langInstructions) {
        parts.push(langInstructions);
      }
    }

    // 6. Few-shot 示例（standard + deep）
    if (config.includeFewShot) {
      parts.push(SMALL_PR_EXAMPLE);
      if (config.depth === 'deep') {
        parts.push(LARGE_PR_EXAMPLE);
      }
    }

    // 7. 自定义指令（例如用户定义的规则）
    if (config.customInstructions) {
      parts.push(config.customInstructions);
    }
  }

  // 7. 截断通知（如适用）
  if (config.diffTruncated) {
    parts.push(`
## 注意

提供的 diff 内容可能已被截断。如果发现文件内容不完整，请在 summary 中注明哪部分代码未包含在分析范围内。对不完整的文件，降低相关风险项的置信度。
`);
  }

  return parts.join('\n\n---\n\n');
}

/**
 * 根据分析深度创建 prompt 配置。
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
        customInstructions: FAST_MODE_INSTRUCTIONS,
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
