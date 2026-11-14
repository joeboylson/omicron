// Claude sessions: Dispatch, giving a session's tasks away, runs and loops.

import type { SupabaseClient } from "@supabase/supabase-js";
import { computerHeaders } from "../remote";
import { must } from "../omicron";
import type { Task, ClaudeSession, ProjectData, Run, SessionLoop } from "./types";

export async function removeSession(db: SupabaseClient, session: ClaudeSession) {
  must(await db.from("sessions").delete().eq("id", session.id));
}

/**
 * Ask for a task to be handed to its session. Returns the request's id.
 * First straight to the computer serving this page: it takes its owner's
 * orders for its own sessions without its gate open. Otherwise through the
 * database, where the session's computer takes it only with its gate open.
 */
export async function requestDispatch(db: SupabaseClient, task: Task): Promise<string> {
  try {
    const res = await fetch("/api/dispatch", {
      method: "POST",
      headers: { ...(await computerHeaders(db)), "Content-Type": "application/json" },
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
