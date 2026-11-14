import { describe, expect, it } from "vitest";
import { UndoSteps } from "./undo";

describe("undo steps", () => {
  it("works back through several steps, newest first", () => {
    const done: string[] = [];
    const u = new UndoSteps();
    u.push({ label: "a", undone: "a back", undo: () => (done.push("a"), true) });
    u.push({ label: "b", undone: "b back", undo: () => (done.push("b"), true) });
    expect(u.undo()?.label).toBe("b");
    expect(u.undo()?.label).toBe("a");
    expect(u.undo()).toBeNull();
    expect(done).toEqual(["b", "a"]);
  });
  it("undoes a named step, and skips ones that can't be undone", () => {
    const u = new UndoSteps();
    const a = u.push({ label: "a", undone: "", undo: () => true });
    u.push({ label: "gone", undone: "", undo: () => false });
    u.push({ label: "c", undone: "", undo: () => true });
    expect(u.undo(a)?.label).toBe("a");
    expect(u.undo()?.label).toBe("c");
    expect(u.undo()).toBeNull();
  });
  it("keeps only the last few", () => {
    const u = new UndoSteps(2);
    for (const l of ["a", "b", "c"]) u.push({ label: l, undone: "", undo: () => true });
    expect(u.size).toBe(2);
  });
});
