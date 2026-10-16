/** Shared prop types for the hand-built chart components. */
export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export interface BarRow {
  key: string;
  label: string;
  /** bar length, 0–100 */
  percent: number;
  color: string;
  detail: string;
  to?: string;
  /** text at the end of the bar (default: `${percent}%`) */
  valueText?: string;
  /** accessible description of the row (default: "<label>: <percent>% complete (<detail>)") */
  ariaText?: string;
}

export interface ColumnDatum {
  key: string;
  label: string;
  /** null = no data (drawn as an empty column with "–") */
  value: number | null;
  color: string;
  /** shown under the label and in the tooltip, e.g. "12 tasks" */
  detail: string;
}
