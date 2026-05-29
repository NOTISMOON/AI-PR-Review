/**
 * Quality Heuristics — post-analysis quality checks.
 * Detects patterns that suggest issues with the AI output quality.
 */

import type { AnalysisOutput, ValidatedRisk, ValidatedReviewComment } from './schema';

export interface QualityReport {
  overallScore: number; // 0-100
  riskQuality: {
    hasDetailedDescriptions: boolean;
    avgDescriptionLength: number;
    hasCodeSnippets: boolean;
    severityDistribution: Record<string, number>;
  };
  commentQuality: {
    hasPositiveComments: boolean;
    hasSuggestionComments: boolean;
    hasConcernComments: boolean;
    typeDistribution: Record<string, number>;
  };
  flags: QualityFlag[];
}

export interface QualityFlag {
  type: 'missing_positive' | 'missing_suggestion' | 'all_same_severity' | 'vague_descriptions' | 'no_code_snippets';
  message: string;
  severity: 'info' | 'warning';
}

/**
 * Evaluate the overall quality of an AI analysis and flag potential issues.
 */
export function evaluateQuality(output: AnalysisOutput): QualityReport {
  const flags: QualityFlag[] = [];
  const riskQuality = analyzeRiskQuality(output.risks, flags);
  const commentQuality = analyzeCommentQuality(output.reviewComments, flags);

  // Calculate score
  let score = 70; // Base score

  if (riskQuality.hasDetailedDescriptions) score += 10;
  if (riskQuality.hasCodeSnippets) score += 5;
  if (commentQuality.hasPositiveComments && commentQuality.hasSuggestionComments) score += 10;
  if (commentQuality.hasConcernComments) score += 5;

  // Deductions for flags
  score -= flags.filter((f) => f.severity === 'warning').length * 10;
  score -= flags.filter((f) => f.severity === 'info').length * 3;

  return {
    overallScore: Math.max(0, Math.min(100, score)),
    riskQuality,
    commentQuality,
    flags,
  };
}

function analyzeRiskQuality(risks: ValidatedRisk[], flags: QualityFlag[]) {
  const descriptions = risks.map((r) => r.description);
  const avgLength = descriptions.length > 0
    ? descriptions.reduce((sum, d) => sum + d.length, 0) / descriptions.length
    : 0;

  const hasCodeSnippets = risks.every((r) => r.code.length > 0);
  const hasDetailedDescriptions = avgLength >= 30;

  const severityDistribution: Record<string, number> = {};
  for (const r of risks) {
    severityDistribution[r.severity] = (severityDistribution[r.severity] || 0) + 1;
  }

  if (!hasCodeSnippets) {
    flags.push({
      type: 'no_code_snippets',
      message: '部分风险项缺少代码片段 — 审查质量可能较低',
      severity: 'warning',
    });
  }

  if (!hasDetailedDescriptions) {
    flags.push({
      type: 'vague_descriptions',
      message: `风险描述平均长度仅 ${Math.round(avgLength)} 字 — 描述可能不够详细`,
      severity: 'info',
    });
  }

  // Check if all risks have the same severity (unlikely for well-calibrated analysis)
  const uniqueSeverities = Object.keys(severityDistribution);
  if (uniqueSeverities.length === 1 && risks.length > 2) {
    flags.push({
      type: 'all_same_severity',
      message: `所有 ${risks.length} 个风险均为 "${uniqueSeverities[0]}" 等级 — 严重程度可能需要重新校准`,
      severity: 'warning',
    });
  }

  return {
    hasDetailedDescriptions,
    avgDescriptionLength: Math.round(avgLength),
    hasCodeSnippets,
    severityDistribution,
  };
}

function analyzeCommentQuality(comments: ValidatedReviewComment[], flags: QualityFlag[]) {
  const typeDistribution: Record<string, number> = {};
  for (const c of comments) {
    typeDistribution[c.type] = (typeDistribution[c.type] || 0) + 1;
  }

  const hasPositiveComments = (typeDistribution['positive'] || 0) > 0;
  const hasSuggestionComments = (typeDistribution['suggestion'] || 0) > 0;
  const hasConcernComments = (typeDistribution['concern'] || 0) > 0;

  if (!hasPositiveComments) {
    flags.push({
      type: 'missing_positive',
      message: '审查意见中缺少正面反馈 — 建议至少包含 1 条积极评价',
      severity: 'info',
    });
  }

  if (!hasSuggestionComments) {
    flags.push({
      type: 'missing_suggestion',
      message: '审查意见中缺少改进建议 — 建议至少包含 1 条建设性建议',
      severity: 'warning',
    });
  }

  return {
    hasPositiveComments,
    hasSuggestionComments,
    hasConcernComments,
    typeDistribution,
  };
}
