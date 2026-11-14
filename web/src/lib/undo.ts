// The board's changes that can be undone, newest last: Cmd+Z works back
// through them, and each one's toast has its own Undo. A plain class, so
// it can be tested without a page.

export type Step = {
  /** What was done, as the toast says it: "Moved #4 to Done". */
  label: string;
  /** Undo it. False if it can't be any more (a delete that's gone for good). */
  undo: () => boolean;
  /** What undoing it did, said after: "Moved #4 back to Doing". */
  undone: string;
  /** The task it was about, to show it after. */
  task?: number;
};

export class UndoSteps {
  private steps: (Step & { id: number })[] = [];
  private next = 1;

  constructor(private keep = 20) {}

  /** Remember a change; returns its id, for its own Undo button. */
  push(step: Step): number {
    const id = this.next++;
    this.steps.push({ ...step, id });
    if (this.steps.length > this.keep) this.steps.shift();
    return id;
  }

  /** Undo one step (the newest, if none is named) and forget it. Steps that
   *  can't be undone any more are skipped and forgotten. */
  undo(id?: number): Step | null {
    while (this.steps.length) {
      const i = id === undefined ? this.steps.length - 1 : this.steps.findIndex((s) => s.id === id);
      if (i < 0) return null;
      const [s] = this.steps.splice(i, 1);
      if (s.undo()) return s;
      if (id !== undefined) return null;
    }
    return null;
  }

  get size(): number {
    return this.steps.length;
  }
}
