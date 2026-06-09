import { buildLocalHistoryEntry, saveLocalHistoryEntry } from '@/lib/local-history';
import type { AnalysisResponse, SSEEvent, AnalyzeRequest } from '@/styles/types/analysis';
import type { AnalyzeProgress } from '@/app/components/PRAnalyzer';

// ── types ─────────────────────────────────────────────────────────────

export interface AnalysisTask {
  id: string;
  prUrl: string;
  depth: string;
  reviewMode: boolean;
  originPage: 'home' | 'history';
  /** 历史页重分析时，被点击条目的 analysisRunId（用于精确高亮） */
  targetEntryId?: string;
  status: 'running' | 'done' | 'error';
  /** live progress snapshot (only meaningful while status === 'running') */
  progress: AnalyzeProgress;
  /** set once the stream completes */
  analysisRunId?: string;
  result?: AnalysisResponse;
  error?: string;
  startedAt: number;
}

type Listener = () => void;

// ── module-level state (survives component unmount / navigation) ─────

const tasks = new Map<string, AnalysisTask>();
const listeners = new Set<Listener>();

let nextId = 0;

/** Auto-remove done/error tasks after this many ms */
const DONE_TTL = 5 * 60_000;

// ── stable snapshots for useSyncExternalStore ────────────────────────
//
// CRITICAL: getSnapshot() and getServerSnapshot() MUST return the
// same reference when nothing changed.  Object.is is the arbiter.
// A new [] or Array.from() every call causes mountSyncExternalStore
// hydration failures and infinite re-render loops.

let snapshotVersion = 0;                   // bumped on every notify()
let cachedSnapshotVersion = -1;            // the version last snapshotted
/** Shared empty array singleton — BOTH getSnapshot and getServerSnapshot
 *  return this exact reference when there are no tasks, so Object.is
 *  equality holds during SSR hydration. */
const EMPTY_SNAPSHOT: AnalysisTask[] = [];

let cachedSnapshot: AnalysisTask[] = EMPTY_SNAPSHOT;

function rebuildSnapshot() {
  cachedSnapshotVersion = snapshotVersion;
  cachedSnapshot = Array.from(tasks.values());
}

// ── private helpers ───────────────────────────────────────────────────

function genId(): string {
  nextId += 1;
  return `task-${nextId}-${Date.now()}`;
}

function notify() {
  snapshotVersion += 1;
  // Defer rebuild to getSnapshot() — avoids wasted work when
  // multiple updates happen in the same synchronous tick.
  listeners.forEach((fn) => fn());
}

function update(id: string, patch: Partial<AnalysisTask>) {
  const prev = tasks.get(id);
  if (!prev) return;
  const next = { ...prev, ...patch };
  tasks.set(id, next);
  notify();

  // schedule cleanup for terminal states
  if (next.status === 'done' || next.status === 'error') {
    setTimeout(() => {
      tasks.delete(id);
      notify();
    }, DONE_TTL);
  }
}

// ── public store API ──────────────────────────────────────────────────

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): AnalysisTask[] {
  if (cachedSnapshotVersion !== snapshotVersion) {
    rebuildSnapshot();
  }
  return cachedSnapshot;
}

/** Server-side snapshot — always the same empty array singleton. */
export function getServerSnapshot(): AnalysisTask[] {
  return EMPTY_SNAPSHOT;
}

/** Kick off a streaming analysis; returns the task id immediately.
 *  The caller can read progress from the snapshot, and the watcher
 *  (AnalysisTasksWatcher) will show global notifications on completion. */
export function startAnalysis(params: {
  prUrl: string;
  depth: string;
  reviewMode?: boolean;
  skipCache?: boolean;
  originPage: AnalysisTask['originPage'];
  targetEntryId?: string;
}): string {
  const id = genId();
  const reviewMode = params.reviewMode ?? false;
  const skipCache = params.skipCache ?? false;
  const progress: AnalyzeProgress = {
    phase: 'fetching',
    message: '正在准备分析...',
    riskCount: 0,
    commentCount: 0,
    hasSummary: false,
  };

  tasks.set(id, {
    id,
    prUrl: params.prUrl,
    depth: params.depth,
    reviewMode,
    originPage: params.originPage,
    targetEntryId: params.targetEntryId,
    status: 'running',
    progress,
    startedAt: Date.now(),
  });
  notify();

  void executeAnalysis(id, { ...params, reviewMode, skipCache });
  return id;
}

// ── fetch + SSE consumption loop ──────────────────────────────────────

function readCredentials(): {
  githubToken: string | undefined;
  customModels: any[] | undefined;
} {
  let githubToken: string | undefined;
  let customModels: any[] | undefined;

  try {
    githubToken = localStorage.getItem('github_token') || undefined;
  } catch {
    // localStorage unavailable (SSR guard)
  }
  try {
    const storedModels = localStorage.getItem('local_models');
    const allModels = storedModels ? JSON.parse(storedModels) : [];
    const activeModel = allModels.find((m: any) => m.isActive);
    customModels = activeModel ? [activeModel] : undefined;
  } catch {
    // ignore parse errors
  }

  return { githubToken, customModels };
}

const PHASE_MESSAGES: Record<AnalyzeProgress['phase'], string> = {
  fetching: '正在拉取 PR 代码变更与上下文...',
  analyzing: '正在调用模型分析代码变更...',
  validating: '正在校验与整理分析结果...',
};

async function executeAnalysis(
  id: string,
  params: { prUrl: string; depth: string; reviewMode: boolean; skipCache: boolean },
) {
  // --- 1. fetch + request ---
  const { githubToken, customModels } = readCredentials();

  let response: Response;
  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        prUrl: params.prUrl,
        depth: params.depth as AnalyzeRequest['depth'],
        reviewMode: params.reviewMode,
        skipCache: params.skipCache || undefined,
        githubToken,
        customModels,
      } satisfies Partial<AnalyzeRequest>),
    });
  } catch (err: any) {
    update(id, { status: 'error', error: err.message || '网络请求失败' });
    return;
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.ok || !contentType.includes('text/event-stream') || !response.body) {
    let message = `分析失败 (${response.status})`;
    try {
      const errData = await response.json().catch(() => ({}));
      message = errData.error || message;
    } catch {
      // ignore
    }
    update(id, { status: 'error', error: message });
    return;
  }

  // --- 2. consume SSE stream ---
  return consumeAnalysisStream(id, response.body);
}

async function consumeAnalysisStream(
  id: string,
  body: ReadableStream<Uint8Array>,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let current: AnalyzeProgress = {
    phase: 'fetching',
    message: PHASE_MESSAGES.fetching,
    riskCount: 0,
    commentCount: 0,
    hasSummary: false,
  };
  let result: AnalysisResponse | null = null;

  const handleEvent = (event: SSEEvent) => {
    switch (event.type) {
      case 'progress':
        current = {
          ...current,
          phase: event.phase,
          message: event.message || PHASE_MESSAGES[event.phase],
        };
        update(id, { progress: current });
        break;
      case 'partial':
        if (event.payloadType === 'risk') {
          current = { ...current, riskCount: current.riskCount + 1 };
        } else if (event.payloadType === 'comment') {
          current = { ...current, commentCount: current.commentCount + 1 };
        } else if (event.payloadType === 'summary') {
          current = { ...current, hasSummary: true };
        }
        update(id, { progress: current });
        break;
      case 'complete':
        result = event.response;
        break;
      case 'error':
        throw new Error(event.message);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let separatorIndex: number;
      while ((separatorIndex = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const dataLine = rawEvent
          .split('\n')
          .find((line) => line.startsWith('data:'));
        if (!dataLine) continue;

        const payload = dataLine.slice('data:'.length).trim();
        if (!payload) continue;

        handleEvent(JSON.parse(payload) as SSEEvent);
      }
    }

    if (!result) {
      throw new Error('分析流意外结束，未收到完整结果');
    }

    try {
      saveLocalHistoryEntry(buildLocalHistoryEntry(result));
    } catch (err) {
      console.error('Failed to save local history from task store:', err);
    }

    update(id, {
      status: 'done',
      analysisRunId: result.analysisRunId,
      result,
      progress: current,
    });
  } catch (err: any) {
    update(id, {
      status: 'error',
      error: err.message || '分析过程中出现未知错误',
      progress: current,
    });
  } finally {
    reader.cancel().catch(() => {
      // already closed
    });
  }
}
