import { describe, expect, test, vi } from "vitest";
import { PendingChanges, UndoableDeletes } from "./pending";
import type { ProjectData } from "./data";

const project = (tasks: { id: string; position: number; status_id: string }[]) => ({ tasks }) as unknown as ProjectData;

describe("PendingChanges", () => {
  test("a reload during a save keeps the change", () => {
    const p = new PendingChanges();
    const done = p.hold("a", { status_id: "doing", position: 3 });
    // The reload still has the old place.
    const reloaded = p.over(project([{ id: "a", position: 1, status_id: "todo" }, { id: "b", position: 2, status_id: "todo" }]));
    expect(reloaded.tasks[0]).toMatchObject({ status_id: "doing", position: 3 });
    expect(reloaded.tasks[1]).toMatchObject({ status_id: "todo", position: 2 });
    // Saved: reloads show what the database has.
    done();
    expect(p.over(project([{ id: "a", position: 9, status_id: "done" }])).tasks[0].position).toBe(9);
  });

  test("two saves on one task: held until both land, the later change on top", () => {
    const p = new PendingChanges();
    const first = p.hold("a", { position: 1 });
    const second = p.hold("a", { position: 2, status_id: "doing" });
    first();
    expect(p.over(project([{ id: "a", position: 0, status_id: "todo" }])).tasks[0]).toMatchObject({ position: 2, status_id: "doing" });
    // Done twice by mistake counts once.
    first();
    expect(p.size).toBe(1);
    second();
    expect(p.size).toBe(0);
  });
});

describe("UndoableDeletes", () => {
  test("Undo brings it back; nothing is deleted", () => {
    const remove = vi.fn();
    const hidden: string[][] = [];
    const d = new UndoableDeletes<{ id: string }>(remove, (h) => hidden.push(h));
    d.delete({ id: "a" });
    expect(d.hidden).toEqual(["a"]);
    expect(d.undo()).toBe(true);
    expect(d.hidden).toEqual([]);
    expect(hidden).toEqual([["a"], []]);
    // Its Undo going away later deletes nothing.
    d.finish("a");
    expect(remove).not.toHaveBeenCalled();
    expect(d.undo()).toBe(false);
  });

  test("once its Undo goes away it's deleted, and can't be undone", () => {
    vi.useFakeTimers();
    const remove = vi.fn();
    const d = new UndoableDeletes<{ id: string }>(remove);
    d.delete({ id: "a" });
    // The toast's 10 seconds, then it's gone.
    setTimeout(() => d.finish("a"), 10_000);
    vi.advanceTimersByTime(9_999);
    expect(remove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(remove).toHaveBeenCalledWith({ id: "a" });
    expect(d.undo("a")).toBe(false);
    vi.useRealTimers();
  });

  test("leaving the page deletes what's waiting; Undo of an earlier one by name", () => {
    const remove = vi.fn();
    const d = new UndoableDeletes<{ id: string }>(remove);
    d.delete({ id: "a" });
    d.delete({ id: "b" });
    expect(d.undo("a")).toBe(true);
    d.finishAll();
    expect(remove.mock.calls).toEqual([[{ id: "b" }]]);
    expect(d.hidden).toEqual([]);
  });
});
