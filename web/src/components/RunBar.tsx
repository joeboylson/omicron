import { useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { useApp } from "@/lib/app";
import { devAction, useDev, whenDev } from "@/lib/dev";
import { setRunState, startRun, type ClaudeSession, type ProjectData, type Run } from "@/lib/data";
import { cn } from "@/lib/utils";
import { inOrder } from "@/lib/board-rules";
import { Button } from "@/components/base/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { Group, Row } from "@/components/Grouped";
import { Markdown } from "@/components/Markdown";

const when = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
const active = (r: Run) => r.state === "running" || r.state === "pausing";

/**
 * A Project's run (ref/BRAINSTORM.md, "Runs"): what it's on and how far
 * it's got, with Pause and Stop; or Start one. Tap it for the night so far:
 * the session's handoff notes as a diary, and what's waiting on Joe.
 */
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** When the session's computer's gate closes, if it's open (as the computer last said). */
function gateUntil(s: ClaudeSession): string | null {
  return s.gate_until && new Date(s.gate_until).getTime() > Date.now() ? s.gate_until : null;
}

/** "studio's remote control is on until 7:00 AM." or "… is off." */
/** What a run is doing now, in words: the task it's on, or how it ended. */
export function runNow(project: ProjectData, run: Run): string {
  const task = project.tasks.find((t) => t.id === run.task_id);
  if (task && (run.state === "running" || run.state === "pausing")) return `Working on #${task.number} ${task.title}`;
  if (run.note) return run.note;
  return { running: "Starting the next task", pausing: "Pausing after this task", stopped: "Stopped", finished: "Finished: nothing left in To do" }[run.state];
}

function gateWords(s: ClaudeSession): string {
  const until = gateUntil(s);
  return until ? `${s.machine}'s remote control is on until ${clock(until)}.` : `${s.machine}'s remote control is off.`;
}

/** What a run works down: the first status's tasks (only its label, if it
 *  has one), in board order, as the computer picks them. */
function runQueue(project: ProjectData, labelId: string | null, skip?: string | null): ProjectData["tasks"] {
  const first = [...project.statuses].sort((a, b) => a.position - b.position)[0];
  if (!first) return [];
  return inOrder(project.tasks.filter((t) => t.status_id === first.id && (!labelId || t.labelIds.includes(labelId)) && t.id !== skip));
}

/** `machineId`: only runs on that computer, and only its sessions (the Dev view, about this computer). */
export function RunBar({ project, onChanged, machineId }: { project: ProjectData; onChanged: () => void; machineId?: string }) {
  const { db, act } = useApp();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const runs = machineId ? project.runs.filter((r) => r.machine_id === machineId) : project.runs;
  const run = runs.find(active) ?? runs[0] ?? null;
  const session = run && project.sessions.find((s) => s.id === run.session_id);
  // The sessions a run can start in: this computer's, in the Dev view.
  const here = machineId ? project.sessions.filter((s) => s.machine_id === machineId) : project.sessions;
  if (!run && here.length === 0) return null;
  const going = run !== null && active(run);
  const label = run?.label_id ? project.labels.find((l) => l.id === run.label_id)?.name : null;

  return (
    <section aria-label="Run" className="flex flex-wrap items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pb-2 text-sm">
      {run && (
        <button
          type="button"
          className="flex min-h-9 min-w-0 flex-1 basis-full items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-left sm:basis-0"
          onClick={() => setOpen(true)}
          data-testid="run"
        >
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: going ? "var(--sys-green)" : "var(--sys-gray)" }} />
          {/* Two lines on a phone, so the state is never what's cut off. */}
          <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:gap-1">
            <span className="shrink-0">
              <span className="font-medium">{going ? (run.state === "pausing" ? "Run, pausing" : "Run") : "Last run"}</span>
              {session && <span className="text-muted-foreground"> in {session.name}</span>}
              {label && <span className="text-muted-foreground"> ({label})</span>}
              <span className="hidden sm:inline">: </span>
            </span>
            <span className="min-w-0 truncate">{runNow(project, run)}</span>
          </span>
          {going && session && run.started_by !== run.machine_id && (
            <span className={cn("hidden shrink-0 text-xs sm:inline", gateUntil(session) ? "text-muted-foreground" : "text-[var(--orange-text)]")} data-testid="run-gate">
              {gateUntil(session) ? `remote control on until ${clock(gateUntil(session)!)}` : "remote control off"}
            </span>
          )}
          <span className="shrink-0 text-xs text-muted-foreground">
            {going ? `${run.done} of ${run.done + (run.task_id ? 1 : 0) + runQueue(project, run.label_id, run.task_id).length} done` : `${run.done} done`}
          </span>
        </button>
      )}
      {going ? (
        <>
          {run.state === "running" && (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => act(async () => (await setRunState(db, run, "pausing"), onChanged()))}>
              <Pause className="h-3.5 w-3.5" aria-hidden /> Pause after this task
            </Button>
          )}
          <Button size="sm" variant="ghost" className="gap-1 text-destructive hover:text-destructive" onClick={() => setStopping(true)}>
            <Square className="h-3.5 w-3.5" aria-hidden /> Stop now
          </Button>
          <Dialog open={stopping} onOpenChange={setStopping}>
            <DialogContent className="gap-4 sm:max-w-md">
              <DialogHeader className="text-left">
                <DialogTitle>Stop the run now?</DialogTitle>
                <DialogDescription>
                  {session?.name ?? "The session"} stops where it is, even partway through a task. Pause after this task lets it finish first.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" onClick={() => setStopping(false)}>
                  Keep going
                </Button>
                <Button variant="destructive" onClick={() => act(async () => (await setRunState(db, run, "stopped"), setStopping(false), onChanged()))}>
                  Stop now
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : (
        here.length > 0 && (
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setStarting(true)}>
            <Play className="h-3.5 w-3.5" aria-hidden /> Start a run
          </Button>
        )
      )}

      <Dialog open={starting} onOpenChange={setStarting}>
        <DialogContent className="gap-5 bg-muted sm:bg-background" onOpenAutoFocus={focusSheet}>
          <DialogHeader>
            <DialogTitle>Start a run</DialogTitle>
            <DialogDescription className="sr-only">A session works down To do on its own.</DialogDescription>
          </DialogHeader>
          <StartForm
            project={{ ...project, sessions: here }}
            onStart={(sessionId, labelId) =>
              act(async () => {
                const s = project.sessions.find((x) => x.id === sessionId)!;
                const lbl = project.labels.find((l) => l.id === labelId)?.name;
                // On the computer it runs on, as its owner: as that computer.
                const dev = await whenDev(db);
                if (dev && s.machine_id === dev.machine_id) {
                  await devAction(db, "/run", { action: "runs-start", project: project.name, session: s.name, label: lbl ?? "" });
                } else {
                  await startRun(db, project, s, labelId);
                }
                setStarting(false);
                onChanged();
              })
            }
          />
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:bg-background" onOpenAutoFocus={focusSheet}>
          {run && <RunSheet project={project} run={run} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StartForm({ project, onStart }: { project: ProjectData; onStart: (sessionId: string, labelId: string | null) => void }) {
  const [sessionId, setSessionId] = useState(project.sessions[0]?.id ?? "");
  const [labelId, setLabelId] = useState("");
  const chosen = project.sessions.find((s) => s.id === sessionId);
  const queue = runQueue(project, labelId || null);
  const { db } = useApp();
  const [dev] = useDev(db);
  // Started on its own computer, it needs no gate; from elsewhere, it does.
  const fromElsewhere = chosen && chosen.machine_id !== dev?.machine_id;
  return (
    <form
      className="grid gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (sessionId) onStart(sessionId, labelId || null);
      }}
    >
      <label className="grid gap-1">
        <span className="text-muted-foreground">Session</span>
        <select className="h-10 rounded-md border bg-background px-2" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          {project.sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} on {s.machine}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-muted-foreground">Only tasks labelled</span>
        <select className="h-10 rounded-md border bg-background px-2" value={labelId} onChange={(e) => setLabelId(e.target.value)}>
          <option value="">Any task</option>
          {project.labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      {/* What it'll do, before it starts. */}
      <div className="grid gap-1 rounded-lg border bg-background p-3" data-testid="start-summary">
        <p>
          {queue.length === 0
            ? "Nothing to do: To do is empty."
            : `${queue.length} task${queue.length === 1 ? "" : "s"} to do, starting with #${queue[0].number} ${queue[0].title}.`}
        </p>
        <p className="text-muted-foreground">
          {project.run_rules.trim() ? "It follows the Project's run rules." : "No run rules yet: set them in Project settings."}
        </p>
      </div>
      {chosen && fromElsewhere && (
        <p className={gateUntil(chosen) ? "text-muted-foreground" : "text-[var(--orange-text)]"} data-testid="start-gate">
          {gateWords(chosen)}
          {gateUntil(chosen) ? " The run stops when it closes." : " It won't start until it's opened there."}
        </p>
      )}
      <Button type="submit" disabled={!sessionId || queue.length === 0}>
        Start
      </Button>
    </form>
  );
}

/** The night so far: what it's on, its diary, and what's waiting on Joe. */
function RunSheet({ project, run }: { project: ProjectData; run: Run }) {
  const session = project.sessions.find((s) => s.id === run.session_id);
  const diary = project.handoffs.filter((h) => h.session_id === run.session_id && h.written_at >= run.started_at);
  const waiting = project.statuses.find((s) => s.name.toLowerCase().startsWith("waiting"));
  const waitingTasks = waiting ? project.tasks.filter((t) => t.status_id === waiting.id) : [];
  return (
    <>
      <DialogHeader>
        <DialogTitle>{active(run) ? "The run" : "The last run"}</DialogTitle>
        <DialogDescription>
          {session ? `In ${session.name} on ${session.machine}` : "Its session has ended"}, since {when(run.started_at)}. {run.done} done.
          {session && run.started_by !== run.machine_id && ` ${gateWords(session)}`}
        </DialogDescription>
      </DialogHeader>
      <Group title="Now">
        <Row className="py-2 text-sm">{runNow(project, run)}</Row>
      </Group>
      {active(run) && (
        <Group title="Up next">
          {runQueue(project, run.label_id, run.task_id).length === 0 && <Row className="text-sm text-muted-foreground">Nothing after this.</Row>}
          {runQueue(project, run.label_id, run.task_id).map((t) => (
            <Row key={t.id} className="py-2 text-sm">
              <span className="tabular-nums text-xs text-muted-foreground">#{t.number}</span> {t.title}
            </Row>
          ))}
        </Group>
      )}
      <Group title="Notes after each task">
        {diary.length === 0 && <Row className="text-sm text-muted-foreground">No notes yet.</Row>}
        {diary.map((n) => (
          <details key={n.id} className="px-4 py-2 text-sm">
            <summary className="cursor-pointer">
              <span className="tabular-nums text-xs">#{n.number}</span> {when(n.written_at)}
            </summary>
            <Markdown text={n.body} className="mt-2" />
          </details>
        ))}
      </Group>
      {waiting && (
        <Group title={waiting.name}>
          {waitingTasks.length === 0 && <Row className="text-sm text-muted-foreground">Nothing.</Row>}
          {waitingTasks.map((t) => (
            <Row key={t.id} className="py-2 text-sm">
              <span className="tabular-nums text-xs text-muted-foreground">#{t.number}</span> {t.title}
            </Row>
          ))}
        </Group>
      )}
    </>
  );
}
