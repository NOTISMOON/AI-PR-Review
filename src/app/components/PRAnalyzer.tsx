'use client';

import { useState, type ReactNode } from 'react';
import {
  Brain,
  Clock,
  GitPullRequest,
  History,
  Shield,
  Sparkles,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import {
  Alert,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  TextField,
} from '@mui/material';
import type { AnalyzeRequest } from '@/types/analysis';

interface PRAnalyzerProps {
  onAnalyze: (prUrl: string, options?: Partial<AnalyzeRequest>) => void;
  onOpenHistory: () => void;
  loading: boolean;
}

type AnalysisDepth = 'fast' | 'standard' | 'deep';

const depthOptions: { value: AnalysisDepth; label: string; icon: ReactNode; desc: string; time: string }[] = [
  {
    value: 'fast',
    label: '快速扫描',
    icon: <Zap className="h-4 w-4" />,
    desc: '只看 diff，快速拿到风险概览',
    time: '~5秒',
  },
  {
    value: 'standard',
    label: '标准审查',
    icon: <Brain className="h-4 w-4" />,
    desc: '结合上下文、提交历史和依赖信息',
    time: '~15秒',
  },
  {
    value: 'deep',
    label: '深度审查',
    icon: <Sparkles className="h-4 w-4" />,
    desc: '尽可能拉满上下文，适合关键变更',
    time: '~30秒',
  },
];

export default function PRAnalyzer({ onAnalyze, onOpenHistory, loading }: PRAnalyzerProps) {
  const [prUrl, setPrUrl] = useState('');
  const [depth, setDepth] = useState<AnalysisDepth>('standard');

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (prUrl.trim()) {
      onAnalyze(prUrl.trim(), { depth });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 flex flex-wrap items-start justify-between gap-4">
          <div className="text-center md:text-left">
            <div className="mb-4 flex items-center justify-center gap-3 md:justify-start">
              <GitPullRequest className="h-12 w-12 text-emerald-600" />
              <h1 className="bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-5xl font-bold text-transparent">
                AI PR Analyzer
              </h1>
            </div>
            <p className="text-lg text-slate-600">
              输入 GitHub Pull Request 链接，拿到带上下文的 AI 代码审查结果。
            </p>
          </div>

          <Button
            variant="outlined"
            color="inherit"
            onClick={onOpenHistory}
            startIcon={<History className="h-4 w-4" />}
          >
            查看本机历史
          </Button>
        </div>

        <Card className="mb-8 shadow-lg">
          <CardContent className="p-8">
            <form onSubmit={handleSubmit}>
              <div className="mb-4 flex flex-col gap-4 md:flex-row">
                <TextField
                  fullWidth
                  variant="outlined"
                  placeholder="输入 GitHub PR URL，例如 https://github.com/owner/repo/pull/123"
                  value={prUrl}
                  onChange={(event) => setPrUrl(event.target.value)}
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

              <div>
                <p className="mb-2 flex items-center gap-1 text-sm font-medium text-slate-700">
                  <Clock className="h-3.5 w-3.5" />
                  分析深度
                </p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {depthOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setDepth(option.value)}
                      disabled={loading}
                      className={`rounded-lg border-2 p-3 text-left transition-all ${
                        depth === option.value
                          ? 'border-emerald-500 bg-emerald-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="mb-1 flex items-center gap-1.5">
                        {option.icon}
                        <span
                          className={`text-sm font-semibold ${
                            depth === option.value ? 'text-emerald-700' : 'text-slate-700'
                          }`}
                        >
                          {option.label}
                        </span>
                      </div>
                      <p className="mb-1.5 text-xs text-slate-500">{option.desc}</p>
                      <Chip label={option.time} size="small" sx={{ fontSize: '10px', height: '20px' }} />
                    </button>
                  ))}
                </div>
              </div>
            </form>

            {loading && (
              <div className="mt-6">
                <LinearProgress />
                <p className="mt-2 text-center text-slate-600">正在抓取代码变更并执行 AI 分析...</p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card className="shadow-md transition-shadow hover:shadow-lg">
            <CardContent className="p-6">
              <div className="mb-2 flex items-center gap-3">
                <Shield className="h-8 w-8 text-green-600" />
                <h3 className="font-semibold text-slate-700">风险检测</h3>
              </div>
              <p className="text-sm text-slate-600">自动识别安全、逻辑和性能风险，优先帮你找出最值得先看的地方。</p>
            </CardContent>
          </Card>

          <Card className="shadow-md transition-shadow hover:shadow-lg">
            <CardContent className="p-6">
              <div className="mb-2 flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-emerald-600" />
                <h3 className="font-semibold text-slate-700">智能总结</h3>
              </div>
              <p className="text-sm text-slate-600">自动整理 PR 目的、影响范围和关键变更，减少你手动扫 diff 的成本。</p>
            </CardContent>
          </Card>

          <Card className="shadow-md transition-shadow hover:shadow-lg">
            <CardContent className="p-6">
              <div className="mb-2 flex items-center gap-3">
                <Users className="h-8 w-8 text-teal-600" />
                <h3 className="font-semibold text-slate-700">Review 建议</h3>
              </div>
              <p className="text-sm text-slate-600">输出可直接参考的 review 意见和修复建议，帮你更快完成审查闭环。</p>
            </CardContent>
          </Card>
        </div>

        <Alert severity="info" className="shadow-md">
          <AlertTitle>使用提示</AlertTitle>
          输入完整的 GitHub PR URL 后开始分析。系统会抓取变更文件、提交记录、相关上下文，并将结果写入数据库和本机历史，方便后续回看。
        </Alert>
      </div>
    </div>
  );
}
