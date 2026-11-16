import { createContext, useContext, useState } from "react";
import { Eye } from "lucide-react";
import { useApp } from "@/lib/app";
import { must } from "@/lib/omicron";
import { devAction, type Dev } from "@/lib/dev";
import { sayEvery, startLoop, type ClaudeSession, type ProjectData, type SessionLoop } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { Switch } from "@/components/base/switch";
import { cn, radioArrows } from "@/lib/utils";

/** What a watch started from the board looks at (#279): a column, or one task. */
export type WatchTarget = { statusId: string } | { taskId: string };

export type Watcher = { loop: SessionLoop; session: ClaudeSession; index: number };

/** Watching from anywhere on the Project page: open the Watch window, or stop a watch. */
export const WatchContext = createContext<{ open: (t: WatchTarget) => void; stop: (w: Watcher) => void }>({ open: () => {}, stop: () => {} });
export const useWatch = () => useContext(WatchContext);

const EVERY: [number, string][] = [
  [0, "As soon as it's done"],
  [300, "5 minutes"],
  [900, "15 minutes"],
  [1800, "30 minutes"],
  [3600, "hour"],
];

/** The running loops watching a column or a task (#279). */
export function watchers(project: ProjectData, target: WatchTarget): Watcher[] {
  const out: Watcher[] = [];
  for (const loop of project.loops) {
    const session = project.sessions.find((s) => s.id === loop.session_id);
    if (!session) continue;
    (loop.watches ?? []).forEach((w, index) => {
      const hit =
        "statusId" in target
          ? !w.task_id && w.status_ids.length === 1 && w.status_ids[0] === target.statusId && w.label_ids.length === 0 && !w.given_person && !w.given_session
          : w.task_id === target.taskId;
      if (hit) out.push({ loop, session, index });
    });
  }
  return out;
}

/** Stop a session watching it: on its own computer by the computer, as the loop runs there. */
export async function stopWatching(db: ReturnType<typeof useApp>["db"], project: ProjectData, dev: Dev | null, w: Watcher) {
  if (dev && w.session.machine_id === dev.machine_id) {
    await devAction(db, "/run", { action: "loops-watch-remove", session: w.session.name, project: project.name, number: String(w.index + 1) });
    return;
  }
  const watch = w.loop.watches![w.index];
  must(await db.from("loop_watches").delete().eq("id", watch.id));
  // Its last watch, and no message: nothing left to do, so it stops (like `omicron loop watch remove`).
  if ((w.loop.watches?.length ?? 0) === 1 && !w.loop.prompt) must(await db.rpc("stop_loop", { loop: w.loop.id }));
}

/**
 * Watch With a Session (#279): pick a session; it's added to that session's
 * loop list, or a loop is started for it (asking only how often, and Start
 * Fresh). On this computer, the computer does it, as when a loop is started.
 */
export function WatchDialog({ project, dev, target, onClose, onChanged }: { project: ProjectData; dev: Dev | null; target: WatchTarget | null; onClose: () => void; onChanged: () => void }) {
  const { db, act } = useApp();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [every, setEvery] = useState(0);
  const [startFresh, setStartFresh] = useState(true);
  const sessions = project.sessions.filter((s) => !dev || s.machine_id === dev.machine_id);
  // A session still on an older run can't take a loop as well.
  const onRun = new Set(project.runs.filter((r) => r.state === "running" || r.state === "pausing").map((r) => r.session_id));
  const session = sessions.find((s) => s.id === sessionId && !onRun.has(s.id)) ?? null;
  const loop = session ? project.loops.find((l) => l.session_id === session.id) : undefined;
  const what =
    target && "statusId" in target
      ? (project.statuses.find((s) => s.id === target.statusId)?.name ?? "this column")
      : target
        ? `#${project.tasks.find((t) => t.id === target.taskId)?.number ?? "?"}`
        : "";

  const watch = () =>
    act(async () => {
      if (!session || !target) return;
      const task = "taskId" in target ? project.tasks.find((t) => t.id === target.taskId) : undefined;
      const status = "statusId" in target ? project.statuses.find((s) => s.id === target.statusId) : undefined;
      if (dev && session.machine_id === dev.machine_id) {
        await devAction(
          db,
          "/run",
          loop
            ? { action: "loops-watch-add", session: session.name, project: project.name, status: status?.name ?? "", task: task ? String(task.number) : "" }
            : {
                action: "loops-start",
                session: session.name,
                project: project.name,
                prompt: "",
                asap: every === 0 ? "true" : "",
                every: every ? sayEvery(every) : "",
                start_fresh: startFresh ? "true" : "false",
                watch_status: status?.name ?? "",
                watch_tasks: task ? String(task.number) : "",
              },
        );
      } else {
        const w = "statusId" in target ? { status_ids: [target.statusId] } : { task_id: target.taskId };
        if (loop) {
          must(await db.from("loop_watches").insert({ ...w, loop_id: loop.id }));
        } else {
          await startLoop(db, session, { prompt: "", every_seconds: every || null, asap: every === 0, times: null, start_fresh: startFresh, watches: [w] });
        }
      }
      onChanged();
      onClose();
    });

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] gap-4 overflow-y-auto sm:max-w-md" onOpenAutoFocus={focusSheet}>
        <DialogHeader className="text-left">
          <DialogTitle>Watch {what}</DialogTitle>
          <DialogDescription className="sr-only">Pick a session to watch it.</DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label="Session" className="grid gap-2">
          {sessions.length === 0 && <p className="text-sm text-muted-foreground">No Claude sessions here yet.</p>}
          {sessions.map((s) => {
            const has = project.loops.find((l) => l.session_id === s.id);
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={sessionId === s.id && !onRun.has(s.id)}
                disabled={onRun.has(s.id)}
                onKeyDown={radioArrows}
                onClick={() => setSessionId(s.id)}
                className={cn(
                  "grid rounded-lg border px-4 py-2.5 text-left disabled:opacity-50",
                  sessionId === s.id && !onRun.has(s.id) ? "border-[var(--sys-blue)] ring-1 ring-[var(--sys-blue)]" : "enabled:hover:bg-accent",
                )}
              >
                <span className="font-medium">{s.name}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {onRun.has(s.id) ? "On a run" : has ? `Adds to its list (${has.asap ? "as soon as it's done" : `every ${sayEvery(has.every_seconds)}`})` : "Starts a loop"}
                </span>
              </button>
            );
          })}
        </div>
        {session && !loop && (
          <>
            <label className="grid gap-1.5 text-sm font-medium">
              Check
              <select value={every} onChange={(e) => setEvery(Number(e.target.value))} className="h-10 rounded-md border bg-background px-2 font-normal">
                {EVERY.map(([v, t]) => (
                  <option key={v} value={v}>
                    {v ? `Every ${t}` : t}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-3 rounded-lg border px-4 py-2">
              <span className="flex-1">Start Fresh Each Run</span>
              <Switch checked={startFresh} onCheckedChange={setStartFresh} aria-label="Start Fresh Each Run" />
            </label>
          </>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!session} onClick={watch}>
            <Eye aria-hidden /> Watch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
