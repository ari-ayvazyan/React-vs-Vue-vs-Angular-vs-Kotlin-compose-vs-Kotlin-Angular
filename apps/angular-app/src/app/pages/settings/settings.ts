import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { StoreService } from '../../services/store.service';
import { ThemeService } from '../../services/theme.service';
import { ToastService } from '../../services/toast.service';
import { MEMBER_COLORS, Member, Theme } from '../../core/models';
import { validateMemberName } from '../../core/members';
import { parseImport } from '../../core/validation';
import { toDateKey } from '../../core/dates';
import { downloadFile } from '../../utils/download';
import { Icon } from '../../components/icon';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { Avatar } from '../../components/avatar';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, ConfirmDialog, Avatar],
  templateUrl: './settings.html',
  styleUrl: './settings.css',
})
export class SettingsPage {
  protected readonly store = inject(StoreService);
  protected readonly theme = inject(ThemeService);
  private readonly toast = inject(ToastService);

  protected readonly themes: { value: Theme; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: 'sun' },
    { value: 'dark', label: 'Dark', icon: 'moon' },
    { value: 'system', label: 'System', icon: 'system' },
  ];
  protected readonly pageSizes = [10, 25, 50, 100];
  protected readonly pomodoroError = signal('');
  protected readonly importError = signal('');
  protected readonly importInfo = signal('');
  protected readonly confirmReset = signal(false);
  protected readonly demoCount = signal(300);

  // ---------- team members ----------
  protected readonly memberColors = MEMBER_COLORS;
  protected readonly newMemberName = signal('');
  protected readonly newMemberColor = signal(MEMBER_COLORS[0]);
  protected readonly newMemberError = signal('');
  protected readonly editingMember = signal<Member | null>(null);
  protected readonly editMemberError = signal('');
  protected readonly deletingMember = signal<Member | null>(null);
  /** Assigned task counts per member id. */
  protected readonly memberLoad = computed(() => {
    const out = new Map<string, { open: number; total: number }>();
    for (const t of this.store.tasks()) {
      if (!t.assigneeId) continue;
      const e = out.get(t.assigneeId) ?? { open: 0, total: 0 };
      e.total++;
      if (t.status !== 'done') e.open++;
      out.set(t.assigneeId, e);
    }
    return out;
  });

  protected value(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected setCurrentUser(id: string): void {
    this.store.updateSettings({ currentUserId: id || null });
  }

  protected addMember(e: Event): void {
    e.preventDefault();
    const err = validateMemberName(this.newMemberName(), this.store.members());
    this.newMemberError.set(err);
    if (err) {
      document.getElementById('new-member-name')?.focus();
      return;
    }
    const m = this.store.createMember(this.newMemberName(), this.newMemberColor());
    this.toast.show(`${m.name} added to the team`, { kind: 'success' });
    this.newMemberName.set('');
    const idx = (MEMBER_COLORS.indexOf(this.newMemberColor()) + 1) % MEMBER_COLORS.length;
    this.newMemberColor.set(MEMBER_COLORS[idx]);
  }

  protected startEditMember(m: Member): void {
    this.editingMember.set({ ...m });
    this.editMemberError.set('');
    setTimeout(() => document.getElementById(`member-name-${m.id}`)?.focus());
  }

  protected patchEditingMember(patch: Partial<Pick<Member, 'name' | 'color'>>): void {
    const cur = this.editingMember();
    if (cur) this.editingMember.set({ ...cur, ...patch });
    if (patch.name !== undefined) this.editMemberError.set('');
  }

  /** Name and colour are saved together, as one undo step. */
  protected saveMember(e: Event): void {
    e.preventDefault();
    const draft = this.editingMember();
    if (!draft) return;
    const err = validateMemberName(draft.name, this.store.members(), draft.id);
    this.editMemberError.set(err);
    if (err) return;
    const orig = this.store.memberMap().get(draft.id);
    const patch: Partial<Pick<Member, 'name' | 'color'>> = {};
    if (orig && draft.name.trim() !== orig.name) patch.name = draft.name;
    if (orig && draft.color !== orig.color && /^#[0-9a-fA-F]{6}$/.test(draft.color))
      patch.color = draft.color;
    if (Object.keys(patch).length) this.store.updateMember(draft.id, patch);
    this.editingMember.set(null);
    setTimeout(() => document.getElementById(`member-edit-${draft.id}`)?.focus());
  }

  protected cancelEditMember(): void {
    const id = this.editingMember()?.id;
    this.editingMember.set(null);
    this.editMemberError.set('');
    if (id) setTimeout(() => document.getElementById(`member-edit-${id}`)?.focus());
  }

  protected confirmDeleteMember(): void {
    const m = this.deletingMember();
    if (!m) return;
    this.store.deleteMember(m.id);
    this.deletingMember.set(null);
    this.toast.show(`${m.name} removed from the team`, {
      actionLabel: 'Undo',
      action: () => this.store.undo(),
    });
  }

  protected deleteMemberMessage(m: Member): string {
    const n = this.memberLoad().get(m.id)?.total ?? 0;
    return n
      ? `${n} task${n === 1 ? ' is' : 's are'} assigned to ${m.name}. ${n === 1 ? 'It' : 'They'} will become unassigned.`
      : `${m.name} has no assigned tasks.`;
  }

  protected setPomodoro(raw: string): void {
    const n = Number(raw);
    if (!/^\d+$/.test(raw.trim()) || n < 1 || n > 180) {
      this.pomodoroError.set('Enter a whole number of minutes between 1 and 180.');
      return;
    }
    this.pomodoroError.set('');
    this.store.updateSettings({ pomodoroMinutes: n });
  }

  protected setPageSize(raw: string): void {
    this.store.updateSettings({ pageSize: Number(raw) });
  }

  protected exportData(): void {
    downloadFile(
      `taskpilot-${toDateKey(new Date())}.json`,
      this.store.exportJson(),
      'application/json',
    );
    this.toast.show('Export downloaded', { kind: 'success' });
  }

  protected async importFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    this.importError.set('');
    this.importInfo.set('');
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) {
        this.importError.set('File is too large (max 20 MB).');
        return;
      }
      const text = await file.text();
      const res = parseImport(text);
      if (!res.ok) {
        this.importError.set(`Import failed: ${res.error}`);
        return;
      }
      this.store.replaceState(res.state);
      const msg = `Imported ${res.state.tasks.length} tasks and ${res.state.projects.length} projects.`;
      this.importInfo.set(msg);
      this.toast.show(msg, { kind: 'success' });
    } finally {
      input.value = '';
    }
  }

  protected setDemoCount(raw: string): void {
    const n = Math.round(Number(raw));
    this.demoCount.set(Number.isFinite(n) ? Math.min(Math.max(n, 0), 10000) : 300);
  }

  protected reset(): void {
    this.store.resetDemo(this.demoCount());
    this.confirmReset.set(false);
    this.toast.show(`Demo data reset (${this.demoCount()} tasks)`, { kind: 'success' });
  }
}
