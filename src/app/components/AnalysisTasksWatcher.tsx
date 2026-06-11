'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Snackbar, Alert, Button } from '@mui/material';
import { subscribe, getSnapshot, getServerSnapshot, type AnalysisTask } from '@/lib/analysis-tasks-store';

interface Notification {
  id: string;
  taskId: string;
  message: string;
  analysisRunId?: string;
  isError: boolean;
}

let notifIdCounter = 0;

/**
 * Watches the global task store and shows toast notifications when
 * tasks finish (or error) while the user is NOT on the origin page.
 *
 * Key design:
 * - Only mark a task as “notified” when we actually enqueue a toast.
 * - If the task completes while the user IS on the origin page,
 *   do nothing yet.  The origin page handles it.  If the user then
 *   navigates away, the next render will see isOnOrigin=false and
 *   enqueue the notification.
 * - Queue-based: parallel completions don't clobber each other.
 */
export default function AnalysisTasksWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const tasks = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const [queue, setQueue] = useState<Notification[]>([]);
  const current = queue[0] ?? null;

  // Only contains task IDs for which we've actually enqueued a notification
  const notified = useRef(new Set<string>());

  useEffect(() => {
    const incoming: Notification[] = [];

    for (const task of tasks) {
      if (task.status !== 'done' && task.status !== 'error') continue;

      const isOnOrigin =
        (task.originPage === 'home' && pathname === '/') ||
        (task.originPage === 'history' && pathname === '/history');

      if (isOnOrigin) continue; // origin page handles it — don't notify
      if (notified.current.has(task.id)) continue; // already notified

      notified.current.add(task.id);
      notifIdCounter += 1;

      if (task.status === 'done') {
        const label = task.prUrl
          ? task.prUrl.split('/').slice(-3).join('/')
          : '未知 PR';
        const result = task.result;
        const message = result?.degradedFromReview
          ? `二次审查不可用，已切换为普通分析（${label}）`
          : result?.cacheHit
            ? `已返回缓存分析结果（${label}）`
            : task.reviewMode
              ? `二次审查完成（${label}）`
              : `分析完成（${label}）`;
        incoming.push({
          id: `notif-${notifIdCounter}`,
          taskId: task.id,
          message,
          analysisRunId: task.analysisRunId,
          isError: false,
        });
      } else {
        incoming.push({
          id: `notif-${notifIdCounter}`,
          taskId: task.id,
          message: task.error ?? '分析失败',
          isError: true,
        });
      }
    }

    if (incoming.length > 0) {
      setQueue((prev) => [...prev, ...incoming]);
    }

    // Clean up notified set for tasks that are gone (expired / collected)
    const currentIds = new Set(tasks.map((t) => t.id));
    for (const key of notified.current.keys()) {
      if (!currentIds.has(key)) notified.current.delete(key);
    }
  }, [tasks, pathname]);

  const handleView = useCallback(() => {
    if (current?.analysisRunId) {
      setQueue((prev) => prev.slice(1));
      router.push(`/analysis/${current.analysisRunId}`);
    }
  }, [current, router]);

  const dismissCurrent = useCallback(() => {
    setQueue((prev) => prev.slice(1));
  }, []);

  return (
    <>
      <Snackbar
        key={current?.id ?? 'empty'}
        open={!!current}
        autoHideDuration={current?.isError ? 6000 : 8000}
        onClose={dismissCurrent}
        anchorOrigin={
          current?.isError
            ? { vertical: 'top', horizontal: 'center' }
            : { vertical: 'bottom', horizontal: 'right' }
        }
      >
        <Alert
          onClose={dismissCurrent}
          severity={current?.isError ? 'error' : 'success'}
          variant="filled"
          action={
            current && !current.isError && current.analysisRunId ? (
              <Button color="inherit" size="small" onClick={handleView}>
                查看
              </Button>
            ) : undefined
          }
        >
          {current?.message}
        </Alert>
      </Snackbar>

      {queue.length > 1 && (
        <div className="pointer-events-none fixed bottom-3 right-3 z-[1400]">
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white shadow-lg">
            +{queue.length - 1}
          </span>
        </div>
      )}
    </>
  );
}
