'use client';

import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  DollarSign,
  ExternalLink,
  FileCode,
  GitBranch,
  Info,
  MessageSquare,
  XCircle,
  Zap,
} from 'lucide-react';
import { Alert, AlertTitle, Card, CardContent, Chip } from '@mui/material';
import { useState } from 'react';
import type { AnalysisResponse, Risk } from '@/types/analysis';

interface AnalysisResultsProps {
  data: AnalysisResponse;
  onBack: () => void;
  onShowHistory?: () => void;
}

function AnalysisResults({ data, onBack, onShowHistory }: AnalysisResultsProps) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [expandedRisks, setExpandedRisks] = useState<Set<string>>(new Set());

  const toggleRiskExpand = (riskId: string) => {
    setExpandedRisks((prev) => {
      const next = new Set(prev);
      if (next.has(riskId)) {
        next.delete(riskId);
      } else {
        next.add(riskId);
      }
      return next;
    });
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'critical':
      case 'high':
        return 'error';
      case 'medium':
        return 'warning';
      case 'low':
        return 'info';
      default:
        return 'default';
    }
  };

  const getRiskBgColor = (level: string) => {
    switch (level) {
      case 'critical':
        return 'bg-red-50 border-red-300';
      case 'high':
        return 'bg-orange-50 border-orange-200';
      case 'medium':
        return 'bg-yellow-50 border-yellow-200';
      case 'low':
        return 'bg-teal-50 border-teal-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  const getConfidenceIcon = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return <Zap className="h-3.5 w-3.5 text-green-600" />;
      case 'medium':
        return <Info className="h-3.5 w-3.5 text-yellow-600" />;
      default:
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    }
  };

  const getConfidenceLabel = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return '高置信度';
      case 'medium':
        return '中置信度';
      default:
        return '低置信度';
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high':
        return 'bg-green-100 text-green-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-red-100 text-red-800';
    }
  };

  const getCategoryLabel = (category?: string) => {
    switch (category) {
      case 'security':
        return '安全';
      case 'logic':
        return '逻辑';
      case 'performance':
        return '性能';
      case 'quality':
        return '质量';
      case 'architecture':
        return '架构';
      default:
        return null;
    }
  };

  const getOverallRiskIcon = () => {
    switch (data.riskLevel) {
      case 'high':
        return <XCircle className="h-6 w-6 text-red-600" />;
      case 'medium':
        return <AlertTriangle className="h-6 w-6 text-yellow-600" />;
      default:
        return <CheckCircle className="h-6 w-6 text-green-600" />;
    }
  };

  const getCommentIcon = (type: string) => {
    switch (type) {
      case 'positive':
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case 'suggestion':
        return <Info className="h-5 w-5 text-teal-600" />;
      default:
        return <AlertCircle className="h-5 w-5 text-orange-600" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="font-medium text-emerald-600 hover:text-emerald-800">
              返回首页
            </button>
            {onShowHistory && (
              <button onClick={onShowHistory} className="font-medium text-slate-500 hover:text-slate-700">
                查看历史
              </button>
            )}
          </div>

          {data.modelUsed && (
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {data.provider}/{data.modelUsed}
              </span>
              {data.depth && <span>{data.depth.toUpperCase()}</span>}
              {data.latencyMs && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {(data.latencyMs / 1000).toFixed(1)}s
                </span>
              )}
              {data.tokenUsage && (
                <span className="flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  {(data.tokenUsage.inputTokens + data.tokenUsage.outputTokens).toLocaleString()} tokens
                </span>
              )}
            </div>
          )}
        </div>

        <Card className="mb-6 shadow-lg">
          <CardContent className="p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h1 className="mb-2 text-2xl font-bold text-slate-800">{data.prInfo.title}</h1>
                <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
                  <span>#{data.prInfo.number}</span>
                  <span>作者: {data.prInfo.author}</span>
                  <div className="flex items-center gap-1">
                    <GitBranch className="h-4 w-4" />
                    <span>{data.prInfo.branch}</span>
                  </div>
                </div>
                {data.prUrl && (
                  <a
                    href={data.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-sm text-emerald-700 hover:text-emerald-900"
                  >
                    {data.prUrl}
                  </a>
                )}
              </div>
              <div className="flex items-center gap-2">
                {getOverallRiskIcon()}
                <span className="font-semibold text-slate-700">
                  风险等级: {data.riskLevel === 'high' ? '高' : data.riskLevel === 'medium' ? '中' : '低'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 border-t border-slate-200 pt-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-slate-800">{data.prInfo.filesChanged}</div>
                <div className="text-sm text-slate-600">文件变更</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">+{data.prInfo.additions}</div>
                <div className="text-sm text-slate-600">新增行数</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">-{data.prInfo.deletions}</div>
                <div className="text-sm text-slate-600">删除行数</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card className="shadow-md">
              <CardContent className="p-6">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-800">
                  <MessageSquare className="h-5 w-5" />
                  AI 变更总结
                </h2>
                <p className="leading-relaxed text-slate-700">{data.summary}</p>
              </CardContent>
            </Card>

            <Card className="shadow-md">
              <CardContent className="p-6">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-800">
                  <AlertTriangle className="h-5 w-5" />
                  风险代码识别 ({data.risks.length})
                </h2>

                {data.risks.length === 0 ? (
                  <Alert severity="success">
                    <AlertTitle>未发现明显风险</AlertTitle>
                    这次分析没有给出明确的风险项，建议仍结合业务背景做人工复查。
                  </Alert>
                ) : (
                  <div className="space-y-4">
                    {data.risks.map((risk: Risk) => (
                      <div
                        key={risk.id}
                        className={`rounded-lg border-2 p-4 ${getRiskBgColor(risk.severity)} ${risk.confidence === 'low' ? 'opacity-90' : ''}`}
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Chip
                              label={
                                risk.severity === 'critical'
                                  ? '严重'
                                  : risk.severity === 'high'
                                    ? '高'
                                    : risk.severity === 'medium'
                                      ? '中'
                                      : '低'
                              }
                              color={getRiskColor(risk.severity) as any}
                              size="small"
                            />
                            {getCategoryLabel(risk.category) && (
                              <Chip label={getCategoryLabel(risk.category)} size="small" variant="outlined" />
                            )}
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${getConfidenceColor(risk.confidence)}`}
                            >
                              {getConfidenceIcon(risk.confidence)}
                              {getConfidenceLabel(risk.confidence)}
                            </span>
                          </div>
                        </div>

                        <h3 className="mb-1 font-semibold text-slate-800">{risk.title}</h3>
                        <p className="mb-2 text-sm text-slate-700">{risk.description}</p>

                        {risk.confidenceRationale && (
                          <div className="mb-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                            <span className="font-semibold">置信度说明: </span>
                            {risk.confidenceRationale}
                          </div>
                        )}

                        <div
                          className="mb-3 cursor-pointer rounded bg-slate-800 p-3 font-mono text-sm text-slate-100"
                          onClick={() => toggleRiskExpand(risk.id)}
                        >
                          <div className="mb-1 flex items-center justify-between text-slate-400">
                            <span>
                              {risk.file}:{risk.line}
                            </span>
                            {expandedRisks.has(risk.id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </div>
                          {expandedRisks.has(risk.id) && (
                            <pre className="overflow-x-auto whitespace-pre-wrap">{risk.code}</pre>
                          )}
                        </div>

                        <div className="rounded border border-slate-300 bg-white/70 p-3">
                          <div className="mb-1 text-sm font-semibold text-slate-700">建议修复</div>
                          <div className="text-sm text-slate-700">{risk.suggestion}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-md">
              <CardContent className="p-6">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-800">
                  <CheckCircle className="h-5 w-5" />
                  AI Review 建议
                </h2>
                <div className="space-y-3">
                  {data.reviewComments.map((comment) => (
                    <div key={comment.id} className="flex items-start gap-3 rounded-lg bg-slate-50 p-3">
                      {getCommentIcon(comment.type)}
                      <div>
                        <span className="text-xs uppercase text-slate-400">
                          {comment.type === 'positive' ? '正面' : comment.type === 'suggestion' ? '建议' : '关注'}
                        </span>
                        <p className="text-slate-700">{comment.comment}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-1">
            <Card className="sticky top-8 shadow-md">
              <CardContent className="p-6">
                <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-slate-800">
                  <FileCode className="h-5 w-5" />
                  文件变更列表
                </h2>
                <div className="max-h-[600px] space-y-2 overflow-y-auto">
                  {data.fileChanges.map((file) => (
                    <div
                      key={file.file}
                      className="rounded-lg bg-slate-50 p-3 transition-colors hover:bg-slate-100"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <button
                            onClick={() => setExpandedFile(expandedFile === file.file ? null : file.file)}
                            className="shrink-0"
                          >
                            {expandedFile === file.file ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <span className="truncate font-mono text-sm text-slate-700">{file.file.split('/').pop()}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Chip
                            label={file.status === 'added' ? '新增' : file.status === 'modified' ? '修改' : '删除'}
                            size="small"
                            color={file.status === 'added' ? 'success' : file.status === 'deleted' ? 'error' : 'default'}
                          />
                          {file.blobUrl && (
                            <a
                              href={file.blobUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-slate-400 transition-colors hover:text-emerald-600"
                              title="在 GitHub 中查看"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </div>
                      {expandedFile === file.file && (
                        <div className="mt-2 border-t border-slate-200 pt-2 text-xs text-slate-600">
                          <div className="flex gap-4">
                            <span className="text-green-600">+{file.additions}</span>
                            <span className="text-red-600">-{file.deletions}</span>
                          </div>
                          <div className="mt-1 break-all font-mono text-slate-500">{file.file}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default React.memo(AnalysisResults, (prevProps, nextProps) => {
  // Only re-render if analysisRunId changes
  return prevProps.data.analysisRunId === nextProps.data.analysisRunId;
});
