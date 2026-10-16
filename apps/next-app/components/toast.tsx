'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { IconCheck, IconAlert, IconX } from './icons';
import { getStore } from './store-hooks';
import styles from './toast.module.css';

export interface ToastOptions {
  /** Shows an "Undo" button that reverts the last mutation. */
  undo?: boolean;
  tone?: 'default' | 'success' | 'error';
  duration?: number;
}

interface ToastItem extends Required<Omit<ToastOptions, 'duration'>> {
  id: number;
  message: string;
}

type Action = { type: 'add'; toast: ToastItem } | { type: 'remove'; id: number };

function reducer(state: ToastItem[], action: Action): ToastItem[] {
  switch (action.type) {
    case 'add':
      return [...state.slice(-3), action.toast];
    case 'remove':
      return state.filter((t) => t.id !== action.id);
  }
}

type ToastFn = (message: string, opts?: ToastOptions) => void;
const ToastContext = createContext<ToastFn>(() => {});

export function useToast(): ToastFn {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, send] = useReducer(reducer, []);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const remove = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    send({ type: 'remove', id });
  }, []);

  const toast = useCallback<ToastFn>(
    (message, opts = {}) => {
      const id = nextId.current++;
      send({ type: 'add', toast: { id, message, undo: opts.undo ?? false, tone: opts.tone ?? 'default' } });
      timers.current.set(
        id,
        setTimeout(() => remove(id), opts.duration ?? 5000),
      );
    },
    [remove],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  const value = useMemo(() => toast, [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.tone]}`} data-testid="toast">
            <span className={styles.icon} aria-hidden="true">
              {t.tone === 'error' ? <IconAlert size={16} /> : <IconCheck size={16} />}
            </span>
            <span className={styles.message}>{t.message}</span>
            {t.undo && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  getStore().undo();
                  remove(t.id);
                }}
              >
                Undo
              </button>
            )}
            <button type="button" className={styles.close} onClick={() => remove(t.id)} aria-label="Dismiss notification">
              <IconX size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
