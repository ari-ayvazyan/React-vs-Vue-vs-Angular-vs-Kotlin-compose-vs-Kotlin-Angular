'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { generateDemoData } from '@/lib/demo';
import { INITIAL_SEED_COUNT, serializeState } from '@/lib/store';
import type { ThemeSetting } from '@/lib/types';
import { parseImport } from '@/lib/validation';
import { Modal } from '../Modal';
import { PageSkeleton } from '../bits';
import { MembersSection } from './MembersSection';
import { IconAlert, IconDownload, IconKeyboard, IconMonitor, IconMoon, IconReset, IconSun, IconUpload } from '../icons';
import { getStore, useAppState } from '../store-hooks';
import { useToast } from '../toast';
import { useUI } from '../ui';
import styles from './settings.module.css';

const THEMES: { value: ThemeSetting; label: string; Icon: typeof IconSun }[] = [
  { value: 'light', label: 'Light', Icon: IconSun },
  { value: 'dark', label: 'Dark', Icon: IconMoon },
  { value: 'system', label: 'System', Icon: IconMonitor },
];
const PAGE_SIZES = [10, 25, 50, 100];

function PomodoroInput({ value }: { value: number }) {
  const [text, setText] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setText(String(value));
  }
  const n = Number(text);
  const valid = /^\d+$/.test(text) && n >= 1 && n <= 180;
  return (
    <div className="field">
      <label htmlFor="pomodoro-minutes" className="label">
        Pomodoro length (minutes)
      </label>
      <input
        id="pomodoro-minutes"
        className="input"
        inputMode="numeric"
        value={text}
        style={{ maxWidth: 140 }}
        aria-invalid={!valid}
        aria-describedby="pomodoro-hint"
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (/^\d+$/.test(e.target.value) && v >= 1 && v <= 180) getStore().updateSettings({ pomodoroMinutes: v });
        }}
      />
      {valid ? (
        <p className="hint" id="pomodoro-hint">
          Between 1 and 180 minutes. Applies to the next timer you start.
        </p>
      ) : (
        <p className="error-text" id="pomodoro-hint">
          Enter a whole number between 1 and 180.
        </p>
      )}
    </div>
  );
}

export function SettingsView() {
  const state = useAppState();
  const toast = useToast();
  const { openShortcuts } = useUI();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  if (!state) return <PageSkeleton title="Settings" rows={4} />;
  const { settings } = state;

  const exportJson = () => {
    const blob = new Blob([serializeState(state, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `taskpilot-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${state.tasks.length} tasks, ${state.projects.length} projects and ${state.members.length} members`, { tone: 'success' });
  };

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setImportError('The file is too large (max 20 MB).');
      return;
    }
    const res = parseImport(await file.text());
    if (!res.ok) {
      setImportError(res.error);
      return;
    }
    setImportError(null);
    getStore().replaceState(res.state);
    toast(`Imported ${res.state.tasks.length} tasks and ${res.state.projects.length} projects`, { tone: 'success', undo: true });
  };

  return (
    <div className={styles.page}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Preferences are stored in this browser.</p>
        </div>
      </div>

      <section className={`card ${styles.section}`} aria-labelledby="appearance-title">
        <div className={styles.sectionHead}>
          <h2 id="appearance-title" className="section-title">
            Appearance
          </h2>
          <p className="muted">Choose a theme, or follow your operating system.</p>
        </div>
        <div className={styles.themeGrid} role="radiogroup" aria-labelledby="appearance-title">
          {THEMES.map(({ value, label, Icon }) => (
            <label key={value} className={styles.themeOption}>
              <input
                type="radio"
                name="theme"
                value={value}
                checked={settings.theme === value}
                onChange={() => getStore().updateSettings({ theme: value })}
              />
              <span className={`${styles.themePreview} ${styles[`preview_${value}`]}`} aria-hidden="true">
                <span />
                <span />
              </span>
              <span className={styles.themeLabel}>
                <Icon size={15} /> {label}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className={`card ${styles.section}`} aria-labelledby="prefs-title">
        <div className={styles.sectionHead}>
          <h2 id="prefs-title" className="section-title">
            Preferences
          </h2>
          <p className="muted">Timer and list behaviour.</p>
        </div>
        <div className={styles.fields}>
          <PomodoroInput value={settings.pomodoroMinutes} />
          <div className="field">
            <label htmlFor="page-size" className="label">
              Tasks per page
            </label>
            <select
              id="page-size"
              className="select"
              style={{ maxWidth: 140 }}
              value={settings.pageSize}
              onChange={(e) => getStore().updateSettings({ pageSize: Number(e.target.value) })}
            >
              {[...new Set([...PAGE_SIZES, settings.pageSize])].sort((a, b) => a - b).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="label">Keyboard shortcuts</span>
            <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={openShortcuts}>
              <IconKeyboard size={16} /> View shortcuts
            </button>
          </div>
        </div>
      </section>

      <MembersSection members={state.members} tasks={state.tasks} currentUserId={settings.currentUserId} />

      <section className={`card ${styles.section}`} aria-labelledby="data-title">
        <div className={styles.sectionHead}>
          <h2 id="data-title" className="section-title">
            Data
          </h2>
          <p className="muted">
            {state.tasks.length} tasks · {state.projects.length} projects · {state.members.length} members. Everything is saved locally in your browser.
          </p>
        </div>
        <div className={styles.dataRows}>
          <div className={styles.dataRow}>
            <div>
              <strong>Export</strong>
              <p className="muted">Download all tasks, projects, members and settings as JSON.</p>
            </div>
            <button type="button" className="btn" onClick={exportJson}>
              <IconDownload size={16} /> Export JSON
            </button>
          </div>
          <div className={styles.dataRow}>
            <div>
              <strong>Import</strong>
              <p className="muted">Replace current data with a previously exported file. You can undo this.</p>
              {importError && (
                <p className={styles.importError} role="alert">
                  <IconAlert size={15} /> <span>Import failed: {importError}</span>
                </p>
              )}
            </div>
            <div>
              <input
                ref={fileRef}
                id="import-file"
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={onImport}
              />
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                <IconUpload size={16} /> Import JSON
              </button>
            </div>
          </div>
          <div className={styles.dataRow}>
            <div>
              <strong>Reset demo data</strong>
              <p className="muted">Replace everything with {INITIAL_SEED_COUNT} freshly generated demo tasks.</p>
            </div>
            <button type="button" className="btn btn-danger" onClick={() => setConfirmReset(true)}>
              <IconReset size={16} /> Reset demo data
            </button>
          </div>
        </div>
      </section>

      {confirmReset && (
        <Modal
          title="Reset demo data?"
          description={`All ${state.tasks.length} tasks and ${state.projects.length} projects will be replaced with ${INITIAL_SEED_COUNT} demo tasks. You can undo this afterwards.`}
          onClose={() => setConfirmReset(false)}
          size="sm"
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger-solid"
                onClick={() => {
                  getStore().replaceState(generateDemoData(INITIAL_SEED_COUNT), true);
                  setConfirmReset(false);
                  toast('Demo data restored', { undo: true, tone: 'success' });
                }}
              >
                Reset data
              </button>
            </>
          }
        >
          <p className="muted">Your theme and preferences are kept.</p>
        </Modal>
      )}
    </div>
  );
}
