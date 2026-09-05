/**
 * 构建上下文快照的辅助函数
 */

import type { CollectedContext, AnalysisContextSnapshotData } from '@/types/analysis';

export function buildContextSnapshot(collected: CollectedContext, diffTruncated: boolean): AnalysisContextSnapshotData {
  return {
    diff: collected.diff,
    diffTruncated,
    commits: collected.commits,
    prComments: collected.prComments,
    repoStructure: collected.repoStructure,
    languageConfigs: collected.languageConfigs,
    dependencyGraph: collected.dependencyGraph,
    relatedFiles: collected.relatedFiles,
    filesWithContext: collected.filesWithContext,
  };
}
