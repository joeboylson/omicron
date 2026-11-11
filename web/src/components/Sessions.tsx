import { useEffect, useState } from "react";
import { AlertCircle, Copy, Repeat, Terminal } from "lucide-react";
import {
  giveSessionTasks,
  sayEvery,
  stopLoop,
  type ClaudeSession,
  type HandoffNote,
  type ProjectData,
  type SessionLoop,
} from "@/lib/data";
import { useApp } from "@/lib/app";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Row, bare } from "@/components/Grouped";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Group } from "@/components/Grouped";
import { cn } from "@/lib/utils";

const STATE_TEXT = { open: "open", closed: "closed", gone: "stopped" } as const;
const NOTE_STATE = { waiting: "waiting", picked_up: "picked up", replaced: "replaced", cancelled: "cancelled" } as const;

/** The Project's Claude sessions, open ones first. Tap one for its handoff notes. */
export function Sessions({ project, onChanged }: { project: ProjectData; onChanged: () => void }) {
  const { sessions, handoffs } = project;
  const [openId, setOpenId] = useState<string | null>(null);
  if (sessions.length === 0) return null;
  const order = { open: 0, closed: 1, gone: 2 };
  const sorted = [...sessions].sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
  const open = sessions.find((s) => s.id === openId) ?? null;
  return (
    <section aria-label="Claude sessions" className="flex items-center gap-2 overflow-x-auto px-[max(1rem,env(safe-area-inset-left))] pb-3 text-sm">
      <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <ul className="flex gap-2">
        {sorted.map((s) => (
          <li key={s.id} title={s.folder ? `${s.folder} on ${s.machine}` : s.machine}>
            <button type="button" className="flex min-h-11 items-center sm:min-h-0" onClick={() => setOpenId(s.id)}>
              <Badge
                variant={s.state === "open" ? "secondary" : "outline"}
                className={cn("cursor-pointer gap-1.5 whitespace-nowrap font-normal", s.state !== "open" && "text-muted-foreground")}
              >
                <span
                  aria-hidden
                  className={cn("h-1.5 w-1.5 rounded-full", s.state !== "open" && "border border-muted-foreground")}
                  style={s.state === "open" ? { background: "var(--sys-green)" } : undefined}
                />
                <span className="font-medium">{s.name}</span>
                {project.loops.some((l) => l.session_id === s.id) && (
                  <Repeat className="h-3 w-3 text-[var(--sys-blue)]" aria-label="looping" />
                )}
                <span className="text-muted-foreground">
                  <span className="font-mono text-[11px]">{s.machine}</span> · {STATE_TEXT[s.state]}
                </span>
              </Badge>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:bg-background" onOpenAutoFocus={(e) => e.preventDefault()}>
          {open && (
            <SessionNotes project={project} session={open} notes={handoffs.filter((h) => h.session_id === open.id)} onChanged={onChanged} />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function SessionNotes({
  project,
  session,
  notes,
  onChanged,
}: {
  project: ProjectData;
  session: ClaudeSession;
  notes: HandoffNote[];
  onChanged: () => void;
}) {
  const { db, act } = useApp();
  const done = new Set(project.statuses.filter((s) => s.is_done).map((s) => s.id));
  const tasks = project.tasks.filter((t) => t.assignee_session_id === session.id && !done.has(t.status_id));
  const others = project.sessions.filter((s) => s.id !== session.id && s.state === "open");
  const loop = project.loops.find((l) => l.session_id === session.id);
  const [copied, setCopied] = useState<number | null>(null);
  const copy = async (n: HandoffNote) => {
    // Pastes into any Claude session to continue from this note.
    await navigator.clipboard?.writeText(`omicron handoff show '${project.name}' ${n.number} --pickup`).catch(() => {});
    setCopied(n.number);
  };
  return (
    <>
      <DialogHeader className="text-left">
        <DialogTitle>{session.name}</DialogTitle>
        <DialogDescription>
          <span className="font-mono">{session.machine}</span>
          {session.folder && (
            <>
              {" · "}
              <span className="font-mono">{session.folder}</span>
            </>
          )}
          {" · "}
          {STATE_TEXT[session.state]}
        </DialogDescription>
      </DialogHeader>
      {session.state === "gone" && (
        <p role="status" className="-mt-2 text-sm text-muted-foreground" data-testid="gone-why">
          Stopped: {session.gone_why ?? "it stopped without saying"}.
        </p>
      )}
      {loop && <LoopGroup loop={loop} machine={session.machine} onChanged={onChanged} />}
      {tasks.length > 0 && (
        <Group
          title="Open tasks"
          note={
            session.state !== "gone"
              ? undefined
              : session.gone_why?.startsWith("it stopped without saying")
                ? "Dispatch can reopen it on its machine, or give them to someone else."
                : "A stopped session can't work on these. Give them to someone else."
          }
        >
          <ul aria-label="Open tasks" className="divide-y">
            {tasks.map((t) => (
              <li key={t.id} className="flex gap-2 px-4 py-3 text-[15px] sm:text-sm">
                <span className="font-mono text-muted-foreground">#{t.number}</span>
                <span className="flex-1">{t.title}</span>
              </li>
            ))}
          </ul>
          <Row>
            <Select
              value=""
              onValueChange={(v) => {
                const [kind, id] = v.split(":");
                act(() => giveSessionTasks(db, project, session, kind === "person" ? { person: id } : { session: id })).then(
                  (ok) => ok && onChanged(),
                );
              }}
            >
              <SelectTrigger aria-label={`Give ${session.name}'s open tasks to`} className={cn(bare, "px-0 text-[var(--sys-blue)]")}>
                <SelectValue placeholder={tasks.length === 1 ? "Give it to…" : `Give all ${tasks.length} to…`} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>People</SelectLabel>
                  {project.members.map((m) => (
                    <SelectItem key={m.id} value={`person:${m.id}`}>
                      {m.display_name}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {others.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Claude sessions</SelectLabel>
                    {others.map((o) => (
                      <SelectItem key={o.id} value={`session:${o.id}`}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </Row>
        </Group>
      )}
      <Group title="Handoff notes" note="A waiting note goes to the next conversation in the session's window after /clear.">
        {notes.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No notes yet. In the session: <span className="font-mono">omicron handoff write</span>
          </p>
        ) : (
          <ul aria-label="Handoff notes" className="divide-y">
            {notes.map((n) => (
              <li key={n.id} className="grid gap-1.5 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono">#{n.number}</span>
                  <Badge
                    variant="outline"
                    className={cn("font-normal", n.state === "waiting" && "border-transparent text-white")}
                    style={n.state === "waiting" ? { background: "var(--sys-orange)" } : undefined}
                  >
                    {NOTE_STATE[n.state]}
                  </Badge>
                  <time className="whitespace-nowrap font-mono" dateTime={n.written_at}>
                    {new Date(n.written_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </time>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-8 shrink-0 gap-1 px-2 text-xs"
                    aria-label="Copy pickup command"
                    onClick={() => copy(n)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {copied === n.number ? (
                      "Copied"
                    ) : (
                      <>
                        <span className="sm:hidden">Copy</span>
                        <span className="hidden sm:inline">Copy pickup command</span>
                      </>
                    )}
                  </Button>
                </div>
                <p className="line-clamp-6 whitespace-pre-wrap break-words text-[15px] sm:text-sm">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}

/** Re-render now and then, for times like "in 4 min". */
function useNow(everyMs = 15000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function inAbout(iso: string, now: number): string {
  const minutes = Math.round((new Date(iso).getTime() - now) / 60000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours} h`;
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** A session's running loop: what it types in, how often, until when, and Stop. */
function LoopGroup({ loop, machine, onChanged }: { loop: SessionLoop; machine: string; onChanged: () => void }) {
  const { db, act } = useApp();
  const now = useNow();
  const end =
    loop.times !== null
      ? `${loop.runs} of ${loop.times} runs done`
      : loop.until
        ? `until ${new Date(loop.until).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${loop.runs} run${loop.runs === 1 ? "" : "s"} so far`
        : `until stopped · ${loop.runs} run${loop.runs === 1 ? "" : "s"} so far`;
  return (
    <Group title="Loop" note={`${machine} types this in when it's due and the session has finished its turn.`}>
      <div className="grid gap-1.5 px-4 py-3" data-testid="loop">
        <p className="flex items-center gap-2 text-[15px] sm:text-sm">
          <Repeat className="h-4 w-4 shrink-0 text-[var(--sys-blue)]" aria-hidden />
          <span className="font-mono">every {sayEvery(loop.every_seconds)}</span>
          <span className="text-muted-foreground">· {end}</span>
        </p>
        <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-[15px] sm:text-sm">{loop.prompt}</blockquote>
        <p className="text-sm text-muted-foreground">
          Next run {inAbout(loop.next_run_at, now)}
          {loop.last_run_at && <> · last {new Date(loop.last_run_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</>}
        </p>
        {loop.note && (
          <p role="status" className="flex items-start gap-1.5 text-sm">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sys-orange)]" aria-hidden />
            <span>{loop.note[0].toUpperCase() + loop.note.slice(1)}.</span>
          </p>
        )}
      </div>
      <Row>
        <Button
          variant="ghost"
          className="-ml-3 text-destructive hover:text-destructive"
          onClick={() => act(() => stopLoop(db, loop)).then((ok) => ok && onChanged())}
        >
          Stop loop
        </Button>
      </Row>
    </Group>
  );
}
