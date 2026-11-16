import { describe, expect, test } from "vitest";
import { cardSummary } from "./TaskCard";
import type { ProjectData, Task } from "@/lib/data";

const task = (more: Partial<Task> = {}): Task =>
  ({ id: "t", number: 3, title: "Fix the gate", notes: "", status_id: "todo", due_on: null, needs_review: false, position: 0, assignee_person_id: null,
    topic_id: null, assignee_session_id: null, ended_session: null, picked_up_at: null, labelIds: [], checklist: [], commentCount: 0, comments: [], dispatches: [], jobs: [], question: null, ...more }) as Task;
const project = {
  statuses: [{ id: "todo", name: "To do", position: 0, is_done: false, color: null }, { id: "done", name: "Done", position: 1, is_done: true, color: null }],
  labels: [{ id: "l1", name: "outside", color: null }],
  members: [{ id: "p1", display_name: "Claire Boylson" }],
  sessions: [{ id: "s1", name: "parser" }],
} as unknown as ProjectData;

describe("cardSummary", () => {
  test("nothing to say: nothing", () => {
    expect(cardSummary(project, task(), false)).toBe("");
  });
  test("what the card shows, in words, with the person's name", () => {
    const t = task({ labelIds: ["l1"], due_on: "2020-01-02", checklist: [{ id: "a", text: "x", done: true, position: 1 }, { id: "b", text: "y", done: false, position: 2 }], commentCount: 1, assignee_person_id: "p1", needs_review: true });
    expect(cardSummary(project, t, true)).toBe("To do. Needs review. Label: outside. Overdue, was due Jan 2, 2020. Checklist: 1 of 2 done. 1 comment. Given to Claire Boylson");
  });
  test("a session, waiting or with it; an ended one", () => {
    expect(cardSummary(project, task({ assignee_session_id: "s1" }), false)).toBe("Given to parser, waiting for it");
    expect(cardSummary(project, task({ assignee_session_id: "s1", picked_up_at: "now" }), false)).toBe("Given to parser, which has it");
    expect(cardSummary(project, task({ ended_session: "docs" }), false)).toBe("Was given to docs, which has ended");
  });
});
