/**
 * AI-Driven Related File Retrieval (RAG Core)
 *
 * Uses a lightweight AI model to scan the entire repository file tree
 * and identify files semantically related to the PR changes — files that
 * a human reviewer would want to look at when evaluating the impact.
 *
 * Two complementary inputs feed the retrieval:
 * 1. Static dependency graph → explicit import/require relationships (100% accurate)
 * 2. LLM semantic reasoning → implicit logical dependencies (covers DI, patterns, conventions)
 *
 * This mimics what a senior reviewer does: "This change to the token
 * validation function... which middleware calls it? Are the tests updated?"
 */

import type { PRInfo, CommitInfo, FileChange, RelatedFile, AIRetrievalResult } from '@/styles/types/analysis';
import { getBestAvailableModel, getProviderForModel } from '@/lib/models';
import { fetchFileContent } from '@/lib/github';
import { findBlockStarts } from './full-files';

/**
 * Configuration for the retrieval step.
 */
export interface RelatedFilesConfig {
  /** Maximum number of related files to return */
  maxFiles: number;
  /** Whether to fetch full content for related files */
  fetchContent: boolean;
  /** Owner/repo for GitHub API calls */
  owner: string;
  repo: string;
  /** Git ref for file fetching */
  headSha: string;
  /**
   * Known explicit dependency paths from static analysis (e.g. import/require).
   * These are used as high-priority hints for the LLM and also matched against
   * the repo structure to directly include verified matches.
   */
  explicitDepPaths?: string[];
}

const DEFAULT_CONFIG: Partial<RelatedFilesConfig> = {
  maxFiles: 12,
  fetchContent: true,
};

/**
 * Main entry point: find related files using AI, then fetch their content.
 *
 * Pipeline:
 * 1. Resolve explicit dependency hints against repo structure (direct includes)
 * 2. Build retrieval prompt with dependency hints baked in
 * 3. Call lightweight AI for semantic file selection
 * 4. Merge explicit matches + AI results, deduplicate, fetch content
 *
 * @returns RelatedFile[] with content populated
 */
export async function findRelatedFiles(
  prInfo: PRInfo,
  changedFiles: FileChange[],
  commits: CommitInfo[],
  repoStructure: string[],
  config: RelatedFilesConfig,
): Promise<RelatedFile[]> {
  const changedPaths = new Set(changedFiles.map((f) => f.file));

  // Step 1: Resolve explicit dependency hints against repo structure.
  // These are files that the static dependency graph already confirmed are
  // related — no AI guessing needed. We include them directly.
  const resolvedExplicit = resolveExplicitDeps(
    config.explicitDepPaths ?? [],
    repoStructure,
    changedPaths,
  );

  // Step 2: Build the retrieval prompt with explicit deps as priority hints
  const prompt = buildRetrievalPrompt(
    prInfo,
    changedFiles,
    commits,
    repoStructure,
    config.explicitDepPaths ?? [],
    resolvedExplicit.map((r) => r.path),
  );

  // Step 3: Call lightweight AI for semantic file selection
  const rawResult = await callRetrievalModel(prompt);

  // Step 4: Merge explicit matches + AI semantic results
  let combinedResults: { path: string; reason: string; relevance: 'high' | 'medium' | 'low' }[] = [
    ...resolvedExplicit,
  ];

  if (rawResult && rawResult.relatedFiles.length > 0) {
    const explicitPaths = new Set(resolvedExplicit.map((r) => r.path));
    const aiResults = rawResult.relatedFiles
      .filter((f) => !changedPaths.has(f.path) && !explicitPaths.has(f.path))
      .slice(0, config.maxFiles);
    combinedResults = [...combinedResults, ...aiResults];
  }

  // Cap at maxFiles
  combinedResults = combinedResults.slice(0, config.maxFiles);

  if (combinedResults.length === 0) {
    return [];
  }

  // Step 5: Fetch content for related files (if configured)
  if (!config.fetchContent) {
    return combinedResults.map((r) => ({
      path: r.path,
      reason: r.reason,
      relevance: r.relevance,
      content: null,
      relevantSections: [],
    }));
  }

  const withContent = await fetchRelatedFileContents(
    combinedResults,
    config.owner,
    config.repo,
    config.headSha,
    changedFiles,
  );

  return withContent;
}

// ─── Explicit Dependency Resolution ────────────────────────────────────

/**
 * Match static-analysis dependency paths (e.g. "../utils/helper", "./types/user")
 * against the actual repo file tree to find concrete file paths.
 *
 * Strategy: use the last path segment as a fuzzy key — if a repo file ends
 * with the same name segment, it's very likely the same file.
 */
function resolveExplicitDeps(
  depPaths: string[],
  repoStructure: string[],
  changedPaths: Set<string>,
): { path: string; reason: string; relevance: 'high' }[] {
  const results: { path: string; reason: string; relevance: 'high' }[] = [];
  const seen = new Set<string>();

  for (const dep of depPaths) {
    // Extract the meaningful part: last segment of the import path
    const segments = dep.replace(/\\/g, '/').split('/').filter(Boolean);
    const keySegment = segments[segments.length - 1];

    if (!keySegment || keySegment === '.' || keySegment === '..') continue;

    // Try exact suffix match against repo files
    for (const repoPath of repoStructure) {
      if (changedPaths.has(repoPath) || seen.has(repoPath)) continue;

      const repoFileName = repoPath.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
      const repoDir = repoPath.split('/').slice(0, -1).join('/');

      // Match: file name matches AND directory path overlaps
      const dirMatch = segments.length >= 2
        ? repoDir.endsWith(segments.slice(0, -1).join('/')) || repoDir.includes(segments.slice(0, -1).join('/'))
        : true;

      if (repoFileName === keySegment && dirMatch) {
        results.push({
          path: repoPath,
          reason: '显式依赖（静态分析）',
          relevance: 'high',
        });
        seen.add(repoPath);
        break; // One match per dep path
      }
    }
  }

  return results;
}

// ─── Prompt Building ──────────────────────────────────────────────────

function buildRetrievalPrompt(
  prInfo: PRInfo,
  changedFiles: FileChange[],
  commits: CommitInfo[],
  repoStructure: string[],
  explicitDepPaths: string[],
  resolvedExplicitPaths: string[],
): string {
  const changedFileList = changedFiles
    .map((f) => `- ${f.file} (${f.status}: +${f.additions}/-${f.deletions})`)
    .join('\n');

  const commitSummary = commits
    .slice(0, 15)
    .map((c) => `- ${c.message.split('\n')[0].slice(0, 100)}`)
    .join('\n');

  // Truncate repo structure for large repos (> 5000 files)
  const truncatedTree =
    repoStructure.length > 5000
      ? [
          ...repoStructure.slice(0, 1000),
          `... (省略 ${repoStructure.length - 2000} 个文件) ...`,
          ...repoStructure.slice(-1000),
        ]
      : repoStructure;

  const treeStr = truncatedTree.join('\n');

  // Build explicit dependency hints section
  let explicitHintsSection = '';
  if (explicitDepPaths.length > 0 && resolvedExplicitPaths.length > 0) {
    explicitHintsSection = `
## 已知显式依赖（静态分析 — 100% 准确，已自动纳入）

以下文件通过 import/require 被变更文件直接依赖，已自动标记为高优先级相关文件：

${resolvedExplicitPaths.map((p) => `- ${p}`).join('\n')}

> 导入路径: ${explicitDepPaths.slice(0, 10).join(', ')}${explicitDepPaths.length > 10 ? ` ... 等共 ${explicitDepPaths.length} 条` : ''}
> 请以上述文件为种子，从仓库文件树中**补充发现以下类型的隐式关联文件**（不要重复上述已自动纳入的文件）：
`;
  }

  return `你是一个代码架构专家。以下是一个 PR 的信息，请找出仓库中与本次变更最相关的文件。

## PR 信息
- 标题：${prInfo.title}
- 描述：${prInfo.body ? prInfo.body.slice(0, 1500) : '（无描述）'}
${prInfo.baseBranch ? `- 目标分支：${prInfo.baseBranch}` : ''}

## 变更文件（共 ${changedFiles.length} 个）
${changedFileList}

## Commit 消息
${commitSummary || '（无 commit 信息）'}
${explicitHintsSection}
## 仓库文件树（共 ${repoStructure.length} 个文件）
\`\`\`
${treeStr}
\`\`\`

## 任务
从仓库文件树中，找出与本次 PR 最相关的文件（**不包括上面已列出的变更文件和已自动纳入的显式依赖文件**）。

相关性判断标准（按优先级排序）：
1. **隐式调用方**：虽然没有直接 import，但通过 DI 注入、反射、中间件链、事件系统等间接调用了变更文件中的逻辑
2. **被依赖方**：变更文件依赖的核心模块、基类、接口定义、工具函数（如果静态分析漏掉了某些）
3. **测试文件**：与变更文件对应的测试文件（命名惯例：src/foo/bar.ts → tests/foo/bar.test.ts 或 src/foo/__tests__/bar.test.ts）
4. **同模块文件**：与变更文件在同一目录或相邻目录、功能紧密相关的文件
5. **配置文件**：与变更相关的配置（如 package.json, tsconfig.json, .eslintrc.*）

## 输出格式
返回严格 JSON，最多${DEFAULT_CONFIG.maxFiles}个文件，按相关性从高到低排序：

{
  "relatedFiles": [
    {
      "path": "src/middleware/authMiddleware.ts",
      "reason": "通过中间件链间接调用 login.ts",
      "relevance": "high"
    }
  ]
}

规则：
- path 必须是仓库文件树中存在的路径
- reason 用中文简短说明（20字以内）
- relevance: high（直接调用/被调用关系）, medium（同模块/配置）, low（可能相关）
- **不要重复已自动纳入的显式依赖文件**
- 只返回 JSON，不要任何其他文字`;
}

// ─── AI Call ──────────────────────────────────────────────────────────

async function callRetrievalModel(prompt: string): Promise<AIRetrievalResult | null> {
  try {
    // Use the cheapest available model for retrieval
    const model = getBestAvailableModel('fast') || getBestAvailableModel('primary');
    if (!model) {
      console.warn('No AI model available for related file retrieval');
      return null;
    }

    const provider = getProviderForModel(model);
    const result = await provider.analyze({
      systemPrompt:
        '你是一个代码架构专家。你的任务是分析 PR 变更，从仓库文件树中找出相关文件。只返回 JSON，不要任何其他内容。',
      userMessage: prompt,
      temperature: 0, // Deterministic: same PR → same results
      maxTokens: 2048,
    });

    const parsed = parseRetrievalResponse(result.content);
    return parsed;
  } catch (error) {
    console.error('Related file retrieval failed:', error);
    return null; // Non-critical — graceful degradation
  }
}

function parseRetrievalResponse(content: string): AIRetrievalResult | null {
  try {
    let jsonStr = content.trim();

    // Strip markdown fences
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    // Extract first JSON object
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed.relatedFiles)) return null;

    return {
      relatedFiles: parsed.relatedFiles.map((f: any) => ({
        path: String(f.path || ''),
        reason: String(f.reason || ''),
        relevance: ['high', 'medium', 'low'].includes(f.relevance) ? f.relevance : 'medium',
      })),
    };
  } catch {
    return null;
  }
}

// ─── Content Fetching ─────────────────────────────────────────────────

/**
 * Fetch full content for AI-identified related files.
 * Extracts only the most relevant code sections using existing function
 * boundary detection, to keep context focused.
 */
async function fetchRelatedFileContents(
  aiResults: { path: string; reason: string; relevance: 'high' | 'medium' | 'low' }[],
  owner: string,
  repo: string,
  headSha: string,
  changedFiles: FileChange[],
): Promise<RelatedFile[]> {
  const changedPaths = new Set(changedFiles.map((f) => f.file));

  // Parallel fetch — batch of 8 to avoid rate limits
  const BATCH_SIZE = 8;
  const results: RelatedFile[] = [];

  for (let i = 0; i < aiResults.length; i += BATCH_SIZE) {
    const batch = aiResults.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          // Skip if it's actually a changed file (safety check)
          if (changedPaths.has(item.path)) return null;

          const content = await fetchFileContent(owner, repo, item.path, headSha);
          if (!content) return null;

          // Extract relevant sections based on the file's role
          const sections = extractRelevantSections(
            content,
            item.path,
            item.reason,
            changedFiles,
          );

          return {
            path: item.path,
            reason: item.reason,
            relevance: item.relevance,
            content,
            relevantSections: sections,
          } as RelatedFile;
        } catch {
          return null;
        }
      }),
    );

    results.push(...batchResults.filter((r): r is RelatedFile => r !== null));
  }

  return results;
}

// ─── Smart Section Extraction ─────────────────────────────────────────

/**
 * Extract the most relevant code sections from a related file.
 * What we extract depends on why the file is related:
 * - Caller: find functions that reference changed symbols
 * - Dependency: find the exported interface/class/functions
 * - Test: find test cases related to changed functions
 * - Config: return relevant config sections
 */
function extractRelevantSections(
  content: string,
  filePath: string,
  reason: string,
  changedFiles: FileChange[],
): RelatedFile['relevantSections'] {
  const lines = content.split('\n');
  const blocks = findBlockStarts(lines, filePath);

  // Strategy: include all top-level blocks for smaller files (< 200 lines),
  // but be selective for larger files
  const isSmallFile = lines.length <= 200;

  if (isSmallFile) {
    // For small files, include everything — it's all relevant context
    return blocks.slice(0, 10).map((b) => {
      const endLine = findBlockEnd(lines, b.startLine, b.type);
      return {
        type: b.type,
        name: b.name,
        code: lines.slice(b.startLine - 1, endLine).join('\n'),
        startLine: b.startLine,
        endLine,
      };
    });
  }

  // For larger files, try to find functions that reference changed symbols
  const changedSymbols = extractChangedSymbols(changedFiles);
  const relevantBlocks = blocks.filter((b) => {
    const blockLines = lines.slice(b.startLine - 1, findBlockEnd(lines, b.startLine, b.type));
    const blockText = blockLines.join('\n');
    return changedSymbols.some((sym) => blockText.includes(sym));
  });

  // If no symbol matches found, return first 5 blocks as representative
  const selectedBlocks = relevantBlocks.length > 0
    ? relevantBlocks.slice(0, 8)
    : blocks.slice(0, 5);

  return selectedBlocks.map((b) => {
    const endLine = findBlockEnd(lines, b.startLine, b.type);
    return {
      type: b.type,
      name: b.name,
      code: lines.slice(b.startLine - 1, endLine).join('\n'),
      startLine: b.startLine,
      endLine,
    };
  });
}

/**
 * Heuristic: extract function/class names that were modified in the PR.
 * Used to find references to those symbols in related files.
 */
function extractChangedSymbols(changedFiles: FileChange[]): string[] {
  const symbols: string[] = [];

  for (const fc of changedFiles) {
    const fileName = fc.file.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    symbols.push(fileName);

    // Also check for common export patterns from the filename
    const camelName = fileName.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
    symbols.push(camelName);

    const pascalName = camelName.charAt(0).toUpperCase() + camelName.slice(1);
    symbols.push(pascalName);
  }

  return [...new Set(symbols)];
}

/**
 * Find the end line of a code block (matching brace or next block start).
 */
function findBlockEnd(lines: string[], startLine: number, type: string): number {
  // Simple heuristic: find the next block start or EOF
  // For Python-like (indentation-based), look for dedent
  const lang = detectLanguageFromPath('');
  const isPython = false; // Simplified — could be determined from file extension

  let braceDepth = 0;
  let started = false;

  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip comment-only and empty lines
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    // Count braces
    for (const ch of trimmed) {
      if (ch === '{') { braceDepth++; started = true; }
      if (ch === '}') { braceDepth--; }
    }

    // If we started and returned to depth 0, we found the end
    if (started && braceDepth === 0 && trimmed.endsWith('}')) {
      return i + 1;
    }

    // If depth was 1 but now 0 on next line
    if (started && braceDepth === 0 && i > startLine - 1) {
      return i + 1;
    }
  }

  return lines.length;
}

function detectLanguageFromPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'));
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.go': 'go', '.rs': 'rust',
  };
  return map[ext] || 'typescript';
}
