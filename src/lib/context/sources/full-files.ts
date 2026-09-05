/**
 * 全文件上下文提取器——抓取完整文件内容，并提取代码变更周边的函数/类代码块。
 *
 * 这是最关键的上文来源：模型当前只能看到 diff 片段（±3 行），
 * 但需要完整的函数体才能正确理解变更的意图和影响。
 */

import type { FileChange, FileWithContext, SurroundingBlock } from '@/types/analysis';
import { fetchFileContent } from '@/lib/github';

/**
 * 为一组变更文件提取周边的函数/类上下文。
 * 从 GitHub 抓取完整文件内容，并定位包含变更的代码块。
 */
export async function extractSurroundingContext(
  owner: string,
  repo: string,
  headSha: string,
  fileChanges: FileChange[],
  diff: string,
): Promise<FileWithContext[]> {
  const results: FileWithContext[] = [];
  const changedLineRanges = parseChangedLineRanges(diff);

  // 每批并行抓取 5 个文件以避免触发速率限制
  const BATCH_SIZE = 5;
  const relevantFiles = fileChanges.filter((f) => f.status !== 'deleted');

  for (let i = 0; i < relevantFiles.length; i += BATCH_SIZE) {
    const batch = relevantFiles.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (fc) => {
        try {
          const fullContent = await fetchFileContent(owner, repo, fc.file, headSha);
          const ranges = changedLineRanges.get(fc.file) || [];

          let surroundingBlocks: SurroundingBlock[] = [];

          if (fullContent && ranges.length > 0) {
            surroundingBlocks = extractCodeBlocks(fullContent, ranges, fc.file);
          } else if (fullContent && fc.status === 'added') {
            // 对于没有明确变更范围的新文件，包含整个文件
            surroundingBlocks = [wrapEntireFile(fullContent, fc.file)];
          }

          return {
            path: fc.file,
            fullContent,
            surroundingContext: surroundingBlocks,
            status: fc.status,
          } as FileWithContext;
        } catch {
          return {
            path: fc.file,
            fullContent: null,
            surroundingContext: [],
            status: fc.status,
          } as FileWithContext;
        }
      }),
    );

    results.push(...batchResults);
  }

  return results;
}

// ─── 变更行范围解析 ───────────────────────────────────────────────────

/**
 * 解析 unified diff，找出每个文件中发生变更的行。
 * 返回文件路径 → [startLine, endLine] 区间列表的映射。
 */
function parseChangedLineRanges(diff: string): Map<string, number[][]> {
  const ranges = new Map<string, number[][]>();
  const lines = diff.split('\n');

  let currentFile = '';
  let currentRanges: number[][] = [];

  for (const line of lines) {
    // 检测文件头
    if (line.startsWith('diff --git a/')) {
      // 保存上一个文件的变更区间
      if (currentFile && currentRanges.length > 0) {
        ranges.set(currentFile, mergeRanges(currentRanges));
      }
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      currentFile = match?.[2] || match?.[1] || '';
      currentRanges = [];
      continue;
    }

    // 解析 hunk 头：@@ -oldStart,oldCount +newStart,newCount @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const newStart = parseInt(match[1], 10);
        const newCount = match[2] ? parseInt(match[2], 10) : 1;
        currentRanges.push([newStart, newStart + newCount - 1]);
      }
    }
  }

  // 保存最后一个文件
  if (currentFile && currentRanges.length > 0) {
    ranges.set(currentFile, mergeRanges(currentRanges));
  }

  return ranges;
}

/** 合并重叠或相邻的行区间 */
function mergeRanges(ranges: number[][]): number[][] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];

    if (current[0] <= last[1] + 5) {
      // 重叠或在 5 行以内——合并
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// ─── 代码块提取 ────────────────────────────────────────────────────────

/**
 * 提取包含变更行的函数/类/方法代码块。
 * 对常见语言使用正则启发式方法。
 */
function extractCodeBlocks(
  fullContent: string,
  changedRanges: number[][],
  filePath: string,
): SurroundingBlock[] {
  const lang = detectLanguage(filePath);
  const lines = fullContent.split('\n');
  const blocks: SurroundingBlock[] = [];
  const seenLines = new Set<number>();

  for (const [start, end] of changedRanges) {
    // 查找包含该区间的代码块
    const block = findContainingBlock(lines, start, end, lang);
    if (block && !seenLines.has(block.startLine)) {
      blocks.push(block);
      seenLines.add(block.startLine);
    }
  }

  return blocks;
}

/**
 * 查找包含给定行区间的函数/类/方法。
 */
function findContainingBlock(
  lines: string[],
  changeStart: number,
  changeEnd: number,
  lang: string,
): SurroundingBlock | null {
  const blockStarts = findBlockStarts(lines, lang);

  // 查找包含变更区间的代码块
  for (let i = 0; i < blockStarts.length; i++) {
    const block = blockStarts[i];
    const blockEnd = i + 1 < blockStarts.length
      ? blockStarts[i + 1].startLine - 1
      : lines.length;

    if (changeStart >= block.startLine && changeEnd <= blockEnd) {
      // 该代码块包含变更——提取从
      // 块起始到块结束的内容，以及前面的 docstring/注释
      let extractStart = block.startLine;
      // 向前查找 JSDoc/注释块
      for (let j = block.startLine - 2; j >= 0; j--) {
        const trimmed = lines[j]?.trim() || '';
        if (trimmed.startsWith('/**') || trimmed.startsWith('*') || trimmed.startsWith('*/') ||
            trimmed.startsWith('//') || trimmed.startsWith('#')) {
          extractStart = j + 1;
        } else if (trimmed === '') {
          continue;
        } else {
          break;
        }
      }

      const code = lines.slice(extractStart - 1, blockEnd).join('\n');

      return {
        type: block.type,
        name: block.name,
        startLine: extractStart,
        endLine: blockEnd,
        code,
        hasChanges: true,
      };
    }
  }

  // 未找到包含的代码块——返回周边上下文（±15 行）
  const contextStart = Math.max(1, changeStart - 15);
  const contextEnd = Math.min(lines.length, changeEnd + 15);

  return {
    type: 'module',
    name: `lines ${contextStart}-${contextEnd}`,
    startLine: contextStart,
    endLine: contextEnd,
    code: lines.slice(contextStart - 1, contextEnd).join('\n'),
    hasChanges: true,
  };
}

export interface BlockInfo {
  type: SurroundingBlock['type'];
  name: string;
  startLine: number;
}

/**
 * 检测各种语言的代码块起始位置（函数、类、方法、interface）。
 */
export function findBlockStarts(lines: string[], lang: string): BlockInfo[] {
  const blocks: BlockInfo[] = [];

  const patterns = getBlockPatterns(lang);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    for (const pattern of patterns) {
      const match = trimmed.match(pattern.regex);
      if (match) {
        const name = pattern.extractName(match, trimmed);
        blocks.push({
          type: pattern.type,
          name,
          startLine: i + 1,
        });
        break; // 每行只匹配一种模式
      }
    }
  }

  return blocks.sort((a, b) => a.startLine - b.startLine);
}

interface BlockPattern {
  type: SurroundingBlock['type'];
  regex: RegExp;
  extractName: (match: RegExpMatchArray, line: string) => string;
}

function getBlockPatterns(lang: string): BlockPattern[] {
  // TypeScript/JavaScript
  const tsPatterns: BlockPattern[] = [
    {
      type: 'function',
      regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
      extractName: (m) => m[1],
    },
    {
      type: 'method',
      regex: /^\s*(?:public|private|protected|static|async|\s)*\s*(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{?/,
      extractName: (m) => m[1],
    },
    {
      type: 'class',
      regex: /^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/,
      extractName: (m) => m[1],
    },
    {
      type: 'interface',
      regex: /^(?:export\s+)?interface\s+(\w+)/,
      extractName: (m) => m[1],
    },
    {
      type: 'function',
      regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/,
      extractName: (m) => m[1],
    },
  ];

  // Python
  const pyPatterns: BlockPattern[] = [
    {
      type: 'function',
      regex: /^def\s+(\w+)\s*\(/,
      extractName: (m) => m[1],
    },
    {
      type: 'class',
      regex: /^class\s+(\w+)/,
      extractName: (m) => m[1],
    },
  ];

  // Go
  const goPatterns: BlockPattern[] = [
    {
      type: 'function',
      regex: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/,
      extractName: (m) => m[1],
    },
    {
      type: 'interface',
      regex: /^type\s+(\w+)\s+interface/,
      extractName: (m) => m[1],
    },
    {
      type: 'class', // Go 结构体
      regex: /^type\s+(\w+)\s+struct/,
      extractName: (m) => m[1],
    },
  ];

  // Rust
  const rustPatterns: BlockPattern[] = [
    {
      type: 'function',
      regex: /^(?:pub\s+)?fn\s+(\w+)/,
      extractName: (m) => m[1],
    },
    {
      type: 'class', // Rust 结构体
      regex: /^(?:pub\s+)?struct\s+(\w+)/,
      extractName: (m) => m[1],
    },
    {
      type: 'interface', // Rust 特性（trait）
      regex: /^(?:pub\s+)?trait\s+(\w+)/,
      extractName: (m) => m[1],
    },
    {
      type: 'method',
      regex: /^(?:pub\s+)?impl\s+[\w<>]+\s+for\s+(\w+)/,
      extractName: (m) => m[1],
    },
  ];

  const patternMap: Record<string, BlockPattern[]> = {
    typescript: tsPatterns,
    javascript: tsPatterns,
    python: pyPatterns,
    go: goPatterns,
    rust: rustPatterns,
  };

  return patternMap[lang] || tsPatterns; // 回退到 TS/JS
}

/** 将整个文件作为一个代码块包装起来（用于新文件） */
function wrapEntireFile(content: string, filePath: string): SurroundingBlock {
  const lines = content.split('\n');
  return {
    type: 'module',
    name: filePath.split('/').pop() || filePath,
    startLine: 1,
    endLine: lines.length,
    code: content,
    hasChanges: true,
  };
}

function detectLanguage(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'));
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
  };
  return map[ext] || 'typescript';
}
