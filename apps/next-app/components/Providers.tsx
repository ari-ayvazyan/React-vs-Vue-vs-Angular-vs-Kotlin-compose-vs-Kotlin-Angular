'use client';

import type { ReactNode } from 'react';
import { PomodoroProvider } from './pomodoro';
import { ToastProvider } from './toast';
import { UIProvider } from './ui';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <PomodoroProvider>
        <UIProvider>{children}</UIProvider>
      </PomodoroProvider>
    </ToastProvider>
  );
}
