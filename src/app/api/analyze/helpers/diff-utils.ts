/**
 * Helper functions for diff processing
 */

/**
 * Smart diff truncation - preserves complete file blocks
 */
export function truncateDiffSmart(diff: string, maxSize: number): { effectiveDiff: string; diffTruncated: boolean } {
  if (diff.length <= maxSize) {
    return { effectiveDiff: diff, diffTruncated: false };
  }

  // Find the last complete diff block before maxSize
  const lastFileHeader = diff.lastIndexOf('\ndiff --git', maxSize);

  if (lastFileHeader > 0) {
    return {
      effectiveDiff: diff.slice(0, lastFileHeader) + '\n\n... (remaining files truncated)',
      diffTruncated: true,
    };
  }

  // Fallback: simple truncation
  return {
    effectiveDiff: diff.slice(0, maxSize) + '\n\n... (truncated)',
    diffTruncated: true,
  };
}

export function buildCacheKey(owner: string, repo: string, prNumber: number, headSha: string, depth: string, reviewMode?: boolean) {
  const base = `analysis:${owner}:${repo}:${prNumber}:${headSha}:${depth}`;
  return reviewMode ? `${base}:review` : base;
}
