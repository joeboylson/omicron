// Projects: listing, loading one, and its statuses, topics and labels.
// Mirrors the `omicron projects` and `statuses` commands.

import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "../omicron";
import type { ProjectSummary, Status, Label, Topic, Person, Comment, ChecklistItem, TeamQuestion, Dispatch, HandoffNote, ProjectData, Run, SessionLoop } from "./types";
import { all, after } from "./shared";

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
          "id,number,title,notes,status_id,due_on,needs_review,position,assignee_person_id,assignee_session_id,ended_session,picked_up_at,topic_id,task_labels(label_id),checklist_items(id,text,done,position),comments(id,author_name,body,created_at,images,sessions(name)),dispatches(id,state,result,error,created_at,claimed_at,claim_by),task_jobs(jobs(id,number,title,state,step,teams(name))),team_requests(worker,state,created_at,answer_comment_id,answered_at,teams(name,machines(name,gate_until)))",
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
    loops: must(loops) as SessionLoop[],
    runs: must(runs) as Run[],
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

export async function setRunRules(db: SupabaseClient, id: string, run_rules: string) {
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
