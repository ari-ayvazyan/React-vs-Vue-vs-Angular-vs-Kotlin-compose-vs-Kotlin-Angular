'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import styles from './color-swatch.module.css';

/**
 * Native colour picker that previews live but commits once (debounced), so dragging through the
 * picker produces a single undo entry instead of one per `input` event.
 */
export function ColorSwatch({
  color,
  label,
  onCommit,
  delay = 350,
  round = false,
  children,
}: {
  color: string;
  label: string;
  onCommit: (color: string) => void;
  delay?: number;
  /** circular swatch (e.g. an avatar) instead of a rounded square */
  round?: boolean;
  /** content drawn on the swatch, given the colour currently previewed */
  children?: (color: string) => ReactNode;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const value = draft ?? color;
  return (
    <label className={`${styles.swatch} ${round ? styles.round : ''}`} title="Change colour" style={{ background: value }}>
      {children?.(value)}
      <span className="sr-only">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            onCommit(next);
            setDraft(null);
          }, delay);
        }}
      />
    </label>
  );
}

/** Preset colour buttons plus a "custom colour" native picker. */
export function ColorPalettePicker({ value, onChange, palette, legend = 'Colour' }: { value: string; onChange: (color: string) => void; palette: readonly string[]; legend?: string }) {
  return (
    <fieldset className={styles.palette}>
      <legend className="label">{legend}</legend>
      <div className={styles.paletteRow}>
        {palette.map((c) => (
          <button
            key={c}
            type="button"
            className={styles.paletteBtn}
            style={{ background: c }}
            aria-pressed={value === c}
            aria-label={`Colour ${c}`}
            onClick={() => onChange(c)}
          />
        ))}
        <label className={`${styles.paletteBtn} ${styles.customColor}`} title="Custom colour">
          <span className="sr-only">Custom colour</span>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
        </label>
      </div>
    </fieldset>
  );
}
