'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Alert, AlertTitle, Button, CircularProgress } from '@mui/material';
import AnalysisResults from '@/app/components/AnalysisResults';
import { getLocalHistoryEntry, saveLocalHistoryEntry } from '@/lib/local-history';
import type { AnalysisResponse } from '@/types/analysis';

export default function AnalysisDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const analysisRunId = params.id;
    if (!analysisRunId) {
      setError('缺少分析记录 ID');
      setLoading(false);
      return;
    }

    const localEntry = getLocalHistoryEntry(analysisRunId);
    if (localEntry) {
      setAnalysis(localEntry.data);
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        const response = await fetch(`/api/analyses/${analysisRunId}`);
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || `读取分析记录失败 (${response.status})`);
        }

        const result = data as AnalysisResponse;
        setAnalysis(result);
        if (result.analysisRunId) {
          saveLocalHistoryEntry({
            analysisRunId: result.analysisRunId,
            prUrl: result.prUrl ?? '',
            savedAt: result.analyzedAt ?? new Date().toISOString(),
            data: result,
          });
        }
      } catch (err: any) {
        setError(err.message || '读取分析记录失败');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex items-center gap-3 text-slate-600">
          <CircularProgress size={24} />
          <span>正在加载分析结果...</span>
        </div>
      </div>
    );
  }

  if (error || !analysis) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-xl">
          <Alert severity="error">
            <AlertTitle>读取失败</AlertTitle>
            {error ?? '分析记录不存在'}
          </Alert>
          <div className="mt-4 flex gap-3">
            <Button variant="contained" onClick={() => router.push('/')}>
              返回首页
            </Button>
            <Button variant="outlined" onClick={() => router.push('/history')}>
              去历史页
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AnalysisResults
      data={analysis}
      onBack={() => router.push('/')}
      onShowHistory={() => router.push('/history')}
    />
  );
}
