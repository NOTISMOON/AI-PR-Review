/**
 * Context Formatter — formats collected context into LLM-consumable message blocks.
 *
 * The output is structured into clearly delimited sections with markdown formatting
 * that helps the model parse and understand the different context types.
 */

import type {
  PRInfo, FileChange, CommitInfo, DependencyGraph,
  FileWithContext, CollectedContext, RelatedFile,
} from '@/types/analysis';
import type { TokenBudget } from './token-counter';
import { estimateTokens } from './token-counter';

export interface FormattedContext {
  systemPrompt: string;
  userMessage: string;
  estimatedInputTokens: number;
  usedBudget: TokenBudget;
}

/**
 * Format the full collected context into a user message for the LLM.
 * Uses clear section headers and code fences to help the model parse the structure.
 */
export function formatContext(
  collected: CollectedContext,
  systemPrompt: string,
  budget: TokenBudget,
): FormattedContext {
  const sections: string[] = [];

  // ═══ Tier 1: Always include ═══
  sections.push(formatPRMetadata(collected.prInfo, collected.fileChanges));
  sections.push(formatCommitHistory(collected.commits));

  // ═══ Tier 2: Diff content (most of the budget) ═══
  const diffSection = formatDiff(collected.diff);
  sections.push(diffSection);

  // ═══ Tier 3: Supplementary context ═══
  const remainingAfterDiff = budget.remaining;

  // Dependency graph (if it fits)
  if (collected.dependencyGraph && collected.dependencyGraph.edges.length > 0) {
    const depSection = formatDependencyGraph(collected.dependencyGraph);
    if (estimateTokens(depSection) < remainingAfterDiff * 0.3) {
      sections.push(depSection);
    }
  }

  // Surrounding function context for high-priority files
  const contextSection = formatSurroundingContext(collected.filesWithContext);
  const contextTokens = estimateTokens(contextSection);
  if (contextTokens < remainingAfterDiff * 0.3) {
    sections.push(contextSection);
  } else if (contextTokens > 0) {
    // Include truncated version
    sections.push(formatSurroundingContext(collected.filesWithContext.slice(0, 10)));
  }

  // ═══ Tier 3.5: AI-Retrieved Related Files (RAG) ═══
  if (collected.relatedFiles && collected.relatedFiles.length > 0) {
    const relatedSection = formatRelatedFiles(collected.relatedFiles);
    const relatedTokens = estimateTokens(relatedSection);
    if (relatedTokens < remainingAfterDiff * 0.25) {
      sections.push(relatedSection);
    } else {
      // Include only high-relevance files
      const highOnly = collected.relatedFiles.filter((f) => f.relevance === 'high');
      if (highOnly.length > 0) {
        sections.push(formatRelatedFiles(highOnly));
      }
    }
  }

  // ═══ Tier 4: Optional ═══
  if (collected.prComments.length > 0) {
    const commentSection = formatPRComments(collected.prComments);
    if (estimateTokens(commentSection) < remainingAfterDiff * 0.1) {
      sections.push(commentSection);
    }
  }

  // Language configs
  if (Object.keys(collected.languageConfigs).length > 0) {
    const configSection = formatLanguageConfigs(collected.languageConfigs);
    if (estimateTokens(configSection) < remainingAfterDiff * 0.05) {
      sections.push(configSection);
    }
  }

  const userMessage = sections.join('\n\n---\n\n');
  const estimatedInputTokens = estimateTokens(systemPrompt) + estimateTokens(userMessage);

  return {
    systemPrompt,
    userMessage,
    estimatedInputTokens,
    usedBudget: { ...budget, allocated: estimatedInputTokens, remaining: budget.total - estimatedInputTokens },
  };
}

// ─── Individual formatters ────────────────────────────────────────────

function formatPRMetadata(prInfo: PRInfo, fileChanges: FileChange[]): string {
  const metadata = {
    title: prInfo.title,
    author: prInfo.author,
    branch: prInfo.branch,
    baseBranch: prInfo.baseBranch,
    filesChanged: prInfo.filesChanged,
    additions: prInfo.additions,
    deletions: prInfo.deletions,
    changedFiles: fileChanges.map((f) =>
      `${f.file} (${f.status}: +${f.additions}/-${f.deletions})`,
    ),
  };

  let section = '## PR 元数据\n\n```json\n';
  section += JSON.stringify(metadata, null, 2);
  section += '\n```\n';

  // Include PR description if available
  if (prInfo.body && prInfo.body.trim()) {
    // Truncate very long PR descriptions
    const desc = prInfo.body.length > 3000
      ? prInfo.body.slice(0, 3000) + '\n\n... (PR 描述过长，已截断)'
      : prInfo.body;
    section += `\n### PR 描述\n\n${desc}\n`;
  }

  return section;
}

function formatCommitHistory(commits: CommitInfo[]): string {
  if (commits.length === 0) return '## Commit 历史\n\n无 commit 信息。';

  let section = '## Commit 历史\n\n';
  section += '| SHA | 作者 | 日期 | 消息 |\n';
  section += '|-----|------|------|------|\n';

  for (const c of commits.slice(0, 50)) {
    // Truncate commit message to first line for table display
    const firstLine = c.message.split('\n')[0].slice(0, 80);
    section += `| ${c.sha} | ${c.author} | ${c.date.slice(0, 10)} | ${firstLine} |\n`;
  }

  if (commits.length > 50) {
    section += `\n... 还有 ${commits.length - 50} 个 commit 未显示。\n`;
  }

  return section;
}

function formatDiff(diff: string): string {
  const truncated = diff.length > 240000
    ? diff.slice(0, 240000) + '\n\n**警告：diff 内容过长，已截断至前 240,000 字符。可能存在遗漏。**'
    : diff;

  return '## Git Diff\n\n```diff\n' + truncated + '\n```';
}

function formatDependencyGraph(graph: DependencyGraph): string {
  if (!graph || graph.edges.length === 0) {
    return '## 文件依赖关系\n\n无法获取依赖关系信息。';
  }

  let section = '## 文件依赖关系\n\n';

  // Group edges by source file
  const bySource = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const deps = bySource.get(edge.from) || [];
    deps.push(edge.to);
    bySource.set(edge.from, deps);
  }

  for (const [source, deps] of bySource) {
    const uniqueDeps = [...new Set(deps)];
    section += `- **${source}** → depends on: [${uniqueDeps.join(', ')}]\n`;
  }

  if (graph.externalDependents.length > 0) {
    section += '\n### 外部依赖（不在变更列表中的文件依赖了变更文件）\n\n';
    section += '以下文件不在本次 PR 变更中，但它们导入了变更文件，可能受接口变更影响：\n\n';
    for (const dep of graph.externalDependents) {
      section += `- ${dep}\n`;
    }
  }

  return section;
}

function formatSurroundingContext(filesWithContext: FileWithContext[]): string {
  if (filesWithContext.length === 0) return '';

  let section = '## 变更文件完整上下文\n\n';
  section += '以下展示变更代码所在函数/类的完整代码，帮助理解变更意图和影响。\n\n';

  for (const fwc of filesWithContext) {
    if (fwc.surroundingContext.length === 0) continue;

    const relevantBlocks = fwc.surroundingContext.filter((b) => b.hasChanges);
    if (relevantBlocks.length === 0) continue;

    const lang = detectLang(fwc.path);
    section += `### ${fwc.path}\n\n`;
    section += '```' + lang + '\n';

    for (const block of relevantBlocks) {
      if (block.hasChanges) {
        section += `// === ${block.type}: ${block.name} (L${block.startLine}-L${block.endLine}) — 包含变更 ===\n`;
      }
      section += block.code + '\n\n';
    }

    section += '```\n\n';
  }

  return section;
}

function formatPRComments(comments: { author: string; body: string; createdAt: string }[]): string {
  if (comments.length === 0) return '';

  let section = '## PR 讨论摘要\n\n';
  for (const c of comments.slice(0, 10)) {
    const truncated = c.body.length > 300 ? c.body.slice(0, 300) + '...' : c.body;
    section += `**${c.author}** (${c.createdAt.slice(0, 10)}): ${truncated}\n\n`;
  }

  if (comments.length > 10) {
    section += `\n... 还有 ${comments.length - 10} 条评论。\n`;
  }

  return section;
}

function formatLanguageConfigs(configs: Record<string, string>): string {
  if (Object.keys(configs).length === 0) return '';

  let section = '## 项目配置\n\n';
  for (const [path, content] of Object.entries(configs)) {
    section += `### ${path}\n\n`;
    // Truncate config files to 2000 chars
    const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n... (已截断)' : content;
    section += '```\n' + truncated + '\n```\n\n';
  }

  return section;
}

/**
 * Format AI-retrieved related files for the main analysis prompt.
 * These are files NOT in the PR change set but identified as relevant
 * by the RAG retrieval step. Presented as "context files" for reference.
 */
function formatRelatedFiles(relatedFiles: RelatedFile[]): string {
  if (relatedFiles.length === 0) return '';

  let section = '## 关联文件（仓库中与本次变更相关的文件，不在 PR 变更范围内）\n\n';
  section += '以下文件由 AI 检索确定为与本次变更相关。请审查时考虑这些文件的潜在影响：\n\n';

  // Group by relevance
  const high = relatedFiles.filter((f) => f.relevance === 'high');
  const medium = relatedFiles.filter((f) => f.relevance === 'medium');
  const low = relatedFiles.filter((f) => f.relevance === 'low');

  // Format high relevance first
  for (const file of [...high, ...medium, ...low]) {
    const relevanceLabel =
      file.relevance === 'high' ? '★★★ 高相关' :
      file.relevance === 'medium' ? '★★☆ 中相关' : '★☆☆ 可能相关';

    section += `### ${file.path} — ${relevanceLabel}\n`;
    section += `**相关原因**: ${file.reason}\n\n`;

    if (file.relevantSections.length > 0) {
      const lang = detectLang(file.path);
      section += '```' + lang + '\n';
      for (const sec of file.relevantSections.slice(0, 5)) {
        section += `// === ${sec.type}: ${sec.name} (L${sec.startLine}-L${sec.endLine}) ===\n`;
        section += sec.code + '\n\n';
      }
      if (file.relevantSections.length > 5) {
        section += `// ... 还有 ${file.relevantSections.length - 5} 个相关代码块\n`;
      }
      section += '```\n\n';
    } else if (file.content) {
      // Small file — include full content
      const truncated = file.content.length > 2000
        ? file.content.slice(0, 2000) + '\n// ... (文件过长，已截断)'
        : file.content;
      const lang = detectLang(file.path);
      section += '```' + lang + '\n' + truncated + '\n```\n\n';
    }
  }

  return section;
}

function detectLang(path: string): string {
  const ext = path.slice(path.lastIndexOf('.'));
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.go': 'go', '.rs': 'rust', '.java': 'java', '.sql': 'sql',
    '.css': 'css', '.html': 'html', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
  };
  return map[ext] || '';
}
