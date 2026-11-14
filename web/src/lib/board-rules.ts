// The board's rules for where things go, as plain functions (no React, no
// database), so they can be unit tested. The `omicron` command follows the
// same rules (crates/omicron/src/board.rs, place_task).

import { positionBetween, type Task, type Who } from "./data";

type Placeable = { id: string; position: number; number: number };

/** A column's cards in the order the page shows them: position, then number. */
export function inOrder<T extends Placeable>(cards: T[]): T[] {
  return [...cards].sort((a, b) => a.position - b.position || a.number - b.number);
}

/**
 * Where a card goes when it's put at index `at` among a column's other
 * cards (`others`, in order). Cards with the same position (tied) can't
 * have anything put between them, so if any are tied the column is
 * numbered 0, 1, 2… first, and `renumber` lists the cards whose position
 * that changes.
 */
export function placeAt(others: Placeable[], at: number): { position: number; renumber: { id: string; position: number }[] } {
  const ordered = inOrder(others);
  const tied = ordered.some((c, i) => i > 0 && c.position <= ordered[i - 1].position);
  const renumber: { id: string; position: number }[] = [];
  const positions = ordered.map((c, i) => {
    if (!tied) return c.position;
    if (c.position !== i) renumber.push({ id: c.id, position: i });
    return i;
  });
  return { position: positionBetween(positions[at - 1], positions[at]), renumber };
}

/** What a board column groups by: status, topic, person, or Claude session. */
export type ColumnKind = "s" | "t" | "p" | "c";

/** What a column id names: `col|<kind>|<id, or none>`, like `col|s|<status id>` or `col|t|none` (no topic). */
export function parseColumn(id: string): { kind: ColumnKind; ref: string | null } | null {
  const [col, kind, which] = id.split("|");
  if (col !== "col" || !which || !["s", "t", "p", "c"].includes(kind)) return null;
  return { kind: kind as ColumnKind, ref: which === "none" ? null : which };
}

/** A drop, worked out: where the task goes and the cards renumbered first. */
export type Drop = {
  statusId: string;
  topicId: string | null;
  who: Who | undefined;
  position: number;
  renumber: { id: string; position: number }[];
};

/**
 * Where `moved` goes when it's dropped on the column `column`, over the card
 * `over` (or on the column itself). `null` when it's already there.
 * A status column sets the status; a topic column, the topic; a person's
 * or session's column, who it's given to. Places count within a status: in
 * another kind of column, a card lands next to the one it's over only when
 * that one has the same status.
 */
export function dropPlace(tasks: Task[], moved: Task, over: Task | undefined, column: { kind: ColumnKind; ref: string | null }): Drop | null {
  if (over?.id === moved.id) return null;
  const byStatus = column.kind === "s";
  const statusId = byStatus && column.ref ? column.ref : moved.status_id;
  const topicId = column.kind === "t" ? column.ref : moved.topic_id;
  const who: Who | undefined = column.kind === "p" ? { person: column.ref, session: null } : column.kind === "c" ? { person: null, session: column.ref } : undefined;
  const sameColumn = byStatus
    ? moved.status_id === statusId
    : column.kind === "t"
      ? moved.topic_id === topicId
      : moved.assignee_person_id === who!.person && moved.assignee_session_id === who!.session;
  const anchor = over && over.status_id === statusId ? over : undefined;
  if (!byStatus && !anchor) return sameColumn ? null : { statusId, topicId, who, position: moved.position, renumber: [] };
  const inStatus = (t: Task) => t.status_id === statusId;
  const others = inOrder(tasks.filter((t) => inStatus(t) && t.id !== moved.id));
  const col = inOrder(tasks.filter(inStatus));
  let at = anchor ? others.findIndex((t) => t.id === anchor.id) : others.length;
  // Dragging down within the same column lands after the card it's over.
  if (anchor && inStatus(moved) && col.indexOf(moved) < col.indexOf(anchor)) at += 1;
  if (at < 0) at = others.length;
  // Dropped where it already is (by its place in the column, so ties count).
  if (sameColumn && inStatus(moved) && col.indexOf(moved) === at) return null;
  return { statusId, topicId, who, ...placeAt(others, at) };
}

/** The board's search and filters. */
export type Filters = { mine: boolean; review: boolean; due: boolean; label: string | null };

/**
 * Whether a task shows under the search `query` (every word in its number,
 * title or notes) and the filters: given to me, needs review, due within a
 * week of `now`, has the label.
 */
export function matches(task: Task, query: string, filters: Filters, me: string, now: number): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const soon = now + 7 * 86400000;
  return (
    words.every((w) => `#${task.number} ${task.title} ${task.notes}`.toLowerCase().includes(w)) &&
    (!filters.mine || task.assignee_person_id === me) &&
    (!filters.review || task.needs_review) &&
    (!filters.due || (task.due_on !== null && new Date(task.due_on).getTime() <= soon)) &&
    (filters.label === null || task.labelIds.includes(filters.label))
  );
}
