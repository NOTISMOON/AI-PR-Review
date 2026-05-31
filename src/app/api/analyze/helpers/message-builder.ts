/**
 * Helper functions for building user messages for AI analysis
 */

import type { CollectedContext } from '@/types/analysis';

export async function buildUserMessage(
  collected: Awaited<ReturnType<any>>,
  effectiveDiff: string,
  diffTruncated: boolean,
): Promise<{ userMessage: string }> {
  let message = '';

  message += '## PR 元数据\n```json\n';
  message += JSON.stringify(
    {
      title: collected.prInfo.title,
      author: collected.prInfo.author,
      branch: collected.prInfo.branch,
      filesChanged: collected.prInfo.filesChanged,
      additions: collected.prInfo.additions,
      deletions: collected.prInfo.deletions,
    },
    null,
    2,
  );
  message += '\n```\n\n';

  if (collected.prInfo.body) {
    const description =
      collected.prInfo.body.length > 3000
        ? `${collected.prInfo.body.slice(0, 3000)}\n...(已截断)`
        : collected.prInfo.body;
    message += `### PR 描述\n\n${description}\n\n`;
  }

  if (collected.commits.length > 0) {
    message += '## Commit 历史\n\n';
    for (const commit of collected.commits.slice(0, 30)) {
      const firstLine = commit.message.split('\n')[0].slice(0, 80);
      message += `- \`${commit.sha}\` ${firstLine} (by ${commit.author})\n`;
    }
    message += '\n';
  }

  if (collected.dependencyGraph && collected.dependencyGraph.edges.length > 0) {
    message += '## 文件依赖关系\n\n';
    const bySource = new Map<string, string[]>();

    for (const edge of collected.dependencyGraph.edges) {
      const deps = bySource.get(edge.from) || [];
      deps.push(edge.to);
      bySource.set(edge.from, deps);
    }

    for (const [source, deps] of bySource) {
      message += `- **${source}** -> depends on: [${[...new Set(deps)].join(', ')}]\n`;
    }

    if (collected.dependencyGraph.externalDependents.length > 0) {
      message += `\n外部依赖: ${collected.dependencyGraph.externalDependents.join(', ')}\n`;
    }

    message += '\n';
  }

  if (collected.filesWithContext.length > 0) {
    const relevant = collected.filesWithContext.filter((file: any) =>
      file.surroundingContext.some((block: any) => block.hasChanges),
    );

    if (relevant.length > 0) {
      message += '## 变更文件上下文\n\n';
      for (const file of relevant.slice(0, 10)) {
        const changedBlocks = file.surroundingContext.filter((block: any) => block.hasChanges);
        if (changedBlocks.length === 0) {
          continue;
        }

        const language = file.path.slice(file.path.lastIndexOf('.') + 1);
        message += `### ${file.path}\n\n\`\`\`${language}\n`;
        for (const block of changedBlocks.slice(0, 3)) {
          message += `// === ${block.type}: ${block.name} (L${block.startLine}-L${block.endLine}) ===\n`;
          message += `${block.code}\n\n`;
        }
        message += '```\n\n';
      }
    }
  }

  if (collected.relatedFiles.length > 0) {
    message += '## 关联文件\n\n';
    const sorted = [...collected.relatedFiles].sort((a: any, b: any) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.relevance] - order[b.relevance];
    });

    for (const relatedFile of sorted) {
      message += `### ${relatedFile.path} - ${relatedFile.reason}\n\n`;
      if (relatedFile.relevantSections.length > 0) {
        const language = relatedFile.path.slice(relatedFile.path.lastIndexOf('.') + 1);
        message += `\`\`\`${language}\n`;
        for (const section of relatedFile.relevantSections.slice(0, 5)) {
          message += `// === ${section.type}: ${section.name} (L${section.startLine}-L${section.endLine}) ===\n`;
          message += `${section.code}\n\n`;
        }
        message += '```\n\n';
      } else if (relatedFile.content) {
        const truncated =
          relatedFile.content.length > 2000
            ? `${relatedFile.content.slice(0, 2000)}\n// ... (文件已截断)`
            : relatedFile.content;
        const language = relatedFile.path.slice(relatedFile.path.lastIndexOf('.') + 1);
        message += `\`\`\`${language}\n${truncated}\n\`\`\`\n\n`;
      }
    }
  }

  message += '## Git Diff\n\n';
  if (diffTruncated) {
    message += '**警告：diff 内容过长，已截断至前 240,000 字符。**\n\n';
  }
  message += `\`\`\`diff\n${effectiveDiff}\n\`\`\``;

  return { userMessage: message };
}
