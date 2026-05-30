'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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

  useEffect(() => {
    setEntries(loadLocalHistory());
  }, []);

  const refreshEntries = () => {
    setEntries(loadLocalHistory());
  };

  const handleDelete = (analysisRunId: string) => {
    removeLocalHistoryEntry(analysisRunId);
    refreshEntries();
  };

  const handleClear = () => {
    clearLocalHistory();
    refreshEntries();
  };

  const handleOpen = (entry: LocalAnalysisHistoryEntry) => {
    router.push(`/analysis/${entry.analysisRunId}`);
  };

  const handleReanalyze = async (entry: LocalAnalysisHistoryEntry) => {
    try {
      setBusyId(entry.analysisRunId);
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prUrl: entry.prUrl,
          depth: entry.data.depth,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `分析失败 (${response.status})`);
      }

      const analysis = data as AnalysisResponse;
      if (analysis.analysisRunId) {
        saveLocalHistoryEntry({
          analysisRunId: analysis.analysisRunId,
          prUrl: analysis.prUrl ?? entry.prUrl,
          savedAt: analysis.analyzedAt ?? new Date().toISOString(),
          data: analysis,
        });
        refreshEntries();
        router.push(`/analysis/${analysis.analysisRunId}`);
      }
    } catch (error) {
      console.error('Failed to reanalyze entry:', error);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={busyId ? 'opacity-90' : undefined}>
      <HistoryPage
        entries={entries}
        onBack={() => router.push('/')}
        onOpen={handleOpen}
        onDelete={handleDelete}
        onClear={handleClear}
        onReanalyze={handleReanalyze}
      />
    </div>
  );
}
