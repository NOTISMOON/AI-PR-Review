/**
 * Full-File Context Extractor — fetches complete file content and extracts
 * the function/class blocks surrounding code changes.
 *
 * This is the most critical context source: the model currently only sees
 * diff hunks (±3 lines), but needs the full function body to correctly
 * understand the intent and impact of changes.
 */

import type { FileChange, FileWithContext, SurroundingBlock } from '@/styles/types/analysis';
import { fetchFileContent } from '@/lib/github';

/**
 * Extract surrounding function/class context for a set of changed files.
 * Fetches full file contents from GitHub and identifies the code blocks
 * that contain the changes.
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

  // Fetch files in parallel batches of 5 to avoid rate limiting
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
            // For new files without explicit ranges, include the entire file
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

// ─── Changed line range parsing ───────────────────────────────────────

/**
 * Parse a unified diff to find which lines were changed in each file.
 * Returns a map of file path → list of [startLine, endLine] ranges.
 */
function parseChangedLineRanges(diff: string): Map<string, number[][]> {
  const ranges = new Map<string, number[][]>();
  const lines = diff.split('\n');

  let currentFile = '';
  let currentRanges: number[][] = [];

  for (const line of lines) {
    // Detect file header
    if (line.startsWith('diff --git a/')) {
      // Save previous file's ranges
      if (currentFile && currentRanges.length > 0) {
        ranges.set(currentFile, mergeRanges(currentRanges));
      }
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      currentFile = match?.[2] || match?.[1] || '';
      currentRanges = [];
      continue;
    }

    // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const newStart = parseInt(match[1], 10);
        const newCount = match[2] ? parseInt(match[2], 10) : 1;
        currentRanges.push([newStart, newStart + newCount - 1]);
      }
    }
  }

  // Save last file
  if (currentFile && currentRanges.length > 0) {
    ranges.set(currentFile, mergeRanges(currentRanges));
  }

  return ranges;
}

/** Merge overlapping or adjacent line ranges */
function mergeRanges(ranges: number[][]): number[][] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: number[][] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];

    if (current[0] <= last[1] + 5) {
      // Overlapping or within 5 lines — merge
      last[1] = Math.max(last[1], current[1]);
    } else {
      merged.push(current);
    }
  }

  return merged;
}

// ─── Code block extraction ────────────────────────────────────────────

/**
 * Extract function/class/method blocks that contain changed lines.
 * Uses regex heuristics for common languages.
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
    // Find the containing block for this range
    const block = findContainingBlock(lines, start, end, lang);
    if (block && !seenLines.has(block.startLine)) {
      blocks.push(block);
      seenLines.add(block.startLine);
    }
  }

  return blocks;
}

/**
 * Find the function/class/method that contains a given line range.
 */
function findContainingBlock(
  lines: string[],
  changeStart: number,
  changeEnd: number,
  lang: string,
): SurroundingBlock | null {
  const blockStarts = findBlockStarts(lines, lang);

  // Find the block that contains the change range
  for (let i = 0; i < blockStarts.length; i++) {
    const block = blockStarts[i];
    const blockEnd = i + 1 < blockStarts.length
      ? blockStarts[i + 1].startLine - 1
      : lines.length;

    if (changeStart >= block.startLine && changeEnd <= blockEnd) {
      // This block contains the changes — extract everything from
      // block start to block end, plus preceding docstring/comment
      let extractStart = block.startLine;
      // Look backwards for JSDoc/comment block
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

  // No containing block found — return surrounding context (±15 lines)
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
 * Detect block starts (function, class, method, interface) for various languages.
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
        break; // One pattern per line
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
      type: 'class', // Go structs
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
      type: 'class', // Rust structs
      regex: /^(?:pub\s+)?struct\s+(\w+)/,
      extractName: (m) => m[1],
    },
    {
      type: 'interface', // Rust traits
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

  return patternMap[lang] || tsPatterns; // Fallback to TS/JS
}

/** Wrap an entire file as a single block (for new files) */
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
