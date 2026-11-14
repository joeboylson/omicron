// Tasks: adding, changing, moving and organizing them, their labels,
// checklists, comments and images, and team jobs they link to.

import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "../omicron";
import type { ChecklistItem, Task, JobLink, ProjectData, Who } from "./types";
import { after } from "./shared";

export async function addTask(
  db: SupabaseClient,
  project: ProjectData,
  statusId: string,
  title: string,
  topicId: string | null = null,
  who?: Who,
  dueOn?: string | null,
) {
  const position = after(project.tasks.filter((t) => t.status_id === statusId));
  const given = { ...(who ? { assignee_person_id: who.person, assignee_session_id: who.session } : {}), ...(dueOn ? { due_on: dueOn } : {}) };
  const row = must(
    await db.from("tasks").insert({ project_id: project.id, status_id: statusId, title, position, topic_id: topicId, ...given }).select("number").single(),
  ) as { number: number };
  return row.number;
}

export type TaskChange = Partial<
  Pick<
    Task,
    "title" | "notes" | "status_id" | "due_on" | "needs_review" | "assignee_person_id" | "assignee_session_id" | "topic_id" | "position"
  >
>;

export async function updateTask(db: SupabaseClient, project: ProjectData, task: Task, change: TaskChange) {
  const row: TaskChange & { position?: number } = { ...change };
  // A task moved to another status goes to the bottom of it.
  if (change.status_id && change.status_id !== task.status_id) {
    row.position = after(project.tasks.filter((t) => t.status_id === change.status_id));
  }
  must(await db.from("tasks").update(row).eq("id", task.id));
}

export async function deleteTask(db: SupabaseClient, task: Task) {
  must(await db.from("tasks").delete().eq("id", task.id));
}

export async function setLabel(db: SupabaseClient, task: Task, labelId: string, on: boolean) {
  if (on) {
    must(await db.from("task_labels").upsert({ task_id: task.id, label_id: labelId }, { ignoreDuplicates: true }));
  } else {
    must(await db.from("task_labels").delete().eq("task_id", task.id).eq("label_id", labelId));
  }
}

/** Checklist items being added, one after another: two added quickly
 *  mustn't both take the place after the same last item (#200). */
let addingItems: Promise<unknown> = Promise.resolve();

export function addChecklistItem(db: SupabaseClient, task: Task, text: string): Promise<void> {
  const next = addingItems.then(async () => {
    // After the last one the database has, not the one this page last saw.
    const last = must(await db.from("checklist_items").select("position").eq("task_id", task.id).order("position", { ascending: false }).limit(1)) as { position: number }[];
    const position = Math.max(after(task.checklist), (last[0]?.position ?? 0) + 1);
    must(await db.from("checklist_items").insert({ task_id: task.id, text, position }));
  });
  addingItems = next.catch(() => {});
  return next;
}

export async function tickChecklistItem(db: SupabaseClient, item: ChecklistItem, done: boolean) {
  must(await db.from("checklist_items").update({ done }).eq("id", item.id));
}

export async function deleteChecklistItem(db: SupabaseClient, item: ChecklistItem) {
  must(await db.from("checklist_items").delete().eq("id", item.id));
}

export async function addComment(db: SupabaseClient, task: Task, body: string, images: string[] = []) {
  must(await db.from("comments").insert({ task_id: task.id, body, images }));
}

/** Where comments' images are kept: private, filed under each Project. */
export const IMAGES_BUCKET = "comment-images";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export const IMAGE_LIMIT = 10 * 1024 * 1024;

export const IMAGES_PER_COMMENT = 10;

/** Why a file can't be added as an image, or null if it can. */
export function imageProblem(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return `${file.name} isn't a PNG, JPEG, GIF or WebP image.`;
  if (file.size > IMAGE_LIMIT) return `${file.name} is over 10 MB.`;
  return null;
}

/** Upload an image for a comment in this Project. Returns its path. */
export async function uploadImage(db: SupabaseClient, projectId: string, file: File): Promise<string> {
  const name = (file.name || "image").replace(/[^A-Za-z0-9._-]/g, "_");
  const path = `${projectId}/${randomId()}-${name}`;
  const { error } = await db.storage.from(IMAGES_BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return path;
}

/** 32 random hex digits. (Not crypto.randomUUID: that only works on https pages.) */
export function randomId(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The name an image was added with. */
export function imageName(path: string): string {
  const file = path.split("/").pop() ?? path;
  const dash = file.indexOf("-");
  return dash < 0 ? file : file.slice(dash + 1);
}

/** Links to show images by (they work for an hour). */
export async function imageLinks(db: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await db.storage.from(IMAGES_BUCKET).createSignedUrls(paths, 3600);
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl]));
}

/** A position between two neighbours (either may be missing). */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

/** Move a task: to a status (and topic, when given) at a position. */
/**
 * Put a column's tasks in order once (#56): by number, by name, or by who
 * they're given to (people and sessions by name, then nobody). Tasks moved
 * in later stay where they're put.
 */
/** Sort a status for good. Returns the places it had, for Undo (see `renumberTasks`). */
export async function organize(db: SupabaseClient, project: ProjectData, tasks: Task[], by: "number" | "name" | "assignee" | "due"): Promise<{ id: string; position: number }[]> {
  const before = tasks.map((t) => ({ id: t.id, position: t.position }));
  const who = (t: Task) =>
    project.members.find((m) => m.id === t.assignee_person_id)?.display_name ?? project.sessions.find((s) => s.id === t.assignee_session_id)?.name ?? null;
  const sorted = [...tasks].sort((a, b) => {
    if (by === "name") return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) || a.number - b.number;
    // Soonest first; no date last.
    if (by === "due" && a.due_on !== b.due_on) return a.due_on === null ? 1 : b.due_on === null ? -1 : a.due_on.localeCompare(b.due_on);
    if (by === "assignee") {
      const [x, y] = [who(a), who(b)];
      if (x !== y) return x === null ? 1 : y === null ? -1 : x.localeCompare(y);
    }
    return a.number - b.number;
  });
  // Only the ones whose place changes.
  const changed = sorted.map((t, i) => ({ t, position: i + 1 })).filter(({ t, position }) => t.position !== position);
  await Promise.all(changed.map(({ t, position }) => db.from("tasks").update({ position }).eq("id", t.id).then(must)));
  return before;
}

/** Give tasks new positions (a tied column numbered before a drop). */
export async function renumberTasks(db: SupabaseClient, rows: { id: string; position: number }[]) {
  await Promise.all(rows.map((r) => db.from("tasks").update({ position: r.position }).eq("id", r.id).then(must)));
}

export async function moveTask(
  db: SupabaseClient,
  task: Task,
  to: { statusId: string; topicId?: string | null; position: number; who?: Who },
) {
  const row: Record<string, unknown> = { status_id: to.statusId, position: to.position };
  if (to.topicId !== undefined) row.topic_id = to.topicId;
  if (to.who) Object.assign(row, { assignee_person_id: to.who.person, assignee_session_id: to.who.session });
  must(await db.from("tasks").update(row).eq("id", task.id));
}

/** Every team job in a Project, to link tasks to. */
export async function listProjectJobs(db: SupabaseClient, projectId: string): Promise<JobLink[]> {
  const rows = must(
    await db.from("jobs").select("id,number,title,state,step,teams(name)").eq("project_id", projectId).order("number"),
  ) as any[];
  return rows.map((j) => ({ id: j.id, team: j.teams?.name ?? "", number: j.number, title: j.title, state: j.state, step: j.step }));
}

export async function linkJob(db: SupabaseClient, task: Task, jobId: string) {
  must(await db.from("task_jobs").insert({ task_id: task.id, job_id: jobId }));
}

export async function unlinkJob(db: SupabaseClient, task: Task, jobId: string) {
  must(await db.from("task_jobs").delete().eq("task_id", task.id).eq("job_id", jobId));
}

/** Put a task's place back as it was (an Undo): exactly these fields. */
export async function putTaskBack(db: SupabaseClient, taskId: string, fields: Partial<Task>) {
  must(await db.from("tasks").update(fields).eq("id", taskId));
}

/** Tasks in any of your Projects whose title has these words, for ⌘K (#234). */
export async function searchTasks(db: SupabaseClient, query: string): Promise<{ projectId: string; project: string; number: number; title: string }[]> {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (words.length === 0) return [];
  let q = db.from("tasks").select("number,title,project_id,projects(name)");
  for (const w of words) q = q.ilike("title", `%${w.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  const rows = must(await q.order("updated_at", { ascending: false }).limit(20)) as any[];
  return rows.map((r) => ({ projectId: r.project_id, project: r.projects?.name ?? "", number: r.number, title: r.title }));
}
