'use client';

import { useState } from 'react';
import { useMemo } from 'react';
import { ArrowLeft, Clock3, RefreshCw, ShieldAlert, Trash2, Brain, Zap, Sparkles } from 'lucide-react';
import {
  Alert,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  RadioGroup,
  FormControlLabel,
  Radio,
  CircularProgress,
} from '@mui/material';
import type { LocalAnalysisHistoryEntry } from '@/types/analysis';

interface HistoryPageProps {
  entries: LocalAnalysisHistoryEntry[];
  onBack: () => void;
  onOpen: (entry: LocalAnalysisHistoryEntry) => void;
  onDelete: (analysisRunId: string) => void;
  onClear: () => void;
  onReanalyze: (entry: LocalAnalysisHistoryEntry, depth: string) => void;
  busyId?: string | null;
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
  busyId,
}: HistoryPageProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<LocalAnalysisHistoryEntry | null>(null);
  const [selectedDepth, setSelectedDepth] = useState<string>('standard');

  const hasEntries = entries.length > 0;
  const summary = useMemo(() => {
    let highRisk = 0;
    for (const entry of entries) {
      if (entry.data.riskLevel === 'high') {
        highRisk++;
      }
    }

    return {
      total: entries.length,
      highRisk,
      latest: entries[0]?.savedAt,
    };
  }, [entries]);

  const handleReanalyzeClick = (entry: LocalAnalysisHistoryEntry) => {
    setSelectedEntry(entry);
    setSelectedDepth(entry.data.depth ?? 'standard');
    setDialogOpen(true);
  };

  const handleConfirmReanalyze = () => {
    if (selectedEntry) {
      onReanalyze(selectedEntry, selectedDepth);
      setDialogOpen(false);
    }
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedEntry(null);
  };

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
                        {entry.data.tokenUsage && (
                          <span className="inline-flex items-center gap-1">
                            <Zap className="h-4 w-4 text-amber-500" />
                            {(entry.data.tokenUsage.inputTokens + entry.data.tokenUsage.outputTokens).toLocaleString()} tokens
                          </span>
                        )}
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
                        onClick={() => handleReanalyzeClick(entry)}
                        startIcon={<RefreshCw className="h-4 w-4" />}
                        disabled={busyId !== null}
                      >
                        {busyId === entry.analysisRunId ? (
                          <>
                            <CircularProgress size={16} sx={{ mr: 1 }} />
                            分析中...
                          </>
                        ) : (
                          '重新分析'
                        )}
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

      {/* 深度选择弹窗 */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>重新分析</DialogTitle>
        <DialogContent>
          {selectedEntry && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-slate-600">PR: {selectedEntry.data.prInfo.title}</p>
                <p className="text-xs text-slate-500">#{selectedEntry.data.prInfo.number}</p>
                <p className="mt-2 text-xs text-slate-500">
                  上次分析: {selectedEntry.data.depth ?? 'standard'} (
                  {selectedEntry.data.depth === 'fast' ? '较短' : selectedEntry.data.depth === 'deep' ? '较长' : '长'})
                </p>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-slate-700">选择分析深度:</p>
                <RadioGroup value={selectedDepth} onChange={(e) => setSelectedDepth(e.target.value)}>
                  <div className="space-y-2">
                    <FormControlLabel
                      value="fast"
                      control={<Radio />}
                      label={
                        <div className="flex items-center gap-2">
                          <Zap className="h-4 w-4 text-yellow-600" />
                          <div>
                            <div className="text-sm font-medium">快速扫描 (较短)</div>
                            <div className="text-xs text-slate-500">只看 diff</div>
                          </div>
                        </div>
                      }
                    />
                    <FormControlLabel
                      value="standard"
                      control={<Radio />}
                      label={
                        <div className="flex items-center gap-2">
                          <Brain className="h-4 w-4 text-blue-600" />
                          <div>
                            <div className="text-sm font-medium">标准审查 (长)</div>
                            <div className="text-xs text-slate-500">+上下文 +依赖</div>
                          </div>
                        </div>
                      }
                    />
                    <FormControlLabel
                      value="deep"
                      control={<Radio />}
                      label={
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-purple-600" />
                          <div>
                            <div className="text-sm font-medium">深度审查 (较长)</div>
                            <div className="text-xs text-slate-500">+关联文件 +PR评论</div>
                          </div>
                        </div>
                      }
                    />
                  </div>
                </RadioGroup>
              </div>
            </div>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} color="inherit">
            取消
          </Button>
          <Button onClick={handleConfirmReanalyze} variant="contained" color="primary" disabled={busyId !== null}>
            开始分析
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
