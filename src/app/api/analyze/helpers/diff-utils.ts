/**
 * diff 处理的辅助函数
 */

/**
 * 智能 diff 截断 — 保留完整的文件块
 */
export function truncateDiffSmart(diff: string, maxSize: number): { effectiveDiff: string; diffTruncated: boolean } {
  if (diff.length <= maxSize) {
    return { effectiveDiff: diff, diffTruncated: false };
  }

  // 在 maxSize 之前找到最后一个完整的 diff 文件块
  const lastFileHeader = diff.lastIndexOf('\ndiff --git', maxSize);

  if (lastFileHeader > 0) {
    return {
      effectiveDiff: diff.slice(0, lastFileHeader) + '\n\n... (remaining files truncated)',
      diffTruncated: true,
    };
  }

  // 兜底：简单截断
  return {
    effectiveDiff: diff.slice(0, maxSize) + '\n\n... (truncated)',
    diffTruncated: true,
  };
}

export function buildCacheKey(owner: string, repo: string, prNumber: number, headSha: string, depth: string) {
  return `analysis:${owner}:${repo}:${prNumber}:${headSha}:${depth}`;
}
