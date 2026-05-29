/**
 * Context Prioritizer — scores files by relevance to determine context budget allocation.
 * Ensures security-sensitive and high-impact files get more context budget.
 */

import type { FileChange } from '@/types/analysis';

/** Paths that indicate security-sensitive code */
const SECURITY_PATTERNS = [
  /auth/i, /login/i, /signup/i, /register/i, /crypto/i, /password/i,
  /secret/i, /token/i, /session/i, /cookie/i, /oauth/i, /jwt/i,
  /permission/i, /rbac/i, /acl/i, /payment/i, /billing/i, /transaction/i,
  /sql/i, /query/i, /db\//i, /database/i, /key/i, /cert/i, /ssl/i, /tls/i,
];

/** Paths that are typically safe to skip or de-prioritize */
const LOW_PRIORITY_PATTERNS = [
  /\.test\./i, /\.spec\./i, /__tests__\//i, /__mocks__\//i,
  /\.md$/i, /\.txt$/i, /\.json$/i, /\.lock$/i, /\.yml$/i, /\.yaml$/i,
  /\.css$/i, /\.scss$/i, /\.less$/i, /\.svg$/i, /\.png$/i, /\.jpg$/i,
  /CHANGELOG/i, /LICENSE/i, /\.gitignore/i,
  /node_modules\//i, /dist\//i, /build\//i, /\.next\//i,
  /generated/i, /auto-generated/i,
];

/** Files that define interfaces/contracts — changes here have wide impact */
const INTERFACE_PATTERNS = [
  /types?\//i, /interfaces?\//i, /\.d\.ts$/i, /schema/i, /model/i,
  /proto/i, /\.proto$/i, /graphql/i,
];

export interface FilePriority {
  file: FileChange;
  score: number;
  reasons: string[];
  /** Percentage of total context budget this file should receive */
  budgetShare: number;
}

/**
 * Calculate relevance score for a file.
 * Higher score = more important = more context budget.
 */
export function scoreFile(file: FileChange): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // Base: file size (more changes = more important to review)
  const changeSize = file.additions + file.deletions;
  score += Math.log2(changeSize + 1) * 10;

  // Security-sensitive paths get a big boost
  const isSensitive = SECURITY_PATTERNS.some((p) => p.test(file.file));
  if (isSensitive) {
    score += 50;
    reasons.push('安全敏感路径');
  }

  // Interface/type files — changes affect many consumers
  const isInterface = INTERFACE_PATTERNS.some((p) => p.test(file.file));
  if (isInterface) {
    score += 30;
    reasons.push('接口/类型定义');
  }

  // De-prioritize documentation, config, and test files
  const isLowPriority = LOW_PRIORITY_PATTERNS.some((p) => p.test(file.file));
  if (isLowPriority) {
    score -= 30;
    reasons.push('低优先级文件(文档/配置/测试)');
  }

  // Deleted files need less context (the code is being removed)
  if (file.status === 'deleted') {
    score -= 10;
    reasons.push('已删除文件');
  }

  // New files might need full review
  if (file.status === 'added') {
    score += 15;
    reasons.push('新增文件');
  }

  // Files with many additions relative to deletions = substantial new code
  if (file.deletions === 0 && file.additions > 50) {
    score += 20;
    reasons.push('大量新增代码');
  }

  return { score, reasons };
}

/**
 * Rank all files by priority and allocate budget percentages.
 */
export function prioritizeFiles(fileChanges: FileChange[]): FilePriority[] {
  const scored = fileChanges.map((file) => {
    const { score, reasons } = scoreFile(file);
    return { file, score, reasons, budgetShare: 0 };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Calculate budget shares proportional to positive scores
  const totalPositive = scored.reduce((sum, f) => sum + Math.max(0, f.score), 0);
  if (totalPositive > 0) {
    for (const entry of scored) {
      entry.budgetShare = Math.max(0, entry.score) / totalPositive;
    }
  } else {
    // Fallback: equal share
    const share = 1 / scored.length;
    for (const entry of scored) {
      entry.budgetShare = share;
    }
  }

  return scored;
}

/**
 * Get the top-N most important files, with a minimum budget share threshold.
 */
export function getTopFiles(
  priorities: FilePriority[],
  topN: number,
  minBudgetShare: number = 0.01,
): FilePriority[] {
  return priorities
    .filter((p) => p.budgetShare >= minBudgetShare)
    .slice(0, topN);
}
