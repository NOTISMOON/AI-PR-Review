/**
 * Smart Chunker — manages context window by intelligently truncating and selecting content.
 *
 * Key principles:
 * 1. Never split in the middle of a function
 * 2. Never split in the middle of a diff hunk
 * 3. Prefer splitting between files
 * 4. Within a file, prefer splitting between top-level definitions
 */

import type { FilePriority } from './prioritizer';
import type { FileWithContext } from '@/types/analysis';
import { estimateTokens } from './token-counter';

export interface ChunkingOptions {
  /** Maximum total tokens for this tier */
  maxTokens: number;
  /** Minimum tokens to guarantee per file */
  minTokensPerFile: number;
  /** Whether to include surrounding function context */
  includeSurroundingContext: boolean;
}

export interface ChunkResult {
  /** The assembled content */
  content: string;
  /** Files included */
  filesIncluded: string[];
  /** Files truncated */
  filesTruncated: string[];
  /** Files excluded */
  filesExcluded: string[];
  /** Estimated token count */
  estimatedTokens: number;
}

/**
 * Chunk diff content for a tier, fitting within the token budget.
 *
 * Strategy:
 * - Allocate budget per-file based on priority scores
 * - Each file gets at least minTokensPerFile budget
 * - High-priority files get their full diff + surrounding context
 * - Low-priority files get diff only, truncated if needed
 * - Remaining files are excluded
 */
export function chunkDiffContent(
  priorities: FilePriority[],
  diff: string,
  options: ChunkingOptions,
): ChunkResult {
  const result: ChunkResult = {
    content: '',
    filesIncluded: [],
    filesTruncated: [],
    filesExcluded: [],
    estimatedTokens: 0,
  };

  let remainingBudget = options.maxTokens;

  // Extract per-file diff sections
  const fileDiffSections = splitDiffByFile(diff);

  for (const priority of priorities) {
    if (remainingBudget <= 0) {
      result.filesExcluded.push(priority.file.file);
      continue;
    }

    // Calculate budget for this file
    const fileBudget = Math.max(
      options.minTokensPerFile,
      Math.floor(options.maxTokens * priority.budgetShare),
    );

    const sectionContent = fileDiffSections.get(priority.file.file);
    if (!sectionContent) {
      result.filesExcluded.push(priority.file.file);
      continue;
    }

    const tokenEstimate = estimateTokens(sectionContent);

    if (tokenEstimate <= Math.min(fileBudget, remainingBudget)) {
      // Full file fits
      result.content += sectionContent + '\n\n';
      result.filesIncluded.push(priority.file.file);
      result.estimatedTokens += tokenEstimate;
      remainingBudget -= tokenEstimate;
    } else {
      // Need to truncate this file
      const truncated = truncateDiffSection(sectionContent, Math.min(fileBudget, remainingBudget));
      result.content += truncated + '\n\n';
      result.filesTruncated.push(priority.file.file);
      result.estimatedTokens += estimateTokens(truncated);
      remainingBudget -= estimateTokens(truncated);
    }
  }

  return result;
}

/**
 * Chunk surrounding code context.
 * Only includes context for high-priority files.
 */
export function chunkSurroundingContext(
  filesWithContext: FileWithContext[],
  highPriorityPaths: Set<string>,
  maxTokens: number,
): string {
  let budget = maxTokens;
  const sections: string[] = [];

  for (const fwc of filesWithContext) {
    if (!highPriorityPaths.has(fwc.path)) continue;
    if (budget <= 0) break;

    const relevantBlocks = fwc.surroundingContext.filter((b) => b.hasChanges);
    if (relevantBlocks.length === 0) continue;

    let fileSection = `### 文件: ${fwc.path} (完整上下文)\n\n`;
    const lang = detectLanguage(fwc.path);
    fileSection += '```' + lang + '\n';

    // Include imports if available (first few lines of fullContent)
    if (fwc.fullContent) {
      const imports = extractImports(fwc.fullContent);
      if (imports) {
        fileSection += '// imports（缩略）\n' + imports + '\n\n';
      }
    }

    for (const block of relevantBlocks) {
      fileSection += block.code + '\n';
    }

    fileSection += '```\n\n';

    const sectionTokens = estimateTokens(fileSection);
    if (sectionTokens <= budget) {
      sections.push(fileSection);
      budget -= sectionTokens;
    } else {
      // Truncate the least important blocks
      const essentialBlocks = relevantBlocks.slice(0, Math.ceil(relevantBlocks.length / 2));
      const truncatedSection = `### 文件: ${fwc.path} (部分上下文 — 预算限制)\n\n` +
        '```' + lang + '\n' +
        essentialBlocks.map((b) => b.code).join('\n') +
        '\n// ... 额外 ' + (relevantBlocks.length - essentialBlocks.length) + ' 个代码块被省略 (token 预算限制)\n' +
        '```\n\n';
      sections.push(truncatedSection);
      break;
    }
  }

  return sections.join('');
}

// ─── Diff helpers ─────────────────────────────────────────────────────

/**
 * Split unified diff into per-file sections.
 */
function splitDiffByFile(diff: string): Map<string, string> {
  const sections = new Map<string, string>();
  const filePattern = /^diff --git a\/(.+) b\/(.+)$/gm;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let currentFile = '';
  let currentStart = 0;

  while ((match = filePattern.exec(diff)) !== null) {
    // Save previous section
    if (currentFile && currentStart > 0) {
      sections.set(currentFile, diff.slice(currentStart, match.index).trim());
    }
    currentFile = match[2]; // New file path (b/)
    currentStart = match.index;
  }

  // Save last section
  if (currentFile && currentStart > 0) {
    sections.set(currentFile, diff.slice(currentStart).trim());
  }

  return sections;
}

/**
 * Truncate a single file's diff section intelligently.
 * Keeps diff header and as many hunks as possible.
 */
function truncateDiffSection(section: string, maxTokens: number): string {
  const lines = section.split('\n');
  const headerLines: string[] = [];
  const hunks: string[][] = [];
  let currentHunk: string[] = [];

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (currentHunk.length > 0) {
        hunks.push(currentHunk);
        currentHunk = [];
      }
      currentHunk.push(line);
    } else if (line.startsWith('diff --git') || line.startsWith('---') || line.startsWith('+++')) {
      headerLines.push(line);
    } else {
      currentHunk.push(line);
    }
  }
  if (currentHunk.length > 0) hunks.push(currentHunk);

  // Always include header
  let result = headerLines.join('\n') + '\n';
  let currentTokens = estimateTokens(result);

  for (let i = 0; i < hunks.length; i++) {
    const hunkText = hunks[i].join('\n');
    const hunkTokens = estimateTokens(hunkText);
    if (currentTokens + hunkTokens <= maxTokens) {
      result += hunkText + '\n';
      currentTokens += hunkTokens;
    } else {
      // Collapse remaining hunks
      result += `\n// ... ${hunks.length - i} 个 hunk 被截断 (超出 token 预算)\n`;
      break;
    }
  }

  return result;
}

// ─── Language & import helpers ────────────────────────────────────────

function detectLanguage(path: string): string {
  const extMap: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.rb': 'ruby', '.php': 'php',
    '.cs': 'csharp', '.swift': 'swift', '.kt': 'kotlin',
    '.sql': 'sql', '.sh': 'bash', '.yaml': 'yaml',
    '.yml': 'yaml', '.json': 'json', '.md': 'markdown',
    '.css': 'css', '.scss': 'scss', '.html': 'html',
  };

  const ext = path.slice(path.lastIndexOf('.'));
  return extMap[ext] || '';
}

function extractImports(fullContent: string): string | null {
  const lines = fullContent.split('\n');
  const importLines = lines.filter(
    (l) => l.trim().startsWith('import ') || l.trim().startsWith('from ') || l.trim().startsWith('require('),
  );
  if (importLines.length === 0) return null;
  if (importLines.length <= 15) return importLines.join('\n');
  return importLines.slice(0, 15).join('\n') + `\n// ... 还有 ${importLines.length - 15} 个 import`;
}
