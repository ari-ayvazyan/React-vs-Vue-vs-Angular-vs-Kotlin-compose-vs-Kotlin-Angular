import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { StoreService } from './store.service';
import { ToastService } from './toast.service';

/**
 * Root-level Pomodoro timer so it keeps running across navigation.
 * Elapsed time is committed to the task's timeSpentMinutes on pause/finish/reset;
 * sub-minute remainders are carried over per task so nothing is lost.
 */
@Injectable({ providedIn: 'root' })
export class PomodoroService {
  private readonly store = inject(StoreService);
  private readonly toast = inject(ToastService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private interval: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private carrySeconds = new Map<string, number>();

  readonly taskId = signal<string | null>(null);
  readonly running = signal(false);
  /** Seconds elapsed in the current session that are already "banked" (before the latest start). */
  private readonly bankedSeconds = signal(0);
  private readonly tick = signal(0);

  readonly durationSeconds = computed(() => this.store.settings().pomodoroMinutes * 60);
  readonly elapsedSeconds = computed(() => {
    this.tick();
    const live = this.running() ? (Date.now() - this.startedAt) / 1000 : 0;
    return Math.min(this.durationSeconds(), this.bankedSeconds() + live);
  });
  readonly remainingSeconds = computed(() =>
    Math.max(0, Math.ceil(this.durationSeconds() - this.elapsedSeconds())),
  );
  readonly label = computed(() => {
    const s = this.remainingSeconds();
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  });
  readonly progress = computed(() => this.elapsedSeconds() / this.durationSeconds());
  readonly task = computed(() => {
    const id = this.taskId();
    return id ? this.store.taskMap().get(id) : undefined;
  });

  isActiveFor(taskId: string): boolean {
    return this.taskId() === taskId;
  }

  start(taskId: string): void {
    if (!this.isBrowser) return;
    if (this.taskId() && this.taskId() !== taskId) this.reset();
    this.taskId.set(taskId);
    if (this.running()) return;
    this.startedAt = Date.now();
    this.running.set(true);
    this.interval = setInterval(() => {
      this.tick.update((v) => v + 1);
      if (this.remainingSeconds() <= 0) this.finish();
    }, 250);
  }

  pause(): void {
    if (!this.running()) return;
    const seconds = (Date.now() - this.startedAt) / 1000;
    const capped = Math.min(seconds, this.durationSeconds() - this.bankedSeconds());
    this.stopInterval();
    this.bankedSeconds.update((b) => b + capped);
    this.commit(capped);
  }

  reset(): void {
    this.pause();
    this.bankedSeconds.set(0);
    this.taskId.set(null);
  }

  private finish(): void {
    this.pause();
    const title = this.task()?.title ?? 'task';
    this.bankedSeconds.set(0);
    this.taskId.set(null);
    this.toast.show(`Pomodoro finished for “${title}”. Take a break!`, { kind: 'success' });
  }

  private stopInterval(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.running.set(false);
  }

  private commit(seconds: number): void {
    const id = this.taskId();
    if (!id) return;
    const total = (this.carrySeconds.get(id) ?? 0) + seconds;
    const minutes = Math.floor(total / 60);
    this.carrySeconds.set(id, total - minutes * 60);
    if (minutes > 0) this.store.addTime(id, minutes);
  }
}
