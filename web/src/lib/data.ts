// Projects and tasks: what the page reads and changes. Mirrors what the
// `omicron projects`, `statuses` and `tasks` commands do.

import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./omicron";

export type ProjectSummary = { id: string; name: string; taskCount: number };
export type Status = { id: string; name: string; position: number; is_done: boolean; color: string | null };
export type Label = { id: string; name: string; color: string | null };
/** A second way to group tasks: rows on the board, like "Joe's to-do". */
export type Topic = { id: string; name: string; position: number };
export type Person = { id: string; display_name: string };
export type Comment = { id: string; author: string; session: string | null; body: string; created_at: string };
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
  topic_id: string | null;
  /** The Claude session it was sent to, and when the session picked it up. */
  assignee_session_id: string | null;
  picked_up_at: string | null;
  labelIds: string[];
  checklist: ChecklistItem[];
  comments: Comment[];
  /** Requests to hand it to its session, newest first. */
  dispatches: Dispatch[];
};
export type Dispatch = {
  id: string;
  state: "pending" | "claimed" | "done" | "failed";
  result: string | null;
  error: string | null;
  created_at: string;
};
export type HandoffNote = {
  id: string;
  number: number;
  session_id: string | null;
  state: "waiting" | "picked_up" | "replaced" | "cancelled";
  written_at: string;
  body: string;
};
export type ClaudeSession = {
  id: string;
  name: string;
  state: "open" | "closed" | "gone";
  folder: string;
  machine_id: string;
  machine: string;
};
export type ChatMessage = { id: string; author: string; session: string | null; body: string; created_at: string };
export type ProjectData = {
  id: string;
  name: string;
  chatEnabled: boolean;
  statuses: Status[];
  labels: Label[];
  topics: Topic[];
  members: Person[];
  tasks: Task[];
  sessions: ClaudeSession[];
  handoffs: HandoffNote[];
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
  const [project, statuses, labels, members, tasks, sessions, handoffs, topics] = await Promise.all([
    db.from("projects").select("id,name,chat_enabled").eq("id", id).maybeSingle(),
    db.from("statuses").select("id,name,position,is_done,color").eq("project_id", id).order("position").order("name"),
    db.from("labels").select("id,name,color").eq("project_id", id).order("name"),
    db.from("project_members").select("people(id,display_name)").eq("project_id", id),
    db
      .from("tasks")
      .select(
        "id,number,title,notes,status_id,due_on,needs_review,position,assignee_person_id,assignee_session_id,picked_up_at,topic_id,task_labels(label_id),checklist_items(id,text,done,position),comments(id,author_name,body,created_at,sessions(name)),dispatches(id,state,result,error,created_at)",
      )
      .eq("project_id", id)
      .order("position")
      .order("number"),
    db.from("sessions").select("id,name,state,folder,machine_id,machines(name)").eq("project_id", id).order("name"),
    db
      .from("handoffs")
      .select("id,number,session_id,state,written_at,body")
      .eq("project_id", id)
      .order("written_at", { ascending: false })
      .limit(100),
    db.from("topics").select("id,name,position").eq("project_id", id).order("position").order("name"),
  ]);
  const p = must(project);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    chatEnabled: p.chat_enabled,
    statuses: must(statuses) as Status[],
    labels: must(labels) as Label[],
    topics: must(topics) as Topic[],
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
      assignee_session_id: t.assignee_session_id,
      topic_id: t.topic_id,
      picked_up_at: t.picked_up_at,
      labelIds: (t.task_labels ?? []).map((l: { label_id: string }) => l.label_id),
      checklist: [...(t.checklist_items ?? [])].sort((a: ChecklistItem, b: ChecklistItem) => a.position - b.position),
      comments: (t.comments ?? [])
        .map((c: any) => ({
          id: c.id,
          author: c.author_name,
          session: c.sessions?.name ?? null,
          body: c.body,
          created_at: c.created_at,
        }))
        .sort((a: Comment, b: Comment) => a.created_at.localeCompare(b.created_at)),
      dispatches: [...(t.dispatches ?? [])].sort((a: Dispatch, b: Dispatch) => b.created_at.localeCompare(a.created_at)),
    })),
    sessions: (must(sessions) as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      state: r.state,
      folder: r.folder,
      machine_id: r.machine_id,
      machine: r.machines?.name ?? "",
    })),
    handoffs: must(handoffs) as HandoffNote[],
  };
}

const after = (xs: { position: number }[]) => xs.reduce((m, x) => Math.max(m, x.position), 0) + 1;

export async function renameProject(db: SupabaseClient, id: string, name: string) {
  must(await db.from("projects").update({ name }).eq("id", id));
}

export async function addTask(
  db: SupabaseClient,
  project: ProjectData,
  statusId: string,
  title: string,
  topicId: string | null = null,
) {
  const position = after(project.tasks.filter((t) => t.status_id === statusId));
  must(await db.from("tasks").insert({ project_id: project.id, status_id: statusId, title, position, topic_id: topicId }));
}

export async function addTopic(db: SupabaseClient, project: ProjectData, name: string) {
  must(await db.from("topics").insert({ project_id: project.id, name }));
}

export async function renameTopic(db: SupabaseClient, topic: Topic, name: string) {
  must(await db.from("topics").update({ name }).eq("id", topic.id));
}

/** Its tasks are kept, without a topic. */
export async function deleteTopic(db: SupabaseClient, topic: Topic) {
  must(await db.from("topics").delete().eq("id", topic.id));
}

type TaskChange = Partial<
  Pick<
    Task,
    "title" | "notes" | "status_id" | "due_on" | "needs_review" | "assignee_person_id" | "assignee_session_id" | "topic_id"
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

export async function removeSession(db: SupabaseClient, session: ClaudeSession) {
  must(await db.from("sessions").delete().eq("id", session.id));
}

export async function addComment(db: SupabaseClient, task: Task, body: string) {
  must(await db.from("comments").insert({ task_id: task.id, body }));
}

export async function loadChat(db: SupabaseClient, projectId: string): Promise<ChatMessage[]> {
  const rows = must(
    await db
      .from("chat_messages")
      .select("id,author_name,body,created_at,sessions(name)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(100),
  ) as any[];
  return rows
    .map((r) => ({ id: r.id, author: r.author_name, session: r.sessions?.name ?? null, body: r.body, created_at: r.created_at }))
    .reverse();
}

export async function sendChat(db: SupabaseClient, projectId: string, body: string) {
  must(await db.from("chat_messages").insert({ project_id: projectId, body }));
}

export async function setChat(db: SupabaseClient, projectId: string, on: boolean) {
  must(await db.from("projects").update({ chat_enabled: on }).eq("id", projectId));
}

export async function setStatusColor(db: SupabaseClient, status: Status, color: string) {
  must(await db.from("statuses").update({ color }).eq("id", status.id));
}

export async function setLabelColor(db: SupabaseClient, label: Label, color: string) {
  must(await db.from("labels").update({ color }).eq("id", label.id));
}

export type UsageWindow = { percent: number; resets_at: string | null } | null;
export type MachineAccounts = {
  in_use: string | null;
  accounts: { name: string; five_hour: UsageWindow; weekly: UsageWindow }[];
  auto: { primary: string; secondary: string; held: string | null } | null;
};
export type MachineSummary = { id: string; name: string; active: boolean; accounts: MachineAccounts };

/** Machines that report their Claude accounts. */
export async function listMachineAccounts(db: SupabaseClient): Promise<MachineSummary[]> {
  const rows = must(
    await db.from("machines").select("id,name,active,claude_accounts").not("claude_accounts", "is", null).order("name"),
  ) as any[];
  return rows.map((r) => ({ id: r.id, name: r.name, active: r.active, accounts: r.claude_accounts }));
}

/** How long a machine has to take a Dispatch before it fails (the database agrees). */
export const DISPATCH_CLAIM_SECONDS = 20;

/** Ask for a task to be handed to its session. Returns the request's id. */
export async function requestDispatch(db: SupabaseClient, task: Task): Promise<string> {
  const row = must(await db.from("dispatches").insert({ task_id: task.id }).select("id").single()) as { id: string };
  return row.id;
}

/** Fail a request nobody took. Does nothing if it was taken after all. */
export async function giveUpDispatch(db: SupabaseClient, id: string, why: string) {
  must(await db.rpc("give_up_dispatch", { dispatch: id, why }));
}
