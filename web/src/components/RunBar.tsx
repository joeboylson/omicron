import { useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import { useApp } from "@/lib/app";
import { devAction, useDev, whenDev } from "@/lib/dev";
import { setRunState, startRun, type ClaudeSession, type ProjectData, type Run } from "@/lib/data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/base/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { Group, Row } from "@/components/Grouped";

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

/** "studio's gate is open until 7:00 AM." or "… is closed." */
function gateWords(s: ClaudeSession): string {
  const until = gateUntil(s);
  return until ? `${s.machine}'s gate is open until ${clock(until)}.` : `${s.machine}'s gate is closed.`;
}

export function RunBar({ project, onChanged }: { project: ProjectData; onChanged: () => void }) {
  const { db, act } = useApp();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const run = project.runs.find(active) ?? project.runs[0] ?? null;
  const session = run && project.sessions.find((s) => s.id === run.session_id);
  if (!run && project.sessions.length === 0) return null;
  const going = run !== null && active(run);
  const label = run?.label_id ? project.labels.find((l) => l.id === run.label_id)?.name : null;

  return (
    <section aria-label="Run" className="flex flex-wrap items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pb-2 text-sm">
      {run && (
        <button
          type="button"
          className="flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-card px-3 py-1.5 text-left"
          onClick={() => setOpen(true)}
          data-testid="run"
        >
          <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: going ? "var(--sys-green)" : "var(--sys-gray)" }} />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{going ? (run.state === "pausing" ? "Run, pausing" : "Run") : "Last run"}</span>
            {session && <span className="text-muted-foreground"> in {session.name}</span>}
            {label && <span className="text-muted-foreground"> ({label})</span>}: {run.note ?? run.state}
          </span>
          {going && session && run.started_by !== run.machine_id && (
            <span className={cn("hidden shrink-0 text-xs sm:inline", gateUntil(session) ? "text-muted-foreground" : "text-[var(--sys-orange)]")} data-testid="run-gate">
              {gateUntil(session) ? `gate open until ${clock(gateUntil(session)!)}` : "gate closed"}
            </span>
          )}
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{run.done} done</span>
        </button>
      )}
      {going ? (
        <>
          {run.state === "running" && (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => act(async () => (await setRunState(db, run, "pausing"), onChanged()))}>
              <Pause className="h-3.5 w-3.5" aria-hidden /> Pause
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1" onClick={() => act(async () => (await setRunState(db, run, "stopped"), onChanged()))}>
            <Square className="h-3.5 w-3.5" aria-hidden /> Stop
          </Button>
        </>
      ) : (
        project.sessions.length > 0 && (
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setStarting(true)}>
            <Play className="h-3.5 w-3.5" aria-hidden /> Start a run
          </Button>
        )
      )}

      <Dialog open={starting} onOpenChange={setStarting}>
        <DialogContent className="gap-5 bg-muted sm:bg-background" onOpenAutoFocus={focusSheet}>
          <DialogHeader>
            <DialogTitle>Start a run</DialogTitle>
            <DialogDescription>
              A session works down To do on its own, one task at a time, following the Project's run rules, until To do is empty. Between tasks it hands
              off and starts fresh.
            </DialogDescription>
          </DialogHeader>
          <StartForm
            project={project}
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
          <p className="text-xs text-muted-foreground">
            From anywhere but the session's own computer, it only starts if you own that computer and its gate is open.
          </p>
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
      {chosen && fromElsewhere && (
        <p className={gateUntil(chosen) ? "text-muted-foreground" : "text-[var(--sys-orange)]"} data-testid="start-gate">
          {gateWords(chosen)}
          {gateUntil(chosen) ? " The run stops when it closes." : " It won't start until it's opened there."}
        </p>
      )}
      <Button type="submit" disabled={!sessionId}>
        Start
      </Button>
    </form>
  );
}

/** The night so far: what it's on, its diary, and what's waiting on Joe. */
function RunSheet({ project, run }: { project: ProjectData; run: Run }) {
  const session = project.sessions.find((s) => s.id === run.session_id);
  const task = project.tasks.find((t) => t.id === run.task_id);
  const diary = project.handoffs.filter((h) => h.session_id === run.session_id && h.written_at >= run.started_at);
  const waiting = project.statuses.find((s) => s.name.toLowerCase().startsWith("waiting"));
  const waitingTasks = waiting ? project.tasks.filter((t) => t.status_id === waiting.id) : [];
  return (
    <>
      <DialogHeader>
        <DialogTitle>{active(run) ? "The run" : "The last run"}</DialogTitle>
        <DialogDescription>
          {session ? `In ${session.name} on ${session.machine}` : "Its session has ended"}, since {when(run.started_at)}. {run.done} done.
          {session && run.started_by !== run.machine_id && ` ${gateWords(session)} Started from elsewhere, it stops when the gate closes.`}
        </DialogDescription>
      </DialogHeader>
      <Group title="Now">
        <Row className="py-2 text-sm">{task ? `#${task.number} ${task.title}` : (run.note ?? run.state)}</Row>
      </Group>
      <Group title="Diary" note="The session's handoff notes, one each time it finished a task and started fresh.">
        {diary.length === 0 && <Row className="text-sm text-muted-foreground">No notes yet.</Row>}
        {diary.map((n) => (
          <details key={n.id} className="px-4 py-2 text-sm">
            <summary className="cursor-pointer">
              <span className="font-mono text-xs">#{n.number}</span> {when(n.written_at)}
            </summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono text-xs">{n.body}</pre>
          </details>
        ))}
      </Group>
      {waiting && (
        <Group title={waiting.name}>
          {waitingTasks.length === 0 && <Row className="text-sm text-muted-foreground">Nothing.</Row>}
          {waitingTasks.map((t) => (
            <Row key={t.id} className="py-2 text-sm">
              <span className="font-mono text-xs text-muted-foreground">#{t.number}</span> {t.title}
            </Row>
          ))}
        </Group>
      )}
    </>
  );
}
