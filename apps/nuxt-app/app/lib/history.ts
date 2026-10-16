/** Framework-agnostic undo/redo stack of immutable snapshots. */
export interface History<T> {
  past: T[];
  future: T[];
  limit: number;
}

export function createHistory<T>(limit = 50): History<T> {
  return { past: [], future: [], limit };
}

/** Record `current` before a mutation. Clears the redo stack. */
export function record<T>(h: History<T>, current: T): History<T> {
  const past = [...h.past, current];
  if (past.length > h.limit) past.splice(0, past.length - h.limit);
  return { ...h, past, future: [] };
}

/** Returns the state to restore plus the new history, or null when nothing to undo. */
export function undo<T>(h: History<T>, current: T): { state: T; history: History<T> } | null {
  if (h.past.length === 0) return null;
  const past = h.past.slice(0, -1);
  const state = h.past[h.past.length - 1] as T;
  return { state, history: { ...h, past, future: [current, ...h.future] } };
}

export function redo<T>(h: History<T>, current: T): { state: T; history: History<T> } | null {
  if (h.future.length === 0) return null;
  const [state, ...future] = h.future as [T, ...T[]];
  return { state, history: { ...h, past: [...h.past, current], future } };
}
