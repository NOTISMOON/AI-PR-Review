/**
 * Consistency Validator — cross-field consistency checks on AI analysis results.
 * Catches issues that schema validation alone can't detect.
 */

import type { AnalysisOutput, ValidatedRisk } from './schema';
import type { FileChange } from '@/styles/types/analysis';

export interface ConsistencyIssue {
  type: 'file_not_in_changes' | 'duplicate_risk' | 'severity_mismatch' | 'suspicious_risk_count' | 'confidence_severity_gap';
  message: string;
  riskIds?: string[];
  severity?: 'warning' | 'error' | 'info';
}

/**
 * Run all consistency checks on the analysis output.
 */
export function checkConsistency(
  output: AnalysisOutput,
  fileChanges: FileChange[],
  diffSize: number,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  issues.push(...checkFilesExist(output.risks, fileChanges));
  issues.push(...checkDuplicates(output.risks));
  issues.push(...checkSeverityRiskLevelAlignment(output));
  issues.push(...checkRiskCountSanity(output, fileChanges.length, diffSize));
  issues.push(...checkConfidenceSeverityAlignment(output.risks));

  return issues;
}

/**
 * Verify that all referenced files exist in the PR's file change list.
 */
function checkFilesExist(risks: ValidatedRisk[], fileChanges: FileChange[]): ConsistencyIssue[] {
  const changedPaths = new Set(fileChanges.map((f) => f.file));
  const missingFiles = risks.filter((r) => !changedPaths.has(r.file));

  if (missingFiles.length > 0) {
    return [{
      type: 'file_not_in_changes',
      message: `${missingFiles.length} 个风险引用了不在变更列表中的文件: ${missingFiles.map((r) => r.file).join(', ')}`,
      riskIds: missingFiles.map((r) => r.id),
      severity: 'warning',
    }];
  }

  return [];
}

/**
 * Detect duplicate risks (same file + nearby line + similar title).
 */
function checkDuplicates(risks: ValidatedRisk[]): ConsistencyIssue[] {
  const duplicates: { id1: string; id2: string }[] = [];

  for (let i = 0; i < risks.length; i++) {
    for (let j = i + 1; j < risks.length; j++) {
      const a = risks[i];
      const b = risks[j];

      if (a.file === b.file && Math.abs(a.line - b.line) <= 5) {
        // Check title similarity (simple Jaccard-like overlap)
        const wordsA = new Set(a.title.toLowerCase().split(/\s+/));
        const wordsB = new Set(b.title.toLowerCase().split(/\s+/));
        const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
        const similarity = intersection.size / Math.max(wordsA.size, wordsB.size, 1);

        if (similarity > 0.5) {
          duplicates.push({ id1: a.id, id2: b.id });
        }
      }
    }
  }

  if (duplicates.length > 0) {
    const pairs = duplicates.map((d) => `${d.id1} ≈ ${d.id2}`).join(', ');
    return [{
      type: 'duplicate_risk',
      message: `检测到 ${duplicates.length} 对可能的重复风险: ${pairs}`,
      severity: 'info',
    }];
  }

  return [];
}

/**
 * Check that riskLevel aligns with individual severity scores.
 */
function checkSeverityRiskLevelAlignment(output: AnalysisOutput): ConsistencyIssue[] {
  const maxSeverity = output.risks.reduce((max, r) => {
    const order = { critical: 4, high: 3, medium: 2, low: 1 };
    return order[r.severity] > order[max] ? r.severity : max;
  }, 'low' as ValidatedRisk['severity']);

  const expectedRiskLevel =
    maxSeverity === 'critical' || maxSeverity === 'high' ? 'high' :
    maxSeverity === 'medium' ? 'medium' : 'low';

  if (output.riskLevel !== expectedRiskLevel && output.risks.length > 0) {
    return [{
      type: 'severity_mismatch',
      message: `总体风险等级 "${output.riskLevel}" 与最高单个风险等级 "${maxSeverity}" 不一致，建议使用 "${expectedRiskLevel}"`,
      severity: 'warning',
    }];
  }

  return [];
}

/**
 * Check if the number of risks is reasonable for the PR size.
 */
function checkRiskCountSanity(
  output: AnalysisOutput,
  fileCount: number,
  diffSize: number,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];

  // 0 risks on a large diff is suspicious
  if (output.risks.length === 0 && diffSize > 10000 && fileCount > 10) {
    issues.push({
      type: 'suspicious_risk_count',
      message: `大型 PR (${fileCount} 文件, ${(diffSize / 1024).toFixed(1)}KB diff) 未发现任何风险 — 可能存在漏报`,
      severity: 'warning',
    });
  }

  // Too many risks on a tiny change is also suspicious
  if (output.risks.length > 10 && diffSize < 1000) {
    issues.push({
      type: 'suspicious_risk_count',
      message: `小型变更 (${(diffSize / 1024).toFixed(1)}KB) 报告了 ${output.risks.length} 个风险 — 可能存在过度报告`,
      severity: 'info',
    });
  }

  // More than 30% critical is miscalibrated
  const criticalCount = output.risks.filter((r) => r.severity === 'critical').length;
  if (criticalCount > output.risks.length * 0.3 && output.risks.length > 3) {
    issues.push({
      type: 'suspicious_risk_count',
      message: `${criticalCount}/${output.risks.length} (${Math.round(criticalCount / output.risks.length * 100)}%) 的风险被标记为 "critical" — 可能存在严重程度膨胀`,
      severity: 'warning',
    });
  }

  return issues;
}

/**
 * Flag high-severity risks with low confidence — these need human review most.
 */
function checkConfidenceSeverityAlignment(risks: ValidatedRisk[]): ConsistencyIssue[] {
  const highRiskLowConfidence = risks.filter(
    (r) => (r.severity === 'critical' || r.severity === 'high') && r.confidence === 'low',
  );

  if (highRiskLowConfidence.length > 0) {
    return [{
      type: 'confidence_severity_gap',
      message: `${highRiskLowConfidence.length} 个高风险项置信度为 "low"，强烈建议人工复查: ${highRiskLowConfidence.map((r) => r.id).join(', ')}`,
      riskIds: highRiskLowConfidence.map((r) => r.id),
      severity: 'error',
    }];
  }

  return [];
}
