// Changes on the board that haven't finished yet: saves still on their way
// (kept on top of whatever a reload brings, so a card never jumps back), and
// deletes that wait for their Undo to go away. Plain classes, so they can be
// tested without a page; the hooks keep one per page.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectData, Task } from "./data";

/** Saves not yet landed, by task. */
export class PendingChanges {
  private held = new Map<string, { change: Partial<Task>; count: number }>();

  /** Hold `change` over task `id` until the returned function is called (the save is done, saved or not). */
  hold(id: string, change: Partial<Task>): () => void {
    const now = this.held.get(id);
    this.held.set(id, { change: { ...now?.change, ...change }, count: (now?.count ?? 0) + 1 });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const h = this.held.get(id);
      if (h && --h.count <= 0) this.held.delete(id);
    };
  }

  /** A loaded Project with the held changes put back on top. */
  over<P extends ProjectData | null>(p: P): P {
    if (!p || this.held.size === 0) return p;
    return { ...p, tasks: p.tasks.map((t) => (this.held.has(t.id) ? { ...t, ...this.held.get(t.id)!.change } : t)) };
  }

  get size(): number {
    return this.held.size;
  }
}

/** Deleted tasks waiting for their Undo to go away. */
export class UndoableDeletes<T extends { id: string }> {
  private waiting = new Map<string, T>();
  private last: string | null = null;

  constructor(
    private remove: (t: T) => void,
    private changed: (hidden: string[]) => void = () => {},
  ) {}

  /** Hide it now; it's deleted for good on `finish`. */
  delete(t: T) {
    this.waiting.set(t.id, t);
    this.last = t.id;
    this.changed(this.hidden);
  }

  /** Bring it back (the one just deleted, if none is named). False if it's gone already. */
  undo(id: string | null = this.last): boolean {
    if (id === this.last) this.last = null;
    if (!id || !this.waiting.delete(id)) return false;
    this.changed(this.hidden);
    return true;
  }

  /** Delete it for good (its Undo went away). */
  finish(id: string) {
    const t = this.waiting.get(id);
    if (!t) return;
    this.waiting.delete(id);
    if (this.last === id) this.last = null;
    this.remove(t);
  }

  /** Leaving the page: everything waiting is deleted. */
  finishAll() {
    [...this.waiting.keys()].forEach((id) => this.finish(id));
  }

  get hidden(): string[] {
    return [...this.waiting.keys()];
  }
}

/** One PendingChanges for the page. */
export function usePendingChanges(): PendingChanges {
  return useRef(new PendingChanges()).current;
}

/** Deletes with Undo for the page: what's hidden now, and the deletes. Leaving the page finishes them. */
export function useUndoableDelete<T extends { id: string }>(remove: (t: T) => void): { hidden: string[]; deletes: UndoableDeletes<T> } {
  const [hidden, setHidden] = useState<string[]>([]);
  const removeNow = useRef(remove);
  removeNow.current = remove;
  const deletes = useRef<UndoableDeletes<T> | null>(null);
  if (!deletes.current) deletes.current = new UndoableDeletes<T>((t) => removeNow.current(t), setHidden);
  const d = deletes.current;
  const finishAll = useCallback(() => d.finishAll(), [d]);
  useEffect(() => finishAll, [finishAll]);
  return { hidden, deletes: d };
}
