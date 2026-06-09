"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Snackbar } from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import PRAnalyzer from '../components/PRAnalyzer';
import {
  subscribe,
  getSnapshot,
  getServerSnapshot,
  startAnalysis,
  type AnalysisTask,
} from '@/lib/analysis-tasks-store';
import type { AnalyzeRequest } from '@/styles/types/analysis';

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
  const [error, setError] = useState<string | null>(null);
  const [hasModel, setHasModel] = useState(true);

  const tasks = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Track which terminal task IDs we've already handled (navigated / errored)
  const handledTerminalRef = useRef<Set<string>>(new Set());
  // On first render after mount, skip tasks that were already done
  // (they completed while we were away — the watcher already handled them)
  const isFirstCheck = useRef(true);

  useEffect(() => {
    // Check if user has configured a model
    const storedModels = localStorage.getItem('local_models');
    const allModels = storedModels ? JSON.parse(storedModels) : [];
    const activeModel = allModels.find((m: any) => m.isActive);
    setHasModel(!!activeModel);
  }, []);

  const navigateOnComplete = useCallback(
    (task: AnalysisTask) => {
      if (task.analysisRunId) {
        router.push(`/analysis/${task.analysisRunId}`);
      }
    },
    [router],
  );

  // 只关心首页发起的任务，不展示其他页（如历史页）的进度
  const activeTask = tasks.find(
    (t) => t.status === 'running' && t.originPage === 'home',
  ) ?? null;

  // 处理首页发起任务的完成/失败——直接从 store 推导，
  // 切换页面再回来也能正确跳转或报错
  useEffect(() => {
    const handled = handledTerminalRef.current;

    // 首次检查：预注册所有已完成的任务，防止对切走期间已由
    // watcher 弹过 toast 的任务重复导航
    if (isFirstCheck.current) {
      isFirstCheck.current = false;
      for (const task of tasks) {
        if (task.originPage === 'home' && (task.status === 'done' || task.status === 'error')) {
          handled.add(task.id);
        }
      }
      return;
    }

    for (const task of tasks) {
      if (task.originPage !== 'home') continue;
      if (task.status !== 'done' && task.status !== 'error') continue;
      if (handled.has(task.id)) continue;

      handled.add(task.id);

      if (task.status === 'done') {
        navigateOnComplete(task);
      } else {
        setError(task.error ?? '分析过程中出现未知错误');
      }
    }
  }, [tasks, navigateOnComplete]);

  const handleAnalyze = async (prUrl: string, options?: Partial<AnalyzeRequest>) => {
    setError(null);

    startAnalysis({
      prUrl,
      depth: options?.depth ?? 'standard',
      reviewMode: options?.reviewMode,
      originPage: 'home',
    });
  };

  const isAnalyzing = activeTask !== null;

  return (
    <ThemeProvider theme={theme}>
      <div className="size-full">
        <PRAnalyzer
          onAnalyze={handleAnalyze}
          onOpenHistory={() => router.push('/history')}
          onOpenSettings={() => router.push('/settings')}
          loading={isAnalyzing}
          progress={activeTask?.progress ?? null}
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
