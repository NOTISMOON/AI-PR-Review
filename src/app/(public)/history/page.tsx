'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Snackbar, Alert } from '@mui/material';
import HistoryPage from '@/app/components/HistoryPage';
import {
  clearLocalHistory,
  loadLocalHistory,
  removeLocalHistoryEntry,
  saveLocalHistoryEntry,
} from '@/lib/local-history';
import type { AnalysisResponse, LocalAnalysisHistoryEntry } from '@/types/analysis';

export default function HistoryRoutePage() {
  const router = useRouter();
  const [entries, setEntries] = useState<LocalAnalysisHistoryEntry[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setEntries(loadLocalHistory());
  }, []);

  const handleDelete = (analysisRunId: string) => {
    removeLocalHistoryEntry(analysisRunId);
    setEntries((prev) => prev.filter((e) => e.analysisRunId !== analysisRunId));
  };

  const handleClear = () => {
    clearLocalHistory();
    setEntries([]);
  };

  const handleOpen = (entry: LocalAnalysisHistoryEntry) => {
    router.push(`/analysis/${entry.analysisRunId}`);
  };

  const handleReanalyze = async (entry: LocalAnalysisHistoryEntry, depth: string) => {
    try {
      setBusyId(entry.analysisRunId);
      setErrorMessage(null);

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
          prUrl: entry.prUrl,
          depth,
          githubToken,
          customModels: activeModel ? [activeModel] : undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `分析失败 (${response.status})`);
      }

      const analysis = data as AnalysisResponse;
      if (analysis.analysisRunId) {
        const newEntry = {
          analysisRunId: analysis.analysisRunId,
          prUrl: analysis.prUrl ?? entry.prUrl,
          savedAt: analysis.analyzedAt ?? new Date().toISOString(),
          data: analysis,
        };
        saveLocalHistoryEntry(newEntry);
        setEntries((prev) => [newEntry, ...prev.filter((e) => e.analysisRunId !== newEntry.analysisRunId)]);
        router.push(`/analysis/${analysis.analysisRunId}`);
      }
    } catch (error) {
      console.error('Failed to reanalyze entry:', error);
      setErrorMessage(error instanceof Error ? error.message : '重新分析失败，请稍后重试');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <HistoryPage
        entries={entries}
        onBack={() => router.push('/')}
        onOpen={handleOpen}
        onDelete={handleDelete}
        onClear={handleClear}
        onReanalyze={handleReanalyze}
        busyId={busyId}
      />
      <Snackbar
        open={!!errorMessage}
        autoHideDuration={6000}
        onClose={() => setErrorMessage(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setErrorMessage(null)} severity="error" sx={{ width: '100%' }}>
          {errorMessage}
        </Alert>
      </Snackbar>
    </>
  );
}
