/**
 * Context module — barrel export.
 */

export { collectContext, collectQuickContext, collectStandardContext, collectDeepContext, logContextStats } from './collector';
export type { CollectionOptions } from './collector';

export { prioritizeFiles, scoreFile, getTopFiles } from './prioritizer';
export type { FilePriority } from './prioritizer';

export { chunkDiffContent, chunkSurroundingContext } from './chunker';
export type { ChunkingOptions, ChunkResult } from './chunker';

export { formatContext } from './formatter';
export type { FormattedContext } from './formatter';

export { estimateTokens, estimateTotalTokens, createBudget, canFit, allocate, usagePercent } from './token-counter';
export type { TokenBudget } from './token-counter';

export { extractImports, resolveImportPath, buildDependencyGraph } from './sources/dependencies';
export { extractSurroundingContext } from './sources/full-files';
export { findRelatedFiles } from './sources/related-files';
export type { RelatedFilesConfig } from './sources/related-files';
