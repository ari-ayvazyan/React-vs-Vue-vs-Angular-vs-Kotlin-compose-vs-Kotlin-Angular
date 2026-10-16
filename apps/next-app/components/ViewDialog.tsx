'use client';

import { useRef, useState, type FormEvent } from 'react';
import { VIEW_NAME_MAX, validateViewName } from '@/lib/views';
import type { SavedView } from '@/lib/types';
import { Modal } from './Modal';

/** Name prompt for saving a new view (`view` undefined) or renaming an existing one. */
export function ViewNameDialog({
  views,
  view,
  summary,
  onSubmit,
  onClose,
}: {
  views: SavedView[];
  view?: SavedView;
  /** human description of the filters being saved */
  summary?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(view?.name ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = validateViewName(name, views, view?.id);
    setError(err);
    if (err) {
      inputRef.current?.focus();
      return;
    }
    onSubmit(name.trim());
  };

  return (
    <Modal
      title={view ? 'Rename view' : 'Save view'}
      description={view ? undefined : 'Saved views appear in the sidebar under “Views”.'}
      onClose={onClose}
      size="sm"
      initialFocus={inputRef}
      testId="view-dialog"
    >
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="view-name" className="label">
            Name
          </label>
          <input
            ref={inputRef}
            id="view-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. My urgent work"
            aria-invalid={!!error}
            aria-describedby={error ? 'view-name-error' : summary ? 'view-summary' : undefined}
            autoComplete="off"
            data-testid="view-name-input"
          />
          {error ? (
            <p className="error-text" id="view-name-error">
              {error}
            </p>
          ) : (
            <p className="hint">Up to {VIEW_NAME_MAX} characters.</p>
          )}
        </div>
        {summary && (
          <p className="muted" id="view-summary" style={{ marginTop: 10, fontSize: 13 }}>
            Filters: {summary}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 18, gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" data-testid="view-save-button">
            {view ? 'Rename' : 'Save view'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
