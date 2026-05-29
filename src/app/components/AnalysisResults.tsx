'use client';

import {
  AlertTriangle, CheckCircle, XCircle, FileCode,
  GitBranch, MessageSquare, ChevronDown, ChevronRight,
  AlertCircle, Info, ThumbsUp, ThumbsDown, Zap, Clock, DollarSign,
} from 'lucide-react';
import {
  Card, CardContent, Chip,
  Alert, AlertTitle,
} from '@mui/material';
import { useState } from 'react';
import type { AnalysisData, Risk, FeedbackEntry } from '../../types/analysis';

interface AnalysisResultsProps {
  data: AnalysisData;
  onBack: () => void;
}

export default function AnalysisResults({ data, onBack }: AnalysisResultsProps) {
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, 'accurate' | 'inaccurate'>>({});
  const [expandedRisks, setExpandedRisks] = useState<Set<string>>(new Set());

  const toggleRiskExpand = (riskId: string) => {
    setExpandedRisks((prev) => {
      const next = new Set(prev);
      if (next.has(riskId)) next.delete(riskId);
      else next.add(riskId);
      return next;
    });
  };

  const handleFeedback = (riskId: string, rating: 'accurate' | 'inaccurate') => {
    setFeedback((prev) => ({
      ...prev,
      [riskId]: prev[riskId] === rating ? undefined as any : rating,
    }));

    // Persist feedback to localStorage
    try {
      const entry: FeedbackEntry = {
        riskId,
        prUrl: `${data.prInfo.title} (#${data.prInfo.number})`,
        rating: rating === 'inaccurate' ? 'inaccurate' : 'accurate',
        timestamp: new Date().toISOString(),
      };
      const existing = JSON.parse(localStorage.getItem('ai-review-feedback') || '[]');
      existing.push(entry);
      localStorage.setItem('ai-review-feedback', JSON.stringify(existing.slice(-100))); // Keep last 100
    } catch { /* localStorage may not be available */ }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'critical': return 'error';
      case 'high': return 'error';
      case 'medium': return 'warning';
      case 'low': return 'info';
      default: return 'default';
    }
  };

  const getRiskBgColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-50 border-red-300';
      case 'high': return 'bg-orange-50 border-orange-200';
      case 'medium': return 'bg-yellow-50 border-yellow-200';
      case 'low': return 'bg-teal-50 border-teal-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  const getConfidenceIcon = (confidence: string) => {
    switch (confidence) {
      case 'high': return <Zap className="w-3.5 h-3.5 text-green-600" />;
      case 'medium': return <Info className="w-3.5 h-3.5 text-yellow-600" />;
      case 'low': return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    }
  };

  const getConfidenceLabel = (confidence: string) => {
    switch (confidence) {
      case 'high': return '高置信度';
      case 'medium': return '中置信度';
      case 'low': return '低置信度·需人工复查';
    }
  };

  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case 'high': return 'bg-green-100 text-green-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-red-100 text-red-800';
    }
  };

  const getCategoryLabel = (category?: string) => {
    switch (category) {
      case 'security': return '安全';
      case 'logic': return '逻辑';
      case 'performance': return '性能';
      case 'quality': return '质量';
      case 'architecture': return '架构';
      default: return null;
    }
  };

  const getOverallRiskIcon = () => {
    switch (data.riskLevel) {
      case 'high': return <XCircle className="w-6 h-6 text-red-600" />;
      case 'medium': return <AlertTriangle className="w-6 h-6 text-yellow-600" />;
      case 'low': return <CheckCircle className="w-6 h-6 text-green-600" />;
    }
  };

  const getCommentIcon = (type: string) => {
    switch (type) {
      case 'positive': return <CheckCircle className="w-5 h-5 text-green-600" />;
      case 'suggestion': return <Info className="w-5 h-5 text-teal-600" />;
      case 'concern': return <AlertCircle className="w-5 h-5 text-orange-600" />;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={onBack}
            className="text-emerald-600 hover:text-emerald-800 font-medium"
          >
            ← 返回首页
          </button>

          {/* Model & Performance Info */}
          {data.modelUsed && (
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {data.provider}/{data.modelUsed}
              </span>
              {data.latencyMs && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {(data.latencyMs / 1000).toFixed(1)}s
                </span>
              )}
              {data.estimatedCost !== undefined && (
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3" />
                  ${data.estimatedCost.toFixed(4)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* PR Info Header */}
        <Card className="mb-6 shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-800 mb-2">
                  {data.prInfo.title}
                </h1>
                <div className="flex items-center gap-4 text-sm text-slate-600">
                  <span>#{data.prInfo.number}</span>
                  <span>•</span>
                  <span>作者: {data.prInfo.author}</span>
                  <span>•</span>
                  <div className="flex items-center gap-1">
                    <GitBranch className="w-4 h-4" />
                    <span>{data.prInfo.branch}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getOverallRiskIcon()}
                <span className="font-semibold text-slate-700">
                  风险等级: {data.riskLevel === 'high' ? '高' : data.riskLevel === 'medium' ? '中' : '低'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-200">
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* AI Summary */}
            <Card className="shadow-md">
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <MessageSquare className="w-5 h-5" />
                  AI 变更总结
                </h2>
                <p className="text-slate-700 leading-relaxed">{data.summary}</p>
              </CardContent>
            </Card>

            {/* Risk Analysis */}
            <Card className="shadow-md">
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  风险代码识别 ({data.risks.length})
                </h2>

                {data.risks.length === 0 ? (
                  <Alert severity="success">
                    <AlertTitle>太棒了！</AlertTitle>
                    未发现明显的风险代码。
                  </Alert>
                ) : (
                  <div className="space-y-4">
                    {data.risks.map((risk: Risk) => (
                      <div
                        key={risk.id}
                        className={`border-2 rounded-lg p-4 ${getRiskBgColor(risk.severity)} ${risk.confidence === 'low' ? 'opacity-85' : ''}`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Chip
                              label={risk.severity === 'critical' ? '严重' : risk.severity === 'high' ? '高' : risk.severity === 'medium' ? '中' : '低'}
                              color={getRiskColor(risk.severity) as any}
                              size="small"
                            />
                            {getCategoryLabel(risk.category) && (
                              <Chip
                                label={getCategoryLabel(risk.category)}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: '10px' }}
                              />
                            )}
                            {/* Confidence badge */}
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getConfidenceColor(risk.confidence)}`}>
                              {getConfidenceIcon(risk.confidence)}
                              {getConfidenceLabel(risk.confidence)}
                            </span>
                          </div>

                          {/* Feedback buttons */}
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleFeedback(risk.id, 'accurate')}
                              className={`p-1 rounded transition-colors ${
                                feedback[risk.id] === 'accurate'
                                  ? 'bg-green-100 text-green-700'
                                  : 'text-slate-400 hover:text-green-600 hover:bg-green-50'
                              }`}
                              title="标记为准确"
                            >
                              <ThumbsUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleFeedback(risk.id, 'inaccurate')}
                              className={`p-1 rounded transition-colors ${
                                feedback[risk.id] === 'inaccurate'
                                  ? 'bg-red-100 text-red-700'
                                  : 'text-slate-400 hover:text-red-600 hover:bg-red-50'
                              }`}
                              title="标记为误报"
                            >
                              <ThumbsDown className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <h3 className="font-semibold text-slate-800 mb-1">{risk.title}</h3>
                        <p className="text-slate-700 mb-2 text-sm">{risk.description}</p>

                        {/* Confidence rationale for low-confidence findings */}
                        {risk.confidence === 'low' && risk.confidenceRationale && (
                          <div className="mb-2 p-2 bg-red-50 rounded border border-red-200 text-xs text-red-700">
                            ⚠️ {risk.confidenceRationale}
                          </div>
                        )}

                        {/* Expandable code block */}
                        <div
                          className="bg-slate-800 text-slate-100 rounded p-3 mb-3 text-sm font-mono cursor-pointer"
                          onClick={() => toggleRiskExpand(risk.id)}
                        >
                          <div className="flex items-center justify-between text-slate-400 mb-1">
                            <span>{risk.file}:{risk.line}</span>
                            <span className="text-xs">
                              {expandedRisks.has(risk.id) ? '收起' : '展开'}
                            </span>
                          </div>
                          <pre className="overflow-x-auto">{risk.code}</pre>
                        </div>

                        <div className="bg-white bg-opacity-60 rounded p-3 border border-slate-300">
                          <div className="text-sm font-semibold text-slate-700 mb-1">💡 建议修复:</div>
                          <div className="text-sm text-slate-700">{risk.suggestion}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Review Comments */}
            <Card className="shadow-md">
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  AI Review 建议
                </h2>
                <div className="space-y-3">
                  {data.reviewComments.map((comment) => (
                    <div key={comment.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                      {getCommentIcon(comment.type)}
                      <div>
                        <span className="text-xs text-slate-400 uppercase">
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

          {/* Sidebar - File Changes */}
          <div className="lg:col-span-1">
            <Card className="shadow-md sticky top-8">
              <CardContent className="p-6">
                <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
                  <FileCode className="w-5 h-5" />
                  文件变更列表
                </h2>
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {data.fileChanges.map((file) => (
                    <div
                      key={file.file}
                      className="p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                      onClick={() => setExpandedFile(expandedFile === file.file ? null : file.file)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {expandedFile === file.file ? (
                            <ChevronDown className="w-4 h-4 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 flex-shrink-0" />
                          )}
                          <span className="text-sm font-mono text-slate-700 truncate">
                            {file.file.split('/').pop()}
                          </span>
                        </div>
                        <Chip
                          label={file.status === 'added' ? '新增' : file.status === 'modified' ? '修改' : '删除'}
                          size="small"
                          color={file.status === 'added' ? 'success' : file.status === 'deleted' ? 'error' : 'default'}
                          sx={{ fontSize: '10px' }}
                        />
                      </div>
                      {expandedFile === file.file && (
                        <div className="mt-2 pt-2 border-t border-slate-200 text-xs text-slate-600">
                          <div className="flex gap-4">
                            <span className="text-green-600">+{file.additions}</span>
                            <span className="text-red-600">-{file.deletions}</span>
                          </div>
                          <div className="mt-1 font-mono text-slate-500 break-all">
                            {file.file}
                          </div>
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
