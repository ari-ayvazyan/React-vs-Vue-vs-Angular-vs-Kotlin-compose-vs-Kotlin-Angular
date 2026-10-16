import { DestroyRef, Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DateFmt, PomodoroTimer } from './kt';
import { StoreService } from './store.service';
import { UiService } from './ui.service';

/** Drives the Kotlin `PomodoroTimer` with a browser interval and exposes it as signals. */
@Injectable({ providedIn: 'root' })
export class PomodoroService {
  private readonly store = inject(StoreService);
  private readonly ui = inject(UiService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly timer = new PomodoroTimer();
  private readonly now = signal(0);
  private readonly version = signal(0);
  private interval: ReturnType<typeof setInterval> | null = null;

  readonly taskId = computed(() => (this.version(), this.timer.taskId ?? null));
  readonly running = computed(() => (this.version(), this.timer.running));
  readonly finished = computed(() => (this.version(), this.timer.finished));
  readonly active = computed(() => (this.version(), this.timer.active));
  readonly remainingSeconds = computed(() => {
    this.version();
    return this.timer.active ? this.timer.remainingSeconds(this.now()) : this.store.settings().pomodoroMinutes * 60;
  });
  readonly progress = computed(() => (this.version(), this.timer.progress(this.now())));
  readonly display = computed(() => DateFmt.clock(this.remainingSeconds()));
  readonly taskTitle = computed(() => {
    const id = this.taskId();
    return id ? (this.store.task(id)?.title ?? '') : '';
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopInterval());
  }

  start(taskId: string): boolean {
    const ok = this.timer.start(taskId, this.store.settings().pomodoroMinutes, Date.now());
    if (!ok) {
      this.ui.toast('Another task has an active pomodoro. Reset it first.', { tone: 'error' });
      return false;
    }
    this.startInterval();
    this.bump();
    return true;
  }

  pause(): void {
    this.credit(this.timer.pause(Date.now()));
    this.stopInterval();
    this.bump();
  }

  reset(): void {
    this.credit(this.timer.reset(Date.now()));
    this.stopInterval();
    this.bump();
  }

  private tick(): void {
    const now = Date.now();
    this.now.set(now);
    const credit = this.timer.tick(now);
    if (credit >= 0) {
      this.credit(credit);
      this.stopInterval();
      this.bump();
      this.ui.toast(`Pomodoro finished: ${this.taskTitle()}`, { tone: 'success' });
    }
  }

  private credit(minutes: number): void {
    const id = this.timer.taskId;
    if (id && minutes > 0) this.store.addTimeSpent(id, minutes);
  }

  private bump(): void {
    this.now.set(Date.now());
    this.version.update((v) => v + 1);
  }

  private startInterval(): void {
    if (!this.isBrowser || this.interval) return;
    this.interval = setInterval(() => this.tick(), 250);
  }

  private stopInterval(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }
}
