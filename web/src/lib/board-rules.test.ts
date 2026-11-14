import { describe, expect, test } from "vitest";
import { dropPlace, inOrder, matches, parseColumn, placeAt } from "./board-rules";
import type { Task } from "./data";

const card = (id: string, position: number, number: number) => ({ id, position, number });

describe("placeAt", () => {
  test("between untied cards: halfway, nothing else moves", () => {
    expect(placeAt([card("a", 1, 1), card("b", 2, 2)], 1)).toEqual({ position: 1.5, renumber: [] });
  });

  test("top, bottom and an empty column", () => {
    expect(placeAt([card("a", 1, 1)], 0).position).toBe(0);
    expect(placeAt([card("a", 1, 1)], 1).position).toBe(2);
    expect(placeAt([], 0)).toEqual({ position: 0, renumber: [] });
  });

  test("between tied cards: the column is numbered first, so it lands where it was dropped (#118)", () => {
    // To do after organizing a filtered column: Milk 1, Bread 1, Butter 2.
    // Eggs is dropped between Milk and Bread.
    const others = [card("milk", 1, 1), card("bread", 1, 2), card("butter", 2, 4)];
    const { position, renumber } = placeAt(others, 1);
    // Numbered 0, 1, 2: only Milk's position changes (Butter is 2 already).
    expect(renumber).toEqual([{ id: "milk", position: 0 }]);
    // Milk 0, Bread 1: Eggs between them.
    expect(position).toBe(0.5);
    const after = inOrder([card("milk", 0, 1), card("bread", 1, 2), card("butter", 2, 4), card("eggs", position, 3)]);
    expect(after.map((c) => c.id)).toEqual(["milk", "eggs", "bread", "butter"]);
  });

  test("ties anywhere in the column are numbered away, even away from the drop", () => {
    const { renumber } = placeAt([card("a", 0, 1), card("b", 5, 2), card("c", 5, 3)], 0);
    expect(renumber.map((r) => r.id)).toEqual(["b", "c"]);
  });
});

const task = (number: number, more: Partial<Task> = {}): Task => ({
  id: `t${number}`,
  number,
  title: `Task ${number}`,
  notes: "",
  status_id: "todo",
  due_on: null,
  needs_review: false,
  position: number,
  assignee_person_id: null,
  topic_id: null,
  assignee_session_id: null,
  ended_session: null,
  picked_up_at: null,
  labelIds: [],
  checklist: [],
  comments: [],
  dispatches: [],
  jobs: [],
  question: null,
  ...more,
});

describe("parseColumn", () => {
  test("each kind, and none", () => {
    expect(parseColumn("col|s|todo")).toEqual({ kind: "s", ref: "todo" });
    expect(parseColumn("col|t|none")).toEqual({ kind: "t", ref: null });
    expect(parseColumn("col|p|pat")).toEqual({ kind: "p", ref: "pat" });
    expect(parseColumn("col|c|sess")).toEqual({ kind: "c", ref: "sess" });
  });
  test("not a column", () => {
    expect(parseColumn("t1")).toBeNull();
    expect(parseColumn("col|x|y")).toBeNull();
    expect(parseColumn("col|s")).toBeNull();
  });
});

describe("dropPlace", () => {
  // To do: 1, 2, 3. Doing: 4.
  const tasks = [task(1), task(2), task(3), task(4, { status_id: "doing", position: 0 })];
  const [one, two, three, four] = tasks;
  const todo = { kind: "s" as const, ref: "todo" };
  const doing = { kind: "s" as const, ref: "doing" };

  test("onto an empty column", () => {
    const d = dropPlace(tasks, one, undefined, { kind: "s", ref: "done" })!;
    expect([d.statusId, d.position]).toEqual(["done", 0]);
  });

  test("down the same column lands after the card it's over", () => {
    const d = dropPlace(tasks, one, two, todo)!;
    expect(inOrder([...tasks.filter((t) => t !== one && t.status_id === "todo"), { ...one, position: d.position }]).map((t) => t.number)).toEqual([2, 1, 3]);
  });

  test("up the same column lands before the card it's over", () => {
    const d = dropPlace(tasks, three, one, todo)!;
    expect(d.position).toBeLessThan(1);
  });

  test("across columns: before the card it's over, or at the bottom", () => {
    expect(dropPlace(tasks, one, four, doing)).toMatchObject({ statusId: "doing", position: -1 });
    expect(dropPlace(tasks, one, undefined, doing)).toMatchObject({ statusId: "doing", position: 1 });
  });

  test("already there: on itself, or back in its own place", () => {
    expect(dropPlace(tasks, two, two, todo)).toBeNull();
    // Over the next card going down would land after it; over itself's spot does nothing.
    expect(dropPlace(tasks, three, undefined, todo)).toBeNull();
  });

  test("a topic column sets the topic and keeps its place unless over a card of its status", () => {
    const topic = { kind: "t" as const, ref: "home" };
    expect(dropPlace(tasks, one, undefined, topic)).toEqual({ statusId: "todo", topicId: "home", who: undefined, position: 1, renumber: [] });
    // Over a card with another status: it keeps its status and place.
    expect(dropPlace(tasks, one, four, topic)).toMatchObject({ statusId: "todo", topicId: "home", position: 1 });
    // Already in that topic, not over a card: nothing to do.
    expect(dropPlace([{ ...one, topic_id: "home" }], { ...one, topic_id: "home" }, undefined, topic)).toBeNull();
  });

  test("a person's or session's column gives it to them", () => {
    expect(dropPlace(tasks, one, undefined, { kind: "p", ref: "pat" })?.who).toEqual({ person: "pat", session: null });
    expect(dropPlace(tasks, one, undefined, { kind: "c", ref: "s1" })?.who).toEqual({ person: null, session: "s1" });
    // To nobody: from someone, it's taken off them; already nobody's, nothing to do.
    const pats = { ...one, assignee_person_id: "pat" };
    expect(dropPlace([pats], pats, undefined, { kind: "p", ref: null })?.who).toEqual({ person: null, session: null });
    expect(dropPlace(tasks, one, undefined, { kind: "p", ref: null })).toBeNull();
  });
});

describe("matches", () => {
  const none = { mine: false, review: false, due: false, label: null };
  const now = new Date("2026-11-14T12:00:00Z").getTime();
  const t = task(12, { title: "Buy milk", notes: "From the corner shop", assignee_person_id: "me", labelIds: ["food"], due_on: "2026-11-18", needs_review: true });

  test("search words: every one, in the number, title or notes, any case", () => {
    expect(matches(t, "", none, "me", now)).toBe(true);
    expect(matches(t, "milk CORNER", none, "me", now)).toBe(true);
    expect(matches(t, "#12", none, "me", now)).toBe(true);
    expect(matches(t, "milk bread", none, "me", now)).toBe(false);
  });

  test("Mine, Needs review, Due soon and a label", () => {
    expect(matches(t, "", { ...none, mine: true }, "me", now)).toBe(true);
    expect(matches(t, "", { ...none, mine: true }, "pat", now)).toBe(false);
    expect(matches(t, "", { ...none, review: true }, "me", now)).toBe(true);
    expect(matches({ ...t, needs_review: false }, "", { ...none, review: true }, "me", now)).toBe(false);
    expect(matches(t, "", { ...none, due: true }, "me", now)).toBe(true);
    expect(matches({ ...t, due_on: "2026-12-01" }, "", { ...none, due: true }, "me", now)).toBe(false);
    expect(matches({ ...t, due_on: null }, "", { ...none, due: true }, "me", now)).toBe(false);
    expect(matches(t, "", { ...none, label: "food" }, "me", now)).toBe(true);
    expect(matches(t, "", { ...none, label: "work" }, "me", now)).toBe(false);
  });
});
