'use client';

import { useSyncExternalStore } from 'react';
import { toDateKey } from '@/lib/dates';
import type { DataAction } from '@/lib/reducer';
import { TaskStore, type StoreSnapshot } from '@/lib/store';
import { STORAGE_KEY, type AppState } from '@/lib/types';

let store: TaskStore | null = null;

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    s.getItem(STORAGE_KEY);
    return s;
  } catch {
    return null;
  }
}

/** The single client-side store instance (created lazily, never on the server). */
export function getStore(): TaskStore {
  if (!store) {
    store = new TaskStore(safeStorage(), window.location.search);
    const s = store;
    window.addEventListener('pagehide', s.flush);
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) s.reloadFromStorage();
    });
  }
  return store;
}

const subscribe = (l: () => void) => getStore().subscribe(l);
const getSnapshot = () => getStore().getSnapshot();
/** localStorage is client-only: the server (and the hydration pass) render the "loading" state. */
const getServerSnapshot = () => null;

export function useStoreSnapshot(): StoreSnapshot | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useAppState(): AppState | null {
  return useStoreSnapshot()?.state ?? null;
}

export function dispatch(action: DataAction) {
  getStore().dispatch(action);
}

export const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// "Today" as a reactive value (re-evaluated every minute so day rollover works).

const subscribeClock = (l: () => void) => {
  const id = window.setInterval(l, 60_000);
  return () => window.clearInterval(id);
};
const getToday = () => toDateKey(new Date());
const getServerToday = () => '';

/** Local date key; '' during SSR/hydration. */
export function useToday(): string {
  return useSyncExternalStore(subscribeClock, getToday, getServerToday);
}
