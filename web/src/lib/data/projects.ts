// Projects: listing, loading one, and its statuses, topics and labels.
// Mirrors the `omicron projects` and `statuses` commands.

import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "../omicron";
import type { ProjectSummary, Status, Label, Topic, Person, ChecklistItem, TeamQuestion, Dispatch, HandoffNote, ProjectData, Run, SessionLoop, LoopPlan } from "./types";
import { all, after } from "./shared";

export async function listProjects(db: SupabaseClient): Promise<ProjectSummary[]> {
  const rows = must(
    await db.from("projects").select("id,name,tasks(count),unread:tasks(count),project_members(count),project_machines(count),sessions(count)")
      .eq("unread.needs_review", true)
      .order("name"),
  );
  const count = (r: any, k: string): number => r[k]?.[0]?.count ?? 0;
  return (rows as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    taskCount: count(r, "tasks"),
    unreadCount: count(r, "unread"),
    memberCount: count(r, "project_members"),
    machineCount: count(r, "project_machines"),
    sessionCount: count(r, "sessions"),
  }));
}

export async function startProject(db: SupabaseClient, name: string): Promise<string> {
  const p = must(await db.rpc("start_project", { name }));
  return (p as { id: string }).id;
}

/** Loops with their watches, oldest first (#278). */
function withWatches(rows: any[]): SessionLoop[] {
  return rows.map(({ loop_watches, ...l }) => ({
    ...l,
    watches: [...(loop_watches ?? [])].sort((a: any, b: any) => a.created_at.localeCompare(b.created_at)).map(({ created_at: _, ...w }: any) => w),
  }));
}

export async function loadProject(db: SupabaseClient, id: string): Promise<ProjectData | null> {
  const [project, statuses, labels, members, tasks, sessions, handoffs, topics, loops, folders, runs, plans, conversations] = await Promise.all([
    db.from("projects").select("id,name,run_rules").eq("id", id).maybeSingle(),
    db.from("statuses").select("id,name,position,is_done,color").eq("project_id", id).order("position").order("name"),
    db.from("labels").select("id,name,color").eq("project_id", id).order("name"),
    db.from("project_members").select("people(id,display_name)").eq("project_id", id),
    all((from, to) =>
      db
        .from("tasks")
        .select(
          "id,number,title,notes,status_id,due_on,needs_review,position,assignee_person_id,assignee_session_id,ended_session,picked_up_at,topic_id,task_labels(label_id),checklist_items(id,text,done,position),comments(count),dispatches(id,state,result,error,created_at,claimed_at,claim_by),task_jobs(jobs(id,number,title,state,step,teams(name))),team_requests(worker,state,created_at,answer_comment_id,answered_at,teams(name,machines(name,gate_until)))",
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
      .select("id,session_id,state,started_at,prompt,every_seconds,until,times,runs,note,next_run_at,last_run_at,rules,asap,start_fresh,loop_watches(id,status_ids,label_ids,given_person,given_session,task_id,conversation_id,instructions,created_at)")
      .eq("project_id", id)
      .eq("kind", "command")
      .order("started_at", { ascending: false })
      .limit(30),
    db.from("folders").select("id,path,machine_id,machines(name)").eq("project_id", id).order("path"),
    db
      .from("loops")
      .select("id,machine_id,session_id,label_id,started_by,state,task_id,task_ids,done,note,started_at,updated_at")
      .eq("project_id", id)
      .eq("kind", "tasks")
      .order("started_at", { ascending: false })
      .limit(20),
    db.from("loop_plans").select("id,name,kind,prompt,every_seconds,times,task_ids,session_id,template,created_at,rules").eq("project_id", id).order("created_at"),
    db.from("conversations").select("id,name,unread,last_message_at,created_at,conversation_tasks(task_id,created_at)").eq("project_id", id),
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
      // Only how many: a task's comments are loaded when it's opened (#265).
      commentCount: t.comments?.[0]?.count ?? 0,
      comments: [],
      dispatches: [...(t.dispatches ?? [])].sort((a: Dispatch, b: Dispatch) => b.created_at.localeCompare(a.created_at)),
      jobs: (t.task_jobs ?? [])
        .map((l: any) => l.jobs)
        .filter(Boolean)
        .map((j: any) => ({ id: j.id, team: j.teams?.name ?? "", number: j.number, title: j.title, state: j.state, step: j.step })),
      question: teamQuestion(t.team_requests),
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
    loops: withWatches(must(loops) ?? []).filter((l) => l.state === "running"),
    pastLoops: withWatches(must(loops) ?? []).filter((l) => l.state !== "running"),
    runs: must(runs) as Run[],
    plans: must(plans) as LoopPlan[],
    conversations: (must(conversations) as any[])
      .map(({ conversation_tasks, ...c }) => ({
        ...c,
        task_ids: [...(conversation_tasks ?? [])].sort((a: any, b: any) => a.created_at.localeCompare(b.created_at)).map((x: any) => x.task_id),
      }))
      .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at)),
    folders: (must(folders) as any[])
      .map((f) => ({ id: f.id, path: f.path, machine_id: f.machine_id, machine: f.machines?.name ?? "" }))
      .sort((a, b) => a.machine.localeCompare(b.machine) || a.path.localeCompare(b.path)),
  };
}

/** A task's team question, from its team_requests row (one at most). */
function teamQuestion(rows: any): TeamQuestion | null {
  const r = Array.isArray(rows) ? rows[0] : rows;
  if (!r) return null;
  return {
    team: r.teams?.name ?? "",
    worker: r.worker,
    open: r.state === "open",
    asked_at: r.created_at,
    answer_comment_id: r.answer_comment_id ?? null,
    answered_at: r.answered_at ?? null,
    machine: r.teams?.machines?.name ?? "",
    gate_until: r.teams?.machines?.gate_until ?? null,
  };
}

/** Delete a Project and everything in it (tasks, sessions). */
export async function deleteProject(db: SupabaseClient, id: string) {
  const gone = must(await db.from("projects").delete().eq("id", id).select("id")) as unknown[];
  if (gone.length === 0) throw new Error("That Project couldn't be deleted (are you a member?).");
}

/** A Project's board rules (#277), kept as run_rules, their old name. */
export async function setBoardRules(db: SupabaseClient, id: string, run_rules: string) {
  must(await db.from("projects").update({ run_rules }).eq("id", id));
}

export async function renameProject(db: SupabaseClient, id: string, name: string) {
  must(await db.from("projects").update({ name }).eq("id", id));
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

/** Move a column (a status or a topic) one place left or right (#259): the
 *  columns are numbered 1, 2, 3… in their new order, so ties sort out too. */
export async function moveColumn(db: SupabaseClient, table: "statuses" | "topics", columns: { id: string; position: number }[], index: number, by: -1 | 1) {
  const to = index + by;
  if (to < 0 || to >= columns.length) return;
  const order = [...columns];
  [order[index], order[to]] = [order[to], order[index]];
  for (const [n, c] of order.entries()) {
    if (c.position !== n + 1) must(await db.from(table).update({ position: n + 1 }).eq("id", c.id));
  }
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

export async function setStatusColor(db: SupabaseClient, status: Status, color: string) {
  must(await db.from("statuses").update({ color }).eq("id", status.id));
}

export async function addLabel(db: SupabaseClient, projectId: string, name: string): Promise<string> {
  const row = must(await db.from("labels").insert({ project_id: projectId, name }).select("id").single());
  return (row as { id: string }).id;
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

/** Projects someone else added you to since `since`, newest last, with
 *  who did it: from the change lines, which the person added always sees (#244). */
export async function addedToProjects(
  db: SupabaseClient,
  personId: string,
  since: string,
): Promise<{ at: string; projectId: string; by: string | null }[]> {
  const rows = must(
    await db
      .from("changes")
      .select("at,project_id,actor_id")
      .eq("table_name", "project_members")
      .eq("kind", "INSERT")
      .eq("subject_id", personId)
      .gt("at", since)
      .order("at"),
  ) as { at: string; project_id: string; actor_id: string | null }[];
  return rows.filter((r) => r.actor_id !== personId).map((r) => ({ at: r.at, projectId: r.project_id, by: r.actor_id }));
}
