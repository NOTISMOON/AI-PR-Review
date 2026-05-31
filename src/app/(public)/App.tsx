"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Snackbar } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import PRAnalyzer from '../components/PRAnalyzer';
import { buildLocalHistoryEntry, saveLocalHistoryEntry } from '@/lib/local-history';
import type { AnalyzeRequest, AnalysisResponse } from '@/types/analysis';

const theme = createTheme({
  palette: {
    primary: {
      main: '#059669',
    },
    secondary: {
      main: '#0d9488',
    },
    info: {
      main: '#0d9488',
    },
  },
});

export default function App() {
  const router = useRouter();
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasModel, setHasModel] = useState(true);

  useEffect(() => {
    // Check if user has configured a model
    const storedModels = localStorage.getItem('local_models');
    const allModels = storedModels ? JSON.parse(storedModels) : [];
    const activeModel = allModels.find((m: any) => m.isActive);
    setHasModel(!!activeModel);
  }, []);

  const handleAnalyze = async (prUrl: string, options?: Partial<AnalyzeRequest>) => {
    setAnalyzing(true);
    setError(null);

    try {
      // Get GitHub token from localStorage
      const githubToken = localStorage.getItem('github_token') || undefined;

      // Get custom models from localStorage and filter active one
      const storedModels = localStorage.getItem('local_models');
      const allModels = storedModels ? JSON.parse(storedModels) : [];
      const activeModel = allModels.find((m: any) => m.isActive);

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prUrl,
          ...options,
          githubToken,
          customModels: activeModel ? [activeModel] : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `分析失败 (${response.status})`);
      }

      const analysis = data as AnalysisResponse;
      if (!analysis.analysisRunId) {
        throw new Error('分析结果未返回记录 ID');
      }

      saveLocalHistoryEntry(buildLocalHistoryEntry(analysis));
      router.push(`/analysis/${analysis.analysisRunId}`);
    } catch (err: any) {
      setError(err.message || '分析过程中出现未知错误，请稍后重试');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <ThemeProvider theme={theme}>
      <div className="size-full">
        <PRAnalyzer
          onAnalyze={handleAnalyze}
          onOpenHistory={() => router.push('/history')}
          onOpenSettings={() => router.push('/settings')}
          loading={analyzing}
          hasModel={hasModel}
        />
        <Snackbar
          open={!!error}
          autoHideDuration={8000}
          onClose={() => setError(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert onClose={() => setError(null)} severity="error" variant="filled">
            {error}
          </Alert>
        </Snackbar>
      </div>
    </ThemeProvider>
  );
}
