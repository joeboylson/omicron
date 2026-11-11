// Projects and tasks: what the page reads and changes. Mirrors what the
// `omicron projects`, `statuses` and `tasks` commands do.

import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./omicron";

export type ProjectSummary = { id: string; name: string; taskCount: number };
export type Status = { id: string; name: string; position: number; is_done: boolean };
export type Label = { id: string; name: string; color: string | null };
export type Person = { id: string; display_name: string };
export type ChecklistItem = { id: string; text: string; done: boolean; position: number };
export type Task = {
  id: string;
  number: number;
  title: string;
  notes: string;
  status_id: string;
  due_on: string | null;
  needs_review: boolean;
  position: number;
  assignee_person_id: string | null;
  labelIds: string[];
  checklist: ChecklistItem[];
};
export type ProjectData = {
  id: string;
  name: string;
  statuses: Status[];
  labels: Label[];
  members: Person[];
  tasks: Task[];
};

export async function listProjects(db: SupabaseClient): Promise<ProjectSummary[]> {
  const rows = must(await db.from("projects").select("id,name,tasks(count)").order("name"));
  return (rows as any[]).map((r) => ({ id: r.id, name: r.name, taskCount: r.tasks?.[0]?.count ?? 0 }));
}

export async function startProject(db: SupabaseClient, name: string): Promise<string> {
  const p = must(await db.rpc("start_project", { name }));
  return (p as { id: string }).id;
}

export async function loadProject(db: SupabaseClient, id: string): Promise<ProjectData | null> {
  const [project, statuses, labels, members, tasks] = await Promise.all([
    db.from("projects").select("id,name").eq("id", id).maybeSingle(),
    db.from("statuses").select("id,name,position,is_done").eq("project_id", id).order("position").order("name"),
    db.from("labels").select("id,name,color").eq("project_id", id).order("name"),
    db.from("project_members").select("people(id,display_name)").eq("project_id", id),
    db
      .from("tasks")
      .select(
        "id,number,title,notes,status_id,due_on,needs_review,position,assignee_person_id,task_labels(label_id),checklist_items(id,text,done,position)",
      )
      .eq("project_id", id)
      .order("position")
      .order("number"),
  ]);
  const p = must(project);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    statuses: must(statuses) as Status[],
    labels: must(labels) as Label[],
    members: (must(members) as any[])
      .map((m) => m.people as Person)
      .filter(Boolean)
      .sort((a, b) => a.display_name.localeCompare(b.display_name)),
    tasks: (must(tasks) as any[]).map((t) => ({
      id: t.id,
      number: t.number,
      title: t.title,
      notes: t.notes,
      status_id: t.status_id,
      due_on: t.due_on,
      needs_review: t.needs_review,
      position: t.position,
      assignee_person_id: t.assignee_person_id,
      labelIds: (t.task_labels ?? []).map((l: { label_id: string }) => l.label_id),
      checklist: [...(t.checklist_items ?? [])].sort((a: ChecklistItem, b: ChecklistItem) => a.position - b.position),
    })),
  };
}

const after = (xs: { position: number }[]) => xs.reduce((m, x) => Math.max(m, x.position), 0) + 1;

export async function renameProject(db: SupabaseClient, id: string, name: string) {
  must(await db.from("projects").update({ name }).eq("id", id));
}

export async function addTask(db: SupabaseClient, project: ProjectData, statusId: string, title: string) {
  const position = after(project.tasks.filter((t) => t.status_id === statusId));
  must(await db.from("tasks").insert({ project_id: project.id, status_id: statusId, title, position }));
}

type TaskChange = Partial<Pick<Task, "title" | "notes" | "status_id" | "due_on" | "needs_review" | "assignee_person_id">>;

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

export async function addLabel(db: SupabaseClient, projectId: string, name: string): Promise<string> {
  const row = must(await db.from("labels").insert({ project_id: projectId, name }).select("id").single());
  return (row as { id: string }).id;
}

export async function addChecklistItem(db: SupabaseClient, task: Task, text: string) {
  must(await db.from("checklist_items").insert({ task_id: task.id, text, position: after(task.checklist) }));
}

export async function tickChecklistItem(db: SupabaseClient, item: ChecklistItem, done: boolean) {
  must(await db.from("checklist_items").update({ done }).eq("id", item.id));
}

export async function deleteChecklistItem(db: SupabaseClient, item: ChecklistItem) {
  must(await db.from("checklist_items").delete().eq("id", item.id));
}

export async function addStatus(db: SupabaseClient, project: ProjectData, name: string) {
  // New statuses go just before the Done status, so Done stays last.
  const done = project.statuses.find((s) => s.is_done);
  const others = project.statuses.filter((s) => !s.is_done);
  const position = done ? (Math.max(-1, ...others.map((s) => s.position)) + done.position) / 2 : after(project.statuses);
  must(await db.from("statuses").insert({ project_id: project.id, name, position }));
}

export async function renameStatus(db: SupabaseClient, status: Status, name: string) {
  must(await db.from("statuses").update({ name }).eq("id", status.id));
}

export async function markDoneStatus(db: SupabaseClient, status: Status) {
  must(await db.from("statuses").update({ is_done: true }).eq("id", status.id));
}

export async function deleteStatus(db: SupabaseClient, status: Status) {
  must(await db.from("statuses").delete().eq("id", status.id));
}

export async function listPeople(db: SupabaseClient): Promise<Person[]> {
  return must(await db.from("people").select("id,display_name").order("display_name")) as Person[];
}

export async function addMember(db: SupabaseClient, projectId: string, personId: string) {
  must(await db.from("project_members").insert({ project_id: projectId, person_id: personId }));
}

export async function removeMember(db: SupabaseClient, projectId: string, personId: string) {
  must(await db.from("project_members").delete().eq("project_id", projectId).eq("person_id", personId));
}
