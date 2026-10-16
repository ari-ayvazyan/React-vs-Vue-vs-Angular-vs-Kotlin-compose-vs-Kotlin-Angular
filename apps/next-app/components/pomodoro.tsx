'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { dispatch, getStore } from './store-hooks';
import { useToast } from './toast';

interface TimerState {
  taskId: string | null;
  running: boolean;
  /** epoch ms when the current running segment started */
  segmentStart: number;
  /** ms elapsed in this pomodoro before the current segment */
  elapsedBefore: number;
  durationMs: number;
  /** last tick timestamp (drives re-render while running) */
  now: number;
}

type TimerAction =
  | { type: 'start'; taskId: string; now: number; durationMs: number }
  | { type: 'pause'; now: number }
  | { type: 'reset' }
  | { type: 'tick'; now: number };

const IDLE: TimerState = { taskId: null, running: false, segmentStart: 0, elapsedBefore: 0, durationMs: 0, now: 0 };

function timerReducer(s: TimerState, a: TimerAction): TimerState {
  switch (a.type) {
    case 'start':
      if (s.taskId === a.taskId && s.durationMs) return { ...s, running: true, segmentStart: a.now, now: a.now };
      return { taskId: a.taskId, running: true, segmentStart: a.now, elapsedBefore: 0, durationMs: a.durationMs, now: a.now };
    case 'pause':
      if (!s.running) return s;
      return { ...s, running: false, elapsedBefore: s.elapsedBefore + (a.now - s.segmentStart), now: a.now };
    case 'reset':
      return IDLE;
    case 'tick':
      return { ...s, now: a.now };
  }
}

export interface PomodoroApi {
  taskId: string | null;
  running: boolean;
  /** true when a pomodoro is started or paused (not idle) */
  active: boolean;
  remainingMs: number;
  durationMs: number;
  start: (taskId: string) => void;
  pause: () => void;
  reset: () => void;
}

const PomodoroContext = createContext<PomodoroApi | null>(null);

export function usePomodoro(): PomodoroApi {
  const ctx = useContext(PomodoroContext);
  if (!ctx) throw new Error('usePomodoro must be used inside <PomodoroProvider>');
  return ctx;
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const [state, send] = useReducer(timerReducer, IDLE);
  const toast = useToast();
  const stateRef = useRef(state);
  /** Sub-minute remainder carried between segments so seconds are not lost. */
  const carryMs = useRef(0);
  useEffect(() => {
    stateRef.current = state;
  });

  /** Adds the elapsed time of the running segment to the task. */
  const credit = useCallback((s: TimerState, now: number) => {
    if (!s.running || !s.taskId) return;
    const segment = Math.min(now - s.segmentStart, s.durationMs - s.elapsedBefore);
    const total = carryMs.current + Math.max(0, segment);
    const minutes = Math.floor(total / 60_000);
    carryMs.current = total - minutes * 60_000;
    if (minutes > 0) dispatch({ type: 'task/addTime', id: s.taskId, minutes });
  }, []);

  const pause = useCallback(() => {
    const now = Date.now();
    credit(stateRef.current, now);
    send({ type: 'pause', now });
  }, [credit]);

  const reset = useCallback(() => {
    credit(stateRef.current, Date.now());
    carryMs.current = 0;
    send({ type: 'reset' });
  }, [credit]);

  const start = useCallback(
    (taskId: string) => {
      const s = stateRef.current;
      const now = Date.now();
      if (s.taskId && s.taskId !== taskId) {
        credit(s, now);
        carryMs.current = 0;
      }
      const minutes = getStore().getSnapshot().state.settings.pomodoroMinutes;
      send({ type: 'start', taskId, now, durationMs: minutes * 60_000 });
    },
    [credit],
  );

  useEffect(() => {
    if (!state.running) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      const s = stateRef.current;
      if (s.durationMs - s.elapsedBefore - (now - s.segmentStart) <= 0) {
        credit(s, now);
        carryMs.current = 0;
        send({ type: 'reset' });
        toast('Pomodoro complete — time to take a break!', { tone: 'success' });
      } else {
        send({ type: 'tick', now });
      }
    }, 500);
    return () => window.clearInterval(id);
  }, [state.running, credit, toast]);

  // Credit time if the page is closed mid-pomodoro.
  useEffect(() => {
    const onHide = () => {
      const s = stateRef.current;
      if (s.running) {
        credit(s, Date.now());
        send({ type: 'pause', now: Date.now() });
        getStore().flush();
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [credit]);

  const value = useMemo<PomodoroApi>(() => {
    const elapsed = state.elapsedBefore + (state.running ? state.now - state.segmentStart : 0);
    return {
      taskId: state.taskId,
      running: state.running,
      active: state.taskId !== null,
      remainingMs: Math.max(0, state.durationMs - elapsed),
      durationMs: state.durationMs,
      start,
      pause,
      reset,
    };
  }, [state, start, pause, reset]);

  return <PomodoroContext.Provider value={value}>{children}</PomodoroContext.Provider>;
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
