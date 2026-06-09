/**
 * Validation schemas for AI analysis output.
 * Uses manual validation (no external dependency required).
 */

// ─── Types ────────────────────────────────────────────────────────────

export interface AnalysisOutput {
  summary: string;
  riskLevel: 'low' | 'medium' | 'high';
  risks: ValidatedRisk[];
  reviewComments: ValidatedReviewComment[];
}

export interface ValidatedRisk {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  file: string;
  line: number;
  code: string;
  suggestion: string;
  confidence: 'high' | 'medium' | 'low';
  confidenceRationale?: string;
  category?: 'security' | 'logic' | 'performance' | 'quality' | 'architecture';
}

export interface ValidatedReviewComment {
  id: string;
  type: 'positive' | 'suggestion' | 'concern';
  comment: string;
}

// ─── Validation ───────────────────────────────────────────────────────

type ValidationResult =
  | { success: true; data: AnalysisOutput }
  | { success: false; errors: string[] };

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const VALID_CONFIDENCES = new Set(['high', 'medium', 'low']);
const VALID_RISK_LEVELS = new Set(['low', 'medium', 'high']);
const VALID_COMMENT_TYPES = new Set(['positive', 'suggestion', 'concern']);
const VALID_CATEGORIES = new Set(['security', 'logic', 'performance', 'quality', 'architecture']);

/**
 * Sanitize raw AI output before validation: auto-generate missing IDs,
 * default invalid enums.  This prevents a whole analysis from being
 * discarded just because the AI missed a formatting detail.
 */
function sanitize(raw: Record<string, unknown>): Record<string, unknown> {
  const obj = { ...raw };

  // Sanitize risks
  if (Array.isArray(obj.risks)) {
    obj.risks = (obj.risks as Record<string, unknown>[]).map((r, i) => {
      const risk = { ...r };
      if (typeof risk.id !== 'string' || !risk.id) risk.id = `risk-${i + 1}`;
      if (typeof risk.severity !== 'string' || !VALID_SEVERITIES.has(risk.severity)) risk.severity = 'medium';
      if (typeof risk.confidence !== 'string' || !VALID_CONFIDENCES.has(risk.confidence)) risk.confidence = 'medium';
      if (typeof risk.title !== 'string') risk.title = String(risk.title ?? '');
      if (typeof risk.description !== 'string') risk.description = String(risk.description ?? '');
      if (typeof risk.file !== 'string') risk.file = String(risk.file ?? '');
      if (risk.line === undefined || risk.line === null || typeof risk.line !== 'number') risk.line = 0;
      if (typeof risk.code !== 'string') risk.code = String(risk.code ?? '');
      if (typeof risk.suggestion !== 'string') risk.suggestion = String(risk.suggestion ?? '');
      return risk;
    });
  }

  // Sanitize reviewComments
  if (Array.isArray(obj.reviewComments)) {
    obj.reviewComments = (obj.reviewComments as Record<string, unknown>[]).map((c, i) => {
      const comment = { ...c };
      if (typeof comment.id !== 'string' || !comment.id) comment.id = `comment-${i + 1}`;
      if (typeof comment.type !== 'string' || !VALID_COMMENT_TYPES.has(comment.type)) comment.type = 'suggestion';
      if (typeof comment.comment !== 'string') comment.comment = String(comment.comment ?? '');
      return comment;
    });
  }

  return obj;
}

/**
 * Validate AI output against the expected schema.
 */
export function validateAnalysisOutput(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { success: false, errors: ['响应不是有效的 JSON 对象'] };
  }

  // Auto-fix common AI formatting mistakes before validating
  const obj = sanitize(raw as Record<string, unknown>);
  const errors: string[] = [];

  // summary — required string
  if (typeof obj.summary !== 'string' || obj.summary.length < 10) {
    errors.push('summary: 必须是不少于10字的字符串');
  }

  // riskLevel — required enum
  if (typeof obj.riskLevel !== 'string' || !VALID_RISK_LEVELS.has(obj.riskLevel)) {
    errors.push('riskLevel: 必须是 low / medium / high 之一');
  }

  // risks — required array
  if (!Array.isArray(obj.risks)) {
    errors.push('risks: 必须是数组');
  } else if (obj.risks.length > 15) {
    errors.push('risks: 最多15条');
  } else {
    // Sanitized risks should always pass — keep this for structural errors
    const riskErrors = validateRisks(obj.risks);
    errors.push(...riskErrors);
  }

  // reviewComments — required array
  if (!Array.isArray(obj.reviewComments)) {
    errors.push('reviewComments: 必须是数组');
  } else if (obj.reviewComments.length === 0) {
    errors.push('reviewComments: 至少需要1条审查意见');
  } else {
    // Sanitized comments should always pass — keep this for structural errors
    const commentErrors = validateReviewComments(obj.reviewComments);
    errors.push(...commentErrors);
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      summary: obj.summary as string,
      riskLevel: obj.riskLevel as 'low' | 'medium' | 'high',
      risks: obj.risks as ValidatedRisk[],
      reviewComments: obj.reviewComments as ValidatedReviewComment[],
    },
  };
}

function validateRisks(risks: unknown[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < risks.length; i++) {
    const r = risks[i] as Record<string, unknown>;
    const prefix = `risks[${i}]`;

    if (typeof r.id !== 'string' || !r.id) errors.push(`${prefix}.id: 不能为空`);
    if (typeof r.severity !== 'string' || !VALID_SEVERITIES.has(r.severity)) {
      errors.push(`${prefix}.severity: 必须是 critical/high/medium/low 之一`);
    }
    if (typeof r.title !== 'string' || !r.title) errors.push(`${prefix}.title: 不能为空`);
    if (typeof r.description !== 'string' || !r.description) errors.push(`${prefix}.description: 不能为空`);
    if (typeof r.file !== 'string' || !r.file) errors.push(`${prefix}.file: 不能为空`);
    if (typeof r.line !== 'number') errors.push(`${prefix}.line: 必须是数字`);
    if (typeof r.code !== 'string' || !r.code) errors.push(`${prefix}.code: 不能为空`);
    if (typeof r.suggestion !== 'string' || !r.suggestion) errors.push(`${prefix}.suggestion: 不能为空`);

    // confidence — default to 'medium' if missing
    if (r.confidence !== undefined && (typeof r.confidence !== 'string' || !VALID_CONFIDENCES.has(r.confidence))) {
      errors.push(`${prefix}.confidence: 必须是 high/medium/low 之一`);
    }

    // category — optional but validate if present
    if (r.category !== undefined && (typeof r.category !== 'string' || !VALID_CATEGORIES.has(r.category))) {
      errors.push(`${prefix}.category: 无效的分类值`);
    }
  }

  return errors;
}

function validateReviewComments(comments: unknown[]): string[] {
  const errors: string[] = [];

  for (let i = 0; i < comments.length; i++) {
    const c = comments[i] as Record<string, unknown>;
    const prefix = `reviewComments[${i}]`;

    if (typeof c.id !== 'string' || !c.id) errors.push(`${prefix}.id: 不能为空`);
    if (typeof c.type !== 'string' || !VALID_COMMENT_TYPES.has(c.type)) {
      errors.push(`${prefix}.type: 必须是 positive/suggestion/concern 之一`);
    }
    if (typeof c.comment !== 'string' || !c.comment) errors.push(`${prefix}.comment: 不能为空`);
  }

  return errors;
}
