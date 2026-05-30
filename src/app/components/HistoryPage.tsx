'use client';

import { useMemo } from 'react';
import { ArrowLeft, Clock3, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { Alert, AlertTitle, Button, Card, CardContent, Chip } from '@mui/material';
import type { LocalAnalysisHistoryEntry } from '@/types/analysis';

interface HistoryPageProps {
  entries: LocalAnalysisHistoryEntry[];
  onBack: () => void;
  onOpen: (entry: LocalAnalysisHistoryEntry) => void;
  onDelete: (analysisRunId: string) => void;
  onClear: () => void;
  onReanalyze: (entry: LocalAnalysisHistoryEntry) => void;
}

function riskLabel(level: LocalAnalysisHistoryEntry['data']['riskLevel']) {
  switch (level) {
    case 'high':
      return '高风险';
    case 'medium':
      return '中风险';
    default:
      return '低风险';
  }
}

function riskColor(level: LocalAnalysisHistoryEntry['data']['riskLevel']) {
  switch (level) {
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    default:
      return 'success';
  }
}

export default function HistoryPage({
  entries,
  onBack,
  onOpen,
  onDelete,
  onClear,
  onReanalyze,
}: HistoryPageProps) {
  const hasEntries = entries.length > 0;
  const summary = useMemo(() => {
    return {
      total: entries.length,
      highRisk: entries.filter((entry) => entry.data.riskLevel === 'high').length,
      latest: entries[0]?.savedAt,
    };
  }, [entries]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 via-white to-emerald-50 p-6 md:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-300 hover:text-emerald-700"
              title="返回分析页"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-3xl font-semibold text-slate-900">最近分析</h1>
              <p className="text-sm text-slate-600">当前浏览器保存的最近分析记录，可直接回显或重新分析。</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Chip label={`${summary.total} 条记录`} color="primary" variant="outlined" />
            <Chip label={`${summary.highRisk} 条高风险`} color={summary.highRisk > 0 ? 'error' : 'default'} variant="outlined" />
            <Button
              variant="outlined"
              color="inherit"
              onClick={onClear}
              disabled={!hasEntries}
              startIcon={<Trash2 className="h-4 w-4" />}
            >
              清空本地历史
            </Button>
          </div>
        </div>

        {!hasEntries ? (
          <Alert severity="info" className="shadow-sm">
            <AlertTitle>还没有历史记录</AlertTitle>
            当你完成第一次分析后，这里会保存本机最近的分析结果，方便快速回显。
          </Alert>
        ) : (
          <div className="grid gap-4">
            {entries.map((entry) => (
              <Card key={entry.analysisRunId} className="overflow-hidden shadow-sm">
                <CardContent className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Chip
                          label={riskLabel(entry.data.riskLevel)}
                          color={riskColor(entry.data.riskLevel) as any}
                          size="small"
                        />
                        <Chip label={(entry.data.depth ?? 'standard').toUpperCase()} size="small" variant="outlined" />
                        <Chip label={`${entry.data.risks.length} 风险`} size="small" variant="outlined" />
                      </div>

                      <h2 className="truncate text-xl font-semibold text-slate-900">
                        {entry.data.prInfo.title}
                      </h2>
                      <p className="mt-1 truncate text-sm text-slate-500">{entry.prUrl}</p>

                      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                        <span className="inline-flex items-center gap-1">
                          <ShieldAlert className="h-4 w-4" />
                          #{entry.data.prInfo.number} / {entry.data.prInfo.author}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-4 w-4" />
                          {new Date(entry.savedAt).toLocaleString('zh-CN')}
                        </span>
                        {entry.data.modelUsed && (
                          <span>
                            {entry.data.provider}/{entry.data.modelUsed}
                          </span>
                        )}
                      </div>

                      <p className="mt-4 line-clamp-3 text-sm leading-6 text-slate-700">
                        {entry.data.summary}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button variant="contained" onClick={() => onOpen(entry)}>
                        打开结果
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() => onReanalyze(entry)}
                        startIcon={<RefreshCw className="h-4 w-4" />}
                      >
                        重新分析
                      </Button>
                      <Button
                        variant="text"
                        color="inherit"
                        onClick={() => onDelete(entry.analysisRunId)}
                        startIcon={<Trash2 className="h-4 w-4" />}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
