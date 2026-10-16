import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DateFmt, Limits, Member, PROJECT_PALETTE, Theme, validateMember } from '../../core/kt';
import { StoreService } from '../../core/store.service';
import { UiService } from '../../core/ui.service';
import { Dialog } from '../../shared/dialog';
import { Autofocus } from '../../shared/autofocus';
import { Avatar } from '../../shared/avatar';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';

@Component({
  selector: 'app-settings',
  imports: [Icon, Dialog, Skeleton, Avatar, Autofocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.html',
})
export class SettingsPage {
  protected readonly store = inject(StoreService);
  private readonly ui = inject(UiService);
  protected readonly themes = Theme.all;
  protected readonly pageSizes = Limits.PAGE_SIZES;
  protected readonly limits = Limits;
  protected readonly importError = signal('');
  protected readonly importInfo = signal('');
  protected readonly confirmReset = signal(false);
  protected readonly pomodoroError = signal('');

  // ---- team members ----
  protected readonly palette = PROJECT_PALETTE;
  protected readonly maxMemberName = Limits.MEMBER_NAME_MAX;
  protected readonly newMemberName = signal('');
  protected readonly newMemberColor = signal(PROJECT_PALETTE[0]);
  protected readonly memberError = signal('');
  protected readonly editingMember = signal<string | null>(null);
  protected readonly editMemberName = signal('');
  protected readonly editMemberColor = signal('');
  protected readonly editMemberError = signal('');
  protected readonly deletingMember = signal<Member | null>(null);
  protected readonly openCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const t of this.store.tasks()) {
      if (t.assigneeId) counts.set(t.assigneeId, (counts.get(t.assigneeId) ?? 0) + 1);
    }
    return counts;
  });

  protected addMember(e: Event): void {
    e.preventDefault();
    const err = validateMember(this.newMemberName(), this.newMemberColor());
    this.memberError.set(err);
    if (err) return;
    this.store.createMember(this.newMemberName(), this.newMemberColor());
    this.ui.toast(`Added ${this.newMemberName().trim()}`, { tone: 'success' });
    this.newMemberName.set('');
    this.newMemberColor.set(PROJECT_PALETTE[this.store.members().length % PROJECT_PALETTE.length]);
  }

  protected startEditMember(m: Member): void {
    this.editingMember.set(m.id);
    this.editMemberName.set(m.name);
    this.editMemberColor.set(m.color);
    this.editMemberError.set('');
  }

  protected saveMember(e: Event): void {
    e.preventDefault();
    const id = this.editingMember();
    if (!id) return;
    const err = validateMember(this.editMemberName(), this.editMemberColor());
    this.editMemberError.set(err);
    if (err) return;
    this.store.updateMember(id, this.editMemberName(), this.editMemberColor());
    this.editingMember.set(null);
  }

  protected confirmDeleteMember(): void {
    const m = this.deletingMember();
    if (!m) return;
    const n = this.store.deleteMember(m.id);
    this.deletingMember.set(null);
    this.ui.toast(`Removed ${m.name}${n ? ` · ${n} task${n === 1 ? '' : 's'} unassigned` : ''}`, {
      actionLabel: 'Undo',
      action: () => this.store.undo(),
    });
  }

  protected themeLabel(t: string): string {
    return t === 'system' ? 'System' : t === 'dark' ? 'Dark' : 'Light';
  }

  protected setPomodoro(value: string): void {
    const n = Number(value);
    if (!Number.isInteger(n) || n < Limits.POMODORO_MIN || n > Limits.POMODORO_MAX) {
      this.pomodoroError.set(`Enter a whole number between ${Limits.POMODORO_MIN} and ${Limits.POMODORO_MAX}.`);
      return;
    }
    this.pomodoroError.set('');
    this.store.setPomodoroMinutes(n);
  }

  protected exportData(): void {
    const blob = new Blob([this.store.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `taskpilot-${DateFmt.today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.ui.toast('Exported data as JSON', { tone: 'success' });
  }

  protected async importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importError.set('');
    this.importInfo.set('');
    let text: string;
    try {
      text = await file.text();
    } catch {
      this.importError.set('Could not read the file.');
      return;
    }
    const result = this.store.importJson(text);
    if (!result.ok) {
      this.importError.set(result.error);
      return;
    }
    const migrated = result.sourceSchema < 2 ? ' The file used the old format and was upgraded.' : '';
    const msg = `Imported ${result.taskCount} tasks and ${result.projectCount} projects.${migrated}`;
    this.importInfo.set(msg);
    this.ui.toast(msg, { tone: 'success', actionLabel: 'Undo', action: () => this.store.undo() });
  }

  protected reset(): void {
    this.store.resetDemoData();
    this.confirmReset.set(false);
    this.ui.toast('Demo data restored (300 tasks)', { tone: 'success' });
  }
}
