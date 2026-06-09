'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Snackbar, Alert } from '@mui/material';
import HistoryPage from '@/app/components/HistoryPage';
import {
  clearLocalHistory,
  loadLocalHistory,
  removeLocalHistoryEntry,
} from '@/lib/local-history';
import {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  startAnalysis,
  type AnalysisTask,
} from '@/lib/analysis-tasks-store';
import type { LocalAnalysisHistoryEntry } from '@/styles/types/analysis';

export default function HistoryRoutePage() {
  const router = useRouter();
  const [entries, setEntries] = useState<LocalAnalysisHistoryEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tasks = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Track which terminal task IDs we've already handled
  const handledTerminalRef = useRef<Set<string>>(new Set());
  const isFirstCheck = useRef(true);

  useEffect(() => {
    setEntries(loadLocalHistory());
  }, []);

  // Navigate when a reanalysis task completes while we're still mounted
  const onComplete = useCallback(
    (task: AnalysisTask) => {
      if (task.analysisRunId) {
        router.push(`/analysis/${task.analysisRunId}`);
      }
    },
    [router],
  );

  // Process terminal (done/error) history-origin tasks
  useEffect(() => {
    const handled = handledTerminalRef.current;

    // 首次检查：预注册所有已完成的任务，防止对切走期间已由
    // watcher 弹过 toast 的任务重复导航
    if (isFirstCheck.current) {
      isFirstCheck.current = false;
      for (const task of tasks) {
        if (task.originPage === 'history' && (task.status === 'done' || task.status === 'error')) {
          handled.add(task.id);
        }
      }
      return;
    }

    for (const task of tasks) {
      if (task.originPage !== 'history') continue;
      if (task.status !== 'done' && task.status !== 'error') continue;
      if (handled.has(task.id)) continue;

      handled.add(task.id);

      if (task.status === 'done') {
        onComplete(task);
      } else {
        setErrorMessage(task.error ?? '重新分析失败，请稍后重试');
      }
    }
  }, [tasks, onComplete]);

  // 只关心历史页发起的运行中任务
  const runningHistoryTasks = tasks.filter(
    (t) => t.status === 'running' && t.originPage === 'history',
  );

  // 精确匹配：task 记录了被点击条目的 analysisRunId，不受 prUrl 重复影响
  const busyTargetIds = new Set(
    runningHistoryTasks.map((t) => t.targetEntryId).filter(Boolean) as string[],
  );
  const busyId: string | null = busyTargetIds.size > 0
    ? [...busyTargetIds][0]
    : null;

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

  const handleReanalyze = (entry: LocalAnalysisHistoryEntry, depth: string, reviewMode: boolean) => {
    setErrorMessage(null);

    startAnalysis({
      prUrl: entry.prUrl,
      depth,
      reviewMode,
      skipCache: true,
      originPage: 'history',
      targetEntryId: entry.analysisRunId,
    });
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
