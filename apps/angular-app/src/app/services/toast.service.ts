import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
  actionLabel?: string;
  action?: () => void;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly toasts = signal<Toast[]>([]);

  show(
    message: string,
    opts: Partial<Omit<Toast, 'id' | 'message'>> & { duration?: number } = {},
  ): number {
    const id = ++this.seq;
    const { duration = 5000, ...rest } = opts;
    this.toasts.update((list) => [...list.slice(-3), { id, message, kind: 'info', ...rest }]);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), duration),
    );
    return id;
  }

  dismiss(id: number): void {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    this.toasts.update((list) => list.filter((x) => x.id !== id));
  }

  runAction(toast: Toast): void {
    toast.action?.();
    this.dismiss(toast.id);
  }
}
