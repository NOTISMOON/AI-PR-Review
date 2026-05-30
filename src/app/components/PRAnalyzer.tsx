'use client';

import { useState, type ReactNode } from 'react';
import {
  GitPullRequest, TrendingUp, Shield, Users, Zap, Brain, Sparkles, Clock,
} from 'lucide-react';
import {
  Card, CardContent, TextField, Button, Chip,
  LinearProgress, Alert, AlertTitle,
} from '@mui/material';
import type { AnalyzeRequest } from '../../types/analysis';

interface PRAnalyzerProps {
  onAnalyze: (prUrl: string, options?: Partial<AnalyzeRequest>) => void;
  loading: boolean;
}

type AnalysisDepth = 'fast' | 'standard' | 'deep';

const DEPTH_OPTIONS: { value: AnalysisDepth; label: string; icon: ReactNode; desc: string; time: string }[] = [
  {
    value: 'fast',
    label: '快速扫描',
    icon: <Zap className="w-4 h-4" />,
    desc: '仅 diff 分析，快速获得概览',
    time: '~5秒',
  },
  {
    value: 'standard',
    label: '标准审查',
    icon: <Brain className="w-4 h-4" />,
    desc: '包含上下文和依赖分析',
    time: '~15秒',
  },
  {
    value: 'deep',
    label: '深度审查',
    icon: <Sparkles className="w-4 h-4" />,
    desc: '完整上下文 + CoT + 示例',
    time: '~30秒',
  },
];

export default function PRAnalyzer({ onAnalyze, loading }: PRAnalyzerProps) {
  const [prUrl, setPrUrl] = useState('');
  const [depth, setDepth] = useState<AnalysisDepth>('standard');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (prUrl.trim()) {
      onAnalyze(prUrl.trim(), { depth });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <GitPullRequest className="w-12 h-12 text-emerald-600" />
            <h1 className="text-5xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
              AI PR Analyzer
            </h1>
          </div>
          <p className="text-slate-600 text-lg">
            智能分析 GitHub Pull Request，发现潜在问题，提供专业建议
          </p>
        </div>

        <Card className="mb-8 shadow-lg">
          <CardContent className="p-8">
            <form onSubmit={handleSubmit}>
              <div className="flex gap-4 mb-4">
                <TextField
                  fullWidth
                  variant="outlined"
                  placeholder="输入 GitHub PR URL (例如: https://github.com/owner/repo/pull/123)"
                  value={prUrl}
                  onChange={(e) => setPrUrl(e.target.value)}
                  disabled={loading}
                  sx={{ backgroundColor: 'white' }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={loading || !prUrl.trim()}
                  sx={{
                    minWidth: '140px',
                    background: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)',
                    '&:hover': {
                      background: 'linear-gradient(135deg, #047857 0%, #0f766e 100%)',
                    },
                  }}
                >
                  {loading ? '分析中...' : '开始分析'}
                </Button>
              </div>

              {/* Analysis Depth Selector */}
              <div>
                <p className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  分析深度
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {DEPTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDepth(opt.value)}
                      disabled={loading}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        depth === opt.value
                          ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {opt.icon}
                        <span className={`text-sm font-semibold ${
                          depth === opt.value ? 'text-emerald-700' : 'text-slate-700'
                        }`}>
                          {opt.label}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mb-1.5">{opt.desc}</p>
                      <Chip label={opt.time} size="small" sx={{ fontSize: '10px', height: '20px' }} />
                    </button>
                  ))}
                </div>
              </div>
            </form>

            {loading && (
              <div className="mt-6">
                <LinearProgress />
                <p className="text-center text-slate-600 mt-2">正在获取代码变更并进行 AI 分析...</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="shadow-md hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <Shield className="w-8 h-8 text-green-600" />
                <h3 className="font-semibold text-slate-700">风险检测</h3>
              </div>
              <p className="text-slate-600 text-sm">自动识别安全漏洞、性能问题和潜在 bug</p>
            </CardContent>
          </Card>

          <Card className="shadow-md hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <TrendingUp className="w-8 h-8 text-emerald-600" />
                <h3 className="font-semibold text-slate-700">智能总结</h3>
              </div>
              <p className="text-slate-600 text-sm">AI 生成代码变更摘要和影响范围分析</p>
            </CardContent>
          </Card>

          <Card className="shadow-md hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-2">
                <Users className="w-8 h-8 text-teal-600" />
                <h3 className="font-semibold text-slate-700">Review 建议</h3>
              </div>
              <p className="text-slate-600 text-sm">提供专业的代码审查意见和改进建议</p>
            </CardContent>
          </Card>
        </div>

        <Alert severity="info" className="shadow-md">
          <AlertTitle>提示</AlertTitle>
          输入完整的 GitHub PR URL 开始分析。系统将自动获取代码变更、文件列表和提交信息，并使用 AI 进行智能分析。
          选择分析深度：快速扫描适合初步检查，标准审查适合日常 Review，深度审查适合安全关键代码。
        </Alert>
      </div>
    </div>
  );
}
