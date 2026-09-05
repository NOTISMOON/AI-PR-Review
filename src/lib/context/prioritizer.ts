/**
 * 上下文优先级排序器——根据相关性为文件打分，以决定上下文预算的分配。
 * 确保安全敏感和高影响力的文件获得更多的上下文预算。
 */

import type { FileChange } from '@/types/analysis';

/** 指示安全敏感代码的路径 */
const SECURITY_PATTERNS = [
  /auth/i, /login/i, /signup/i, /register/i, /crypto/i, /password/i,
  /secret/i, /token/i, /session/i, /cookie/i, /oauth/i, /jwt/i,
  /permission/i, /rbac/i, /acl/i, /payment/i, /billing/i, /transaction/i,
  /sql/i, /query/i, /db\//i, /database/i, /key/i, /cert/i, /ssl/i, /tls/i,
];

/** 通常可以安全跳过或降低优先级的路径 */
const LOW_PRIORITY_PATTERNS = [
  /\.test\./i, /\.spec\./i, /__tests__\//i, /__mocks__\//i,
  /\.md$/i, /\.txt$/i, /\.json$/i, /\.lock$/i, /\.yml$/i, /\.yaml$/i,
  /\.css$/i, /\.scss$/i, /\.less$/i, /\.svg$/i, /\.png$/i, /\.jpg$/i,
  /CHANGELOG/i, /LICENSE/i, /\.gitignore/i,
  /node_modules\//i, /dist\//i, /build\//i, /\.next\//i,
  /generated/i, /auto-generated/i,
];

/** 定义接口/契约的文件——这里的变更影响范围很广 */
const INTERFACE_PATTERNS = [
  /types?\//i, /interfaces?\//i, /\.d\.ts$/i, /schema/i, /model/i,
  /proto/i, /\.proto$/i, /graphql/i,
];

export interface FilePriority {
  file: FileChange;
  score: number;
  reasons: string[];
  /** 该文件在总上下文预算中应获得的百分比 */
  budgetShare: number;
}

/**
 * 计算文件的关联性得分。
 * 分数越高 = 越重要 = 获得更多上下文预算。
 */
export function scoreFile(file: FileChange): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  // 基础分数：文件大小（变更越多 = 越值得审查）
  const changeSize = file.additions + file.deletions;
  score += Math.log2(changeSize + 1) * 10;

  // 安全敏感路径获得大幅加分
  const isSensitive = SECURITY_PATTERNS.some((p) => p.test(file.file));
  if (isSensitive) {
    score += 50;
    reasons.push('安全敏感路径');
  }

  // 接口/类型文件——变更会影响许多消费者
  const isInterface = INTERFACE_PATTERNS.some((p) => p.test(file.file));
  if (isInterface) {
    score += 30;
    reasons.push('接口/类型定义');
  }

  // 降低文档、配置和测试文件的优先级
  const isLowPriority = LOW_PRIORITY_PATTERNS.some((p) => p.test(file.file));
  if (isLowPriority) {
    score -= 30;
    reasons.push('低优先级文件(文档/配置/测试)');
  }

  // 删除的文件需要的上下文较少（代码正在被移除）
  if (file.status === 'deleted') {
    score -= 10;
    reasons.push('已删除文件');
  }

  // 新增的文件可能需要完整审查
  if (file.status === 'added') {
    score += 15;
    reasons.push('新增文件');
  }

  // 相对删除而言大量新增的文件 = 大量新代码
  if (file.deletions === 0 && file.additions > 50) {
    score += 20;
    reasons.push('大量新增代码');
  }

  return { score, reasons };
}

/**
 * 按优先级对所有文件排序，并分配预算百分比。
 */
export function prioritizeFiles(fileChanges: FileChange[]): FilePriority[] {
  const scored = fileChanges.map((file) => {
    const { score, reasons } = scoreFile(file);
    return { file, score, reasons, budgetShare: 0 };
  });

  // 按分数降序排序
  scored.sort((a, b) => b.score - a.score);

  // 按正分数比例计算预算份额
  const totalPositive = scored.reduce((sum, f) => sum + Math.max(0, f.score), 0);
  if (totalPositive > 0) {
    for (const entry of scored) {
      entry.budgetShare = Math.max(0, entry.score) / totalPositive;
    }
  } else {
    // 回退策略：均分
    const share = 1 / scored.length;
    for (const entry of scored) {
      entry.budgetShare = share;
    }
  }

  return scored;
}
