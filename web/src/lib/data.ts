// Projects and tasks: what the page reads and changes. Mirrors what the
// `omicron projects`, `statuses` and `tasks` commands do.

import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./omicron";

export type ProjectSummary = {
  id: string;
  name: string;
  taskCount: number;
  memberCount: number;
  /** Machines added to it (not counting ones on every Project). */
  machineCount: number;
  /** Claude sessions running in it now. */
  sessionCount: number;
};
export type Status = { id: string; name: string; position: number; is_done: boolean; color: string | null };
export type Label = { id: string; name: string; color: string | null };
/** A second way to group tasks: rows on the board, like "Joe's to-do". */
export type Topic = { id: string; name: string; position: number };
export type Person = { id: string; display_name: string };
export type Comment = {
  id: string;
  author: string;
  session: string | null;
  body: string;
  created_at: string;
  /** Its images' paths in Storage (see IMAGES_BUCKET). */
  images: string[];
};
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
  /** The session it was given to, which has since ended (until it's given out again). */
  ended_session: string | null;
  picked_up_at: string | null;
  labelIds: string[];
  checklist: ChecklistItem[];
  comments: Comment[];
  /** Requests to hand it to its session, newest first. */
  dispatches: Dispatch[];
  /** Team jobs it's linked to. */
  jobs: JobLink[];
};
/** A team's job, as linked from a task. */
export type JobLink = { id: string; team: string; number: number; title: string; state: string; step: string | null };
export type Dispatch = {
  id: string;
  state: "pending" | "claimed" | "done" | "failed";
  result: string | null;
  error: string | null;
  created_at: string;
  claimed_at: string | null;
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
  /** When its machine's gate closes, as the machine last said (display only). */
  gate_until: string | null;
  /** Why it's gone, when it is. */
  gone_why: string | null;
};
export type ProjectData = {
  id: string;
  name: string;
  /** How its Claude sessions work: given to a session with every task. */
  run_rules: string;
  statuses: Status[];
  labels: Label[];
  topics: Topic[];
  members: Person[];
  tasks: Task[];
  sessions: ClaudeSession[];
  handoffs: HandoffNote[];
  /** Running loops, one per session at most. */
  loops: SessionLoop[];
  /** Where its sessions start: one path on one machine each. Added only on that machine. */
  folders: Folder[];
  /** Its runs, newest first (the last few). */
  runs: Run[];
};
/** A session working down To do on its own (see `omicron runs`). */
export type Run = {
  id: string;
  machine_id: string;
  session_id: string | null;
  label_id: string | null;
  /** Who started it: its own machine (needs no gate), or a person elsewhere. */
  started_by: string;
  state: "running" | "pausing" | "stopped" | "finished";
  task_id: string | null;
  done: number;
  note: string | null;
  started_at: string;
  updated_at: string;
};
export type Folder = { id: string; path: string; machine_id: string; machine: string };
/** A prompt Omicron types into a session every so often. */
export type SessionLoop = {
  id: string;
  session_id: string;
  prompt: string;
  every_seconds: number;
  until: string | null;
  times: number | null;
  runs: number;
  note: string | null;
  next_run_at: string;
  last_run_at: string | null;
};

export async function listProjects(db: SupabaseClient): Promise<ProjectSummary[]> {
  const rows = must(
    await db.from("projects").select("id,name,tasks(count),project_members(count),project_machines(count),sessions(count)").order("name"),
  );
  const count = (r: any, k: string): number => r[k]?.[0]?.count ?? 0;
  return (rows as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    taskCount: count(r, "tasks"),
    memberCount: count(r, "project_members"),
    machineCount: count(r, "project_machines"),
    sessionCount: count(r, "sessions"),
  }));
}

export async function startProject(db: SupabaseClient, name: string): Promise<string> {
  const p = must(await db.rpc("start_project", { name }));
  return (p as { id: string }).id;
}

/** How many rows the database hands back per request at most (Supabase's
 *  PGRST_DB_MAX_ROWS, 1,000 by default). */
const PAGE = 1000;

/** Every row of a query, page by page: a list that fills a page is read on
 *  until it's all there. `page(from, to)` is the query for those rows. */
async function all<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>) {
  const rows: T[] = [];
  for (;;) {
    const r = await page(rows.length, rows.length + PAGE - 1);
    if (r.error) return { data: null as T[] | null, error: r.error };
    rows.push(...(r.data ?? []));
    if ((r.data ?? []).length < PAGE) return { data: rows, error: null };
  }
}

export async function loadProject(db: SupabaseClient, id: string): Promise<ProjectData | null> {
  const [project, statuses, labels, members, tasks, sessions, handoffs, topics, loops, folders, runs] = await Promise.all([
    db.from("projects").select("id,name,run_rules").eq("id", id).maybeSingle(),
    db.from("statuses").select("id,name,position,is_done,color").eq("project_id", id).order("position").order("name"),
    db.from("labels").select("id,name,color").eq("project_id", id).order("name"),
    db.from("project_members").select("people(id,display_name)").eq("project_id", id),
    all((from, to) =>
      db
        .from("tasks")
        .select(
          "id,number,title,notes,status_id,due_on,needs_review,position,assignee_person_id,assignee_session_id,ended_session,picked_up_at,topic_id,task_labels(label_id),checklist_items(id,text,done,position),comments(id,author_name,body,created_at,images,sessions(name)),dispatches(id,state,result,error,created_at,claimed_at),task_jobs(jobs(id,number,title,state,step,teams(name)))",
        )
        .eq("project_id", id)
        .order("position")
        .order("number")
        .order("id")
        .range(from, to),
    ),
    all((from, to) =>
      db.from("sessions").select("id,name,state,folder,machine_id,gone_why,machines(name,gate_until)").eq("project_id", id).order("name").order("id").range(from, to),
    ),
    db
      .from("handoffs")
      .select("id,number,session_id,state,written_at,body")
      .eq("project_id", id)
      .order("written_at", { ascending: false })
      .limit(100),
    db.from("topics").select("id,name,position").eq("project_id", id).order("position").order("name"),
    db
      .from("loops")
      .select("id,session_id,prompt,every_seconds,until,times,runs,note,next_run_at,last_run_at")
      .eq("project_id", id)
      .eq("state", "running"),
    db.from("folders").select("id,path,machine_id,machines(name)").eq("project_id", id).order("path"),
    db
      .from("runs")
      .select("id,machine_id,session_id,label_id,started_by,state,task_id,done,note,started_at,updated_at")
      .eq("project_id", id)
      .order("started_at", { ascending: false })
      .limit(5),
  ]);
  const p = must(project);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    run_rules: p.run_rules ?? "",
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
      ended_session: t.ended_session ?? null,
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
          images: c.images ?? [],
        }))
        .sort((a: Comment, b: Comment) => a.created_at.localeCompare(b.created_at)),
      dispatches: [...(t.dispatches ?? [])].sort((a: Dispatch, b: Dispatch) => b.created_at.localeCompare(a.created_at)),
      jobs: (t.task_jobs ?? [])
        .map((l: any) => l.jobs)
        .filter(Boolean)
        .map((j: any) => ({ id: j.id, team: j.teams?.name ?? "", number: j.number, title: j.title, state: j.state, step: j.step })),
    })),
    sessions: (must(sessions) as any[]).map((r) => ({
      id: r.id,
      name: r.name,
      state: r.state,
      folder: r.folder,
      machine_id: r.machine_id,
      machine: r.machines?.name ?? "",
      gate_until: r.machines?.gate_until ?? null,
      gone_why: r.gone_why,
    })),
    handoffs: must(handoffs) as HandoffNote[],
    loops: must(loops) as SessionLoop[],
    runs: must(runs) as Run[],
    folders: (must(folders) as any[])
      .map((f) => ({ id: f.id, path: f.path, machine_id: f.machine_id, machine: f.machines?.name ?? "" }))
      .sort((a, b) => a.machine.localeCompare(b.machine) || a.path.localeCompare(b.path)),
  };
}

const after = (xs: { position: number }[]) => xs.reduce((m, x) => Math.max(m, x.position), 0) + 1;

/** Delete a Project and everything in it (tasks, sessions). */
export async function deleteProject(db: SupabaseClient, id: string) {
  const gone = must(await db.from("projects").delete().eq("id", id).select("id")) as unknown[];
  if (gone.length === 0) throw new Error("That Project couldn't be deleted (are you a member?).");
}

export async function setRunRules(db: SupabaseClient, id: string, run_rules: string) {
  must(await db.from("projects").update({ run_rules }).eq("id", id));
}

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
  const row = must(
    await db.from("tasks").insert({ project_id: project.id, status_id: statusId, title, position, topic_id: topicId }).select("number").single(),
  ) as { number: number };
  return row.number;
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

/** Let a machine use a Project (its sessions can work in it). */
export async function addProjectMachine(db: SupabaseClient, projectId: string, machineId: string) {
  must(await db.from("project_machines").insert({ project_id: projectId, machine_id: machineId }));
}

/** Take a machine out of a Project: its sessions there end. */
export async function removeProjectMachine(db: SupabaseClient, projectId: string, machineId: string) {
  must(await db.from("project_machines").delete().eq("project_id", projectId).eq("machine_id", machineId));
}

export async function removeSession(db: SupabaseClient, session: ClaudeSession) {
  must(await db.from("sessions").delete().eq("id", session.id));
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

export async function setStatusColor(db: SupabaseClient, status: Status, color: string) {
  must(await db.from("statuses").update({ color }).eq("id", status.id));
}

export async function renameLabel(db: SupabaseClient, label: Label, name: string) {
  must(await db.from("labels").update({ name }).eq("id", label.id));
}

/** Also takes it off every task that has it. */
export async function deleteLabel(db: SupabaseClient, label: Label) {
  must(await db.from("labels").delete().eq("id", label.id));
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

/**
 * Ask for a task to be handed to its session. Returns the request's id.
 * First straight to the computer serving this page: it takes its owner's
 * orders for its own sessions without its gate open. Otherwise through the
 * database, where the session's computer takes it only with its gate open.
 */
export async function requestDispatch(db: SupabaseClient, task: Task): Promise<string> {
  try {
    const { data } = await db.auth.getSession();
    const res = await fetch("/api/dispatch", {
      method: "POST",
      headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: task.id }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.id) return json.id as string;
    if (!json?.elsewhere && res.status !== 404) throw new Error(json?.error ?? res.statusText);
  } catch (e) {
    if (!(e instanceof TypeError)) throw e; // TypeError: the page's computer couldn't be reached
  }
  const row = must(await db.from("dispatches").insert({ task_id: task.id }).select("id").single()) as { id: string };
  return row.id;
}

/** Fail a request nobody took. Does nothing if it was taken after all. */
export async function giveUpDispatch(db: SupabaseClient, id: string, why: string) {
  must(await db.rpc("give_up_dispatch", { dispatch: id, why }));
}

/** Give a session's open tasks to a member or to another session. */
export async function giveSessionTasks(db: SupabaseClient, project: ProjectData, from: ClaudeSession, to: { person?: string; session?: string }) {
  const done = new Set(project.statuses.filter((s) => s.is_done).map((s) => s.id));
  const ids = project.tasks.filter((t) => t.assignee_session_id === from.id && !done.has(t.status_id)).map((t) => t.id);
  if (ids.length === 0) return;
  must(
    await db
      .from("tasks")
      .update({ assignee_person_id: to.person ?? null, assignee_session_id: to.session ?? null })
      .in("id", ids),
  );
}

/** Start a run in a session, through the database: its computer takes it
 * only from its owner, with its gate open. */
export async function startRun(db: SupabaseClient, project: ProjectData, session: ClaudeSession, labelId: string | null) {
  must(await db.from("runs").insert({ project_id: project.id, machine_id: session.machine_id, session_id: session.id, label_id: labelId }));
}

/** Pause (after the task it's on) or stop a run. Anyone in the Project can. */
export async function setRunState(db: SupabaseClient, run: Run, state: "pausing" | "stopped") {
  must(await db.from("runs").update({ state }).eq("id", run.id));
}

export async function stopLoop(db: SupabaseClient, loop: SessionLoop) {
  must(await db.rpc("stop_loop", { loop: loop.id }));
}

/** "10m", "1h30m", "90s". */
export function sayEvery(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h && `${h}h`, m && `${m}m`, s && `${s}s`].filter(Boolean).join("");
}

/** Someone in the people table: their logins and the Projects (that you can see) they're in. */
export type PersonRow = { id: string; display_name: string; logins: string[]; projectIds: string[] };

export async function listPeopleTable(db: SupabaseClient): Promise<PersonRow[]> {
  const rows = must(
    await db.from("people").select("id,display_name,tailscale_identities(login),project_members(project_id)").order("display_name"),
  ) as any[];
  return rows.map((r) => ({
    id: r.id,
    display_name: r.display_name,
    logins: (r.tailscale_identities ?? []).map((t: { login: string }) => t.login).sort(),
    projectIds: (r.project_members ?? []).map((m: { project_id: string }) => m.project_id),
  }));
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
export async function organize(db: SupabaseClient, project: ProjectData, tasks: Task[], by: "number" | "name" | "assignee") {
  const who = (t: Task) =>
    project.members.find((m) => m.id === t.assignee_person_id)?.display_name ?? project.sessions.find((s) => s.id === t.assignee_session_id)?.name ?? null;
  const sorted = [...tasks].sort((a, b) => {
    if (by === "name") return a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }) || a.number - b.number;
    if (by === "assignee") {
      const [x, y] = [who(a), who(b)];
      if (x !== y) return x === null ? 1 : y === null ? -1 : x.localeCompare(y);
    }
    return a.number - b.number;
  });
  // Only the ones whose place changes.
  const changed = sorted.map((t, i) => ({ t, position: i + 1 })).filter(({ t, position }) => t.position !== position);
  await Promise.all(changed.map(({ t, position }) => db.from("tasks").update({ position }).eq("id", t.id).then(must)));
}

/** Give tasks new positions (a tied column numbered before a drop). */
export async function renumberTasks(db: SupabaseClient, rows: { id: string; position: number }[]) {
  await Promise.all(rows.map((r) => db.from("tasks").update({ position: r.position }).eq("id", r.id).then(must)));
}

export async function moveTask(
  db: SupabaseClient,
  task: Task,
  to: { statusId: string; topicId?: string | null; position: number },
) {
  const row: Record<string, unknown> = { status_id: to.statusId, position: to.position };
  if (to.topicId !== undefined) row.topic_id = to.topicId;
  must(await db.from("tasks").update(row).eq("id", task.id));
}

/** A registered machine (each has its own API key). */
export type MachineRow = {
  id: string;
  name: string;
  active: boolean;
  last_seen: string | null;
  all_projects: boolean;
  projectIds: string[];
};

export async function listMachines(db: SupabaseClient): Promise<MachineRow[]> {
  const rows = must(await db.from("machines").select("id,name,active,last_seen,all_projects,project_machines(project_id)").order("name")) as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    active: r.active,
    last_seen: r.last_seen,
    all_projects: r.all_projects,
    projectIds: (r.project_machines ?? []).map((m: { project_id: string }) => m.project_id),
  }));
}

/** API keys go through the Web Machine (it has the secret key), as you. */
async function machinesApi(db: SupabaseClient, path: string, body?: unknown): Promise<any> {
  const { data } = await db.auth.getSession();
  const res = await fetch(`/api/machines${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(json?.error ?? res.statusText);
  return json;
}

/** Register a machine in these Projects. Returns its API key (shown once). */
export async function createMachineKey(db: SupabaseClient, name: string, projectIds: string[]): Promise<string> {
  return (await machinesApi(db, "", { name, project_ids: projectIds })).key;
}

export async function switchMachine(db: SupabaseClient, id: string, on: boolean) {
  await machinesApi(db, `/${id}/${on ? "switch-on" : "switch-off"}`);
}

/** Delete a person for good, through the Web Machine (it has the secret key). */
export async function deletePerson(db: SupabaseClient, id: string) {
  const { data } = await db.auth.getSession();
  const res = await fetch(`/api/people/${id}/delete`, { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
}

export async function removeMachine(db: SupabaseClient, id: string) {
  await machinesApi(db, `/${id}/remove`);
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
