"use client";

import { useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { Alert, Snackbar } from '@mui/material';
import PRAnalyzer from '../components/PRAnalyzer';
import AnalysisResults from '../components/AnalysisResults';
import type { AnalysisData, AnalyzeRequest } from '../../types/analysis';

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
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async (prUrl: string, options?: Partial<AnalyzeRequest>) => {
    setAnalyzing(true);
    setError(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prUrl, ...options }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `分析失败 (${response.status})`);
      }

      setAnalysisData(data as AnalysisData);
    } catch (err: any) {
      setError(err.message || '分析过程中出现未知错误，请稍后重试');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleBack = () => {
    setAnalysisData(null);
    setError(null);
  };

  return (
    <ThemeProvider theme={theme}>
      <div className="size-full">
        {!analysisData ? (
          <PRAnalyzer onAnalyze={handleAnalyze} loading={analyzing} />
        ) : (
          <AnalysisResults data={analysisData} onBack={handleBack} />
        )}
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
