/**
 * Helper functions for normalizing and building analysis data
 */

import type { AnalysisData, AnalysisResponse, Risk, ReviewComment } from '@/styles/types/analysis';

export function normalizeAnalysisData(
  raw: Record<string, unknown>,
  collected: any,
  modelId: string,
  providerName: string,
  latencyMs: number,
  usage?: { inputTokens: number; outputTokens: number },
): AnalysisData {
  const rawSummary = typeof raw.summary === 'string' ? raw.summary : 'AI 未返回有效的摘要信息。';
  const rawRiskLevel = raw.riskLevel as string;
  const rawRisks = Array.isArray(raw.risks) ? (raw.risks as Array<Record<string, unknown>>) : [];
  const rawComments = Array.isArray(raw.reviewComments)
    ? (raw.reviewComments as Array<Record<string, unknown>>)
    : [];

  return {
    prInfo: collected.prInfo,
    summary: rawSummary,
    riskLevel: rawRiskLevel === 'high' || rawRiskLevel === 'medium' ? rawRiskLevel : 'low',
    risks: rawRisks.map((risk, index) => ({
      id: (typeof risk.id === 'string' ? risk.id : `risk-${index + 1}`) as string,
      severity: (typeof risk.severity === 'string' ? risk.severity : 'medium') as Risk['severity'],
      title: (typeof risk.title === 'string' ? risk.title : '未命名风险') as string,
      description: (typeof risk.description === 'string' ? risk.description : '') as string,
      file: (typeof risk.file === 'string' ? risk.file : '') as string,
      line: (typeof risk.line === 'number' ? risk.line : 0) as number,
      code: (typeof risk.code === 'string' ? risk.code : '') as string,
      suggestion: (typeof risk.suggestion === 'string' ? risk.suggestion : '') as string,
      confidence: (typeof risk.confidence === 'string' ? risk.confidence : 'low') as Risk['confidence'],
      confidenceRationale:
        (typeof risk.confidenceRationale === 'string'
          ? risk.confidenceRationale
          : 'AI 响应格式异常，置信度自动调低') as string,
      category: (typeof risk.category === 'string' ? risk.category : undefined) as Risk['category'],
    })),
    reviewComments: rawComments.map((comment, index) => ({
      id: (typeof comment.id === 'string' ? comment.id : `comment-${index + 1}`) as string,
      type: (typeof comment.type === 'string' ? comment.type : 'suggestion') as ReviewComment['type'],
      comment: (typeof comment.comment === 'string' ? comment.comment : '') as string,
    })),
    fileChanges: collected.fileChanges,
    modelUsed: modelId,
    provider: providerName,
    latencyMs,
    tokenUsage: usage,
  };
}

export function buildResponse(
  data: AnalysisData,
  extras: Omit<AnalysisResponse, keyof AnalysisData>,
): AnalysisResponse {
  return {
    ...data,
    ...extras,
  };
}
