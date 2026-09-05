/**
 * AI 驱动的相关文件检索（RAG 核心）
 *
 * 使用轻量级 AI 模型扫描整个仓库的文件树，
 * 找出与 PR 变更在语义上相关的文件——即人类审查者在评估变更影响时想要查看的文件。
 *
 * 这模拟了资深审查者的做法："对 token 校验函数的这个改动……哪个中间件在调用它？测试有更新吗？"
 */

import type { PRInfo, CommitInfo, FileChange, RelatedFile, AIRetrievalResult } from '@/types/analysis';
import { getBestAvailableModel, getProviderForModel } from '@/lib/models';
import { fetchFileContent } from '@/lib/github';
import { findBlockStarts } from './full-files';

/**
 * 检索步骤的配置。
 */
export interface RelatedFilesConfig {
  /** 返回的相关文件最大数量 */
  maxFiles: number;
  /** 是否抓取相关文件的完整内容 */
  fetchContent: boolean;
  /** GitHub API 调用所需的 owner/repo */
  owner: string;
  repo: string;
  /** 文件抓取所用的 Git ref */
  headSha: string;
}

const DEFAULT_CONFIG: Partial<RelatedFilesConfig> = {
  maxFiles: 12,
  fetchContent: true,
};

/**
 * 主入口：使用 AI 查找相关文件，然后抓取其内容。
 *
 * @returns 已填充内容的 RelatedFile[]
 */
export async function findRelatedFiles(
  prInfo: PRInfo,
  changedFiles: FileChange[],
  commits: CommitInfo[],
  repoStructure: string[],
  config: RelatedFilesConfig,
): Promise<RelatedFile[]> {
  // 第 1 步：构建检索提示词
  const prompt = buildRetrievalPrompt(prInfo, changedFiles, commits, repoStructure);

  // 第 2 步：调用轻量级 AI 进行文件选择
  const rawResult = await callRetrievalModel(prompt);

  if (!rawResult || rawResult.relatedFiles.length === 0) {
    return [];
  }

  // 第 3 步：与变更文件去重
  const changedPaths = new Set(changedFiles.map((f) => f.file));
  const uniqueResults = rawResult.relatedFiles
    .filter((f) => !changedPaths.has(f.path))
    .slice(0, config.maxFiles);

  // 第 4 步：抓取相关文件内容（如已配置）
  if (!config.fetchContent) {
    return uniqueResults.map((r) => ({
      path: r.path,
      reason: r.reason,
      relevance: r.relevance,
      content: null,
      relevantSections: [],
    }));
  }

  const withContent = await fetchRelatedFileContents(
    uniqueResults,
    config.owner,
    config.repo,
    config.headSha,
    changedFiles,
  );

  return withContent;
}

// ─── 构建检索提示词 ──────────────────────────────────────────────────

function buildRetrievalPrompt(
  prInfo: PRInfo,
  changedFiles: FileChange[],
  commits: CommitInfo[],
  repoStructure: string[],
): string {
  const changedFileList = changedFiles
    .map((f) => `- ${f.file} (${f.status}: +${f.additions}/-${f.deletions})`)
    .join('\n');

  const commitSummary = commits
    .slice(0, 15)
    .map((c) => `- ${c.message.split('\n')[0].slice(0, 100)}`)
    .join('\n');

  // 对大型仓库（> 5000 个文件）截断仓库结构
  const truncatedTree =
    repoStructure.length > 5000
      ? [
          ...repoStructure.slice(0, 1000),
          `... (省略 ${repoStructure.length - 2000} 个文件) ...`,
          ...repoStructure.slice(-1000),
        ]
      : repoStructure;

  const treeStr = truncatedTree.join('\n');

  return `你是一个代码架构专家。以下是一个 PR 的信息，请找出仓库中与本次变更最相关的文件。

## PR 信息
- 标题：${prInfo.title}
- 描述：${prInfo.body ? prInfo.body.slice(0, 1500) : '（无描述）'}
${prInfo.baseBranch ? `- 目标分支：${prInfo.baseBranch}` : ''}

## 变更文件（共 ${changedFiles.length} 个）
${changedFileList}

## Commit 消息
${commitSummary || '（无 commit 信息）'}

## 仓库文件树（共 ${repoStructure.length} 个文件）
\`\`\`
${treeStr}
\`\`\`

## 任务
从仓库文件树中，找出与本次 PR 最相关的文件（**不包括上面已列出的变更文件**）。

相关性判断标准（按优先级排序）：
1. **调用方（最重要）**：可能调用了变更文件中导出函数/类/接口的文件。根据文件路径和命名推断调用关系。
2. **被依赖方**：变更文件依赖的核心模块、基类、接口定义、工具函数
3. **测试文件**：与变更文件对应的测试文件（命名惯例：src/foo/bar.ts → tests/foo/bar.test.ts 或 src/foo/__tests__/bar.test.ts）
4. **同模块文件**：与变更文件在同一目录或相邻目录、功能紧密相关的文件
5. **配置文件**：与变更相关的配置（如 package.json, tsconfig.json, .eslintrc.*）

## 输出格式
返回严格 JSON，最多${DEFAULT_CONFIG.maxFiles}个文件，按相关性从高到低排序：

{
  "relatedFiles": [
    {
      "path": "src/middleware/authMiddleware.ts",
      "reason": "调用了 login.ts 的 validateToken，变更可能影响其行为",
      "relevance": "high"
    }
  ]
}

规则：
- path 必须是仓库文件树中存在的路径
- reason 用中文简短说明（20字以内）
- relevance: high（直接调用/被调用关系）, medium（同模块/配置）, low（可能相关）
- 只返回 JSON，不要任何其他文字`;
}

// ─── AI 调用 ──────────────────────────────────────────────────────────

async function callRetrievalModel(prompt: string): Promise<AIRetrievalResult | null> {
  try {
    // 使用最便宜的可用模型进行检索
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
      temperature: 0, // 确定性：相同的 PR → 相同的结果
      maxTokens: 2048,
    });

    const parsed = parseRetrievalResponse(result.content);
    return parsed;
  } catch (error) {
    console.error('Related file retrieval failed:', error);
    return null; // 非关键——优雅降级
  }
}

function parseRetrievalResponse(content: string): AIRetrievalResult | null {
  try {
    let jsonStr = content.trim();

    // 去除 markdown 代码围栏
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    // 提取第一个 JSON 对象
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

// ─── 内容抓取 ─────────────────────────────────────────────────────────

/**
 * 抓取 AI 识别的相关文件的完整内容。
 * 使用现有的函数边界检测仅提取最相关的代码片段，以保持上下文聚焦。
 */
async function fetchRelatedFileContents(
  aiResults: { path: string; reason: string; relevance: 'high' | 'medium' | 'low' }[],
  owner: string,
  repo: string,
  headSha: string,
  changedFiles: FileChange[],
): Promise<RelatedFile[]> {
  const changedPaths = new Set(changedFiles.map((f) => f.file));

  // 并行抓取——每批 8 个以避免触发速率限制
  const BATCH_SIZE = 8;
  const results: RelatedFile[] = [];

  for (let i = 0; i < aiResults.length; i += BATCH_SIZE) {
    const batch = aiResults.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          // 跳过实际为变更文件的内容（安全检查）
          if (changedPaths.has(item.path)) return null;

          const content = await fetchFileContent(owner, repo, item.path, headSha);
          if (!content) return null;

          // 根据文件的角色提取相关片段
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

// ─── 智能片段提取 ─────────────────────────────────────────────────────

/**
 * 从相关文件中提取最相关的代码片段。
 * 提取内容取决于文件为何相关：
 * - Caller（调用方）：找到引用变更符号的函数
 * - Dependency（依赖方）：找到导出的 interface/class/函数
 * - Test（测试）：找到与变更函数相关的测试用例
 * - Config（配置）：返回相关的配置片段
 */
function extractRelevantSections(
  content: string,
  filePath: string,
  reason: string,
  changedFiles: FileChange[],
): RelatedFile['relevantSections'] {
  const lines = content.split('\n');
  const blocks = findBlockStarts(lines, filePath);

  // 策略：对于较小的文件（< 200 行）包含所有顶层代码块，
  // 但面对更大的文件则要有所选择
  const isSmallFile = lines.length <= 200;

  if (isSmallFile) {
    // 小文件包含全部内容——都是相关的上下文
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

  // 对于更大的文件，尝试找到引用了变更符号的函数
  const changedSymbols = extractChangedSymbols(changedFiles);
  const relevantBlocks = blocks.filter((b) => {
    const blockLines = lines.slice(b.startLine - 1, findBlockEnd(lines, b.startLine, b.type));
    const blockText = blockLines.join('\n');
    return changedSymbols.some((sym) => blockText.includes(sym));
  });

  // 若未找到匹配的符号，则返回前 5 个代码块作为代表
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
 * 启发式方法：提取 PR 中发生改动的函数/类名。
 * 用于在相关文件中查找对这些符号的引用。
 */
function extractChangedSymbols(changedFiles: FileChange[]): string[] {
  const symbols: string[] = [];

  for (const fc of changedFiles) {
    const fileName = fc.file.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    symbols.push(fileName);

    // 同时根据文件名检查常见的导出模式
    const camelName = fileName.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
    symbols.push(camelName);

    const pascalName = camelName.charAt(0).toUpperCase() + camelName.slice(1);
    symbols.push(pascalName);
  }

  return [...new Set(symbols)];
}

/**
 * 查找代码块的结束行（匹配的花括号或下一个代码块的起始位置）。
 */
function findBlockEnd(lines: string[], startLine: number, type: string): number {
  // 简单启发式：查找下一个代码块的起始位置或文件末尾
  // 对于类似 Python（基于缩进）的语言，查找缩进回退
  const lang = detectLanguageFromPath('');
  const isPython = false; // 简化——可根据文件扩展名来确定

  let braceDepth = 0;
  let started = false;

  for (let i = startLine - 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // 跳过纯注释行和空行
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;

    // 统计花括号数量
    for (const ch of trimmed) {
      if (ch === '{') { braceDepth++; started = true; }
      if (ch === '}') { braceDepth--; }
    }

    // 若已开始且回到深度 0，即找到结束位置
    if (started && braceDepth === 0 && trimmed.endsWith('}')) {
      return i + 1;
    }

    // 若深度为 1 但在下一行变为 0
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
