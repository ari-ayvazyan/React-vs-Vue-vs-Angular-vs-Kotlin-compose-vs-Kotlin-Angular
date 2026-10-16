'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Project, StatusCategory, Task } from '@/lib/types';
import { effectiveWorkflow, findStatus, projectMap } from '@/lib/workflow';
import { draftFromTask, draftToFields, type TaskDraft } from '@/lib/validation';
import { Modal } from './Modal';
import { useCompletionGuard } from './completion';
import { TaskForm } from './TaskForm';
import { dispatch, getStore, nowIso, useAppState } from './store-hooks';
import { useToast } from './toast';
import styles from './shortcuts.module.css';

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}${rand}`;
}

/** Category of the status chosen in a task form (resolved in the chosen project's workflow). */
export function categoryOf(projects: Project[], fields: Pick<Task, 'projectId' | 'statusId'>): StatusCategory | undefined {
  return findStatus(effectiveWorkflow(projectMap(projects), fields.projectId), fields.statusId)?.category;
}

/** Creates a task from validated form fields and returns it. */
export function createTask(fields: ReturnType<typeof draftToFields>): Task {
  const { tasks, projects } = getStore().getSnapshot().state;
  const at = nowIso();
  const workflow = effectiveWorkflow(projectMap(projects), fields.projectId);
  const status = findStatus(workflow, fields.statusId) ?? workflow[0];
  let max = -1;
  for (const t of tasks) if (t.category === status.category && t.order > max) max = t.order;
  const task: Task = {
    id: newId('t'),
    ...fields,
    statusId: status.id,
    category: status.category,
    timeSpentMinutes: 0,
    subtasks: [],
    blockedBy: [],
    comments: [],
    createdAt: at,
    completedAt: status.category === 'done' ? at : null,
    order: max + 1,
  };
  dispatch({ type: 'task/create', task });
  return task;
}

interface ModalRequest {
  task?: Task;
  defaults?: Partial<TaskDraft>;
}

interface UIApi {
  openTaskModal: (req?: ModalRequest) => void;
  openShortcuts: () => void;
  isModalOpen: boolean;
}

const UIContext = createContext<UIApi | null>(null);

export function useUI(): UIApi {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside <UIProvider>');
  return ctx;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [taskModal, setTaskModal] = useState<(ModalRequest & { key: number }) | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const counter = useRef(0);

  const openTaskModal = useCallback((req: ModalRequest = {}) => {
    counter.current++;
    setTaskModal({ ...req, key: counter.current });
  }, []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);

  const api = useMemo<UIApi>(
    () => ({ openTaskModal, openShortcuts, isModalOpen: taskModal !== null || shortcutsOpen }),
    [openTaskModal, openShortcuts, taskModal, shortcutsOpen],
  );

  return (
    <UIContext.Provider value={api}>
      {children}
      {taskModal && <TaskModal key={taskModal.key} request={taskModal} onClose={() => setTaskModal(null)} />}
      {shortcutsOpen && <ShortcutsModal onClose={() => setShortcutsOpen(false)} />}
    </UIContext.Provider>
  );
}

function TaskModal({ request, onClose }: { request: ModalRequest; onClose: () => void }) {
  const toast = useToast();
  const guardDone = useCompletionGuard();
  const titleRef = useRef<HTMLInputElement>(null);
  const state = useAppState();
  const projects = state?.projects ?? [];
  const members = state?.members ?? [];
  const editing = request.task;
  const [initial] = useState(() => draftFromTask(editing ?? null, request.defaults));

  return (
    <Modal
      title={editing ? 'Edit task' : 'New task'}
      onClose={onClose}
      size="lg"
      initialFocus={titleRef}
      testId="task-modal"
    >
      <TaskForm
        initial={initial}
        projects={projects}
        members={members}
        titleRef={titleRef}
        submitLabel={editing ? 'Save changes' : 'Create task'}
        onCancel={onClose}
        onSubmit={(fields) => {
          if (editing) {
            // A blocked task can't be saved as done: keep the dialog open so nothing typed is lost.
            if (categoryOf(projects, fields) === 'done' && editing.category !== 'done' && !guardDone([editing.id]).length) return;
            dispatch({ type: 'task/update', id: editing.id, patch: fields, at: nowIso() });
            toast('Task updated', { tone: 'success' });
          } else {
            createTask(fields);
            toast(`Created “${fields.title}”`, { tone: 'success', undo: true });
          }
          onClose();
        }}
      />
    </Modal>
  );
}

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['n'], label: 'New task' },
  { keys: ['/'], label: 'Focus search' },
  { keys: ['g', 'd'], label: 'Go to dashboard' },
  { keys: ['g', 't'], label: 'Go to tasks' },
  { keys: ['g', 'b'], label: 'Go to board' },
  { keys: ['g', 'c'], label: 'Go to calendar' },
  { keys: ['g', 'a'], label: 'Go to activity' },
  { keys: ['g', 'l'], label: 'Go to timeline' },
  { keys: ['g', 'r'], label: 'Go to reports' },
  { keys: ['Ctrl/⌘', 'Z'], label: 'Undo' },
  { keys: ['Ctrl/⌘', 'Shift', 'Z'], label: 'Redo' },
  { keys: ['Shift', '← →'], label: 'Board: move focused card between columns' },
  { keys: ['Shift', '↑ ↓'], label: 'Board: reorder focused card' },
  { keys: ['?'], label: 'Show this help' },
  { keys: ['Esc'], label: 'Close dialogs' },
];

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" description="Shortcuts are disabled while typing in a field." onClose={onClose} size="sm">
      <ul className={styles.list}>
        {SHORTCUTS.map((s) => (
          <li key={s.label} className={styles.item}>
            <span>{s.label}</span>
            <span className={styles.keys}>
              {s.keys.map((k, i) => (
                <kbd key={i} className="kbd">
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
