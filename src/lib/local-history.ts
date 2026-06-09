import type { AnalysisResponse, LocalAnalysisHistoryEntry } from '@/styles/types/analysis';

const STORAGE_KEY = 'ai-review-history';
const MAX_HISTORY_ITEMS = 25;

function isBrowser() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined';
}

export function loadLocalHistory(): LocalAnalysisHistoryEntry[] {
  if (!isBrowser()) {
    return [];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as LocalAnalysisHistoryEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry) => entry?.analysisRunId && entry?.data)
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  } catch {
    return [];
  }
}

export function saveLocalHistoryEntry(entry: LocalAnalysisHistoryEntry) {
  if (!isBrowser()) {
    return;
  }

  const existing = loadLocalHistory().filter((item) => item.analysisRunId !== entry.analysisRunId);
  const next = [entry, ...existing].slice(0, MAX_HISTORY_ITEMS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function removeLocalHistoryEntry(analysisRunId: string) {
  if (!isBrowser()) {
    return;
  }

  const existing = loadLocalHistory().filter((item) => item.analysisRunId !== analysisRunId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function clearLocalHistory() {
  if (!isBrowser()) {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
}

export function getLocalHistoryEntry(analysisRunId: string) {
  return loadLocalHistory().find((entry) => entry.analysisRunId === analysisRunId) ?? null;
}

export function buildLocalHistoryEntry(data: AnalysisResponse) {
  if (!data.analysisRunId) {
    throw new Error('analysisRunId is required to save local history');
  }

  return {
    analysisRunId: data.analysisRunId,
    prUrl:
      data.prUrl ??
      `https://github.com/unknown/unknown/pull/${data.prInfo.number}`,
    savedAt: data.analyzedAt ?? new Date().toISOString(),
    data,
  } satisfies LocalAnalysisHistoryEntry;
}
