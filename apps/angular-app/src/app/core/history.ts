/** Bounded undo/redo stack of immutable snapshots. */
export class UndoHistory<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly depth = 50) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get size(): number {
    return this.past.length;
  }

  /** Record the state *before* a mutation. Clears redo stack. */
  record(before: T): void {
    this.past.push(before);
    if (this.past.length > this.depth) this.past.shift();
    this.future = [];
  }

  /** Returns the state to restore, given the current state, or null. */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
