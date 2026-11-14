import { useEffect, useState } from "react";
import { AlertCircle, Copy, Repeat, Terminal } from "lucide-react";
import {
  giveSessionTasks,
  updateTask,
  sayEvery,
  stopLoop,
  type ClaudeSession,
  type HandoffNote,
  type ProjectData,
  type SessionLoop,
} from "@/lib/data";
import { useApp } from "@/lib/app";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/base/select";
import { Row, bare } from "@/components/Grouped";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/base/button";
import { Markdown } from "@/components/Markdown";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { Group } from "@/components/Grouped";
import { cn } from "@/lib/utils";

const NOTE_STATE = {
  waiting: "Not picked up yet",
  picked_up: "Picked up",
  replaced: "Replaced by a newer note",
  cancelled: "Cancelled",
} as const;

/** A folder's last part, like "omicron" for /Users/joe/omicron. */
function folderName(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || path;
}

/**
 * The Project's Claude sessions: only ones running now (a session's record
 * goes when it ends). Tap one for its handoff notes.
 */
export function Sessions({
  project,
  onChanged,
  onOpenTask,
  inSheet = false,
}: {
  project: ProjectData;
  onChanged: () => void;
  onOpenTask?: (number: number) => void;
  /** Shown in a sheet (on a phone): wrapped, not a strip. */
  inSheet?: boolean;
}) {
  const { sessions, handoffs } = project;
  const [openId, setOpenId] = useState<string | null>(null);
  if (sessions.length === 0) return null;
  const sorted = [...sessions].sort((a, b) => a.name.localeCompare(b.name));
  const open = sessions.find((s) => s.id === openId) ?? null;
  return (
    <section
      aria-label="Claude sessions"
      className={cn("flex items-center gap-2 text-sm", inSheet ? "" : "overflow-x-auto px-[max(1rem,env(safe-area-inset-left))] pb-3")}
    >
      {!inSheet && <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
      <ul className={cn("flex gap-2", inSheet && "flex-wrap")}>
        {sorted.map((s) => (
          <li key={s.id} title={s.folder ? `${s.folder} on ${s.machine}` : s.machine}>
            <button type="button" className="flex min-h-11 items-center sm:min-h-0" onClick={() => setOpenId(s.id)}>
              <Badge variant="secondary" className="cursor-pointer gap-1.5 whitespace-nowrap font-normal">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--sys-green)" }} />
                <span className="font-medium">{s.name}</span>
                {project.loops.some((l) => l.session_id === s.id) && (
                  <Repeat className="h-3 w-3 text-[var(--sys-blue)]" aria-label="looping" />
                )}
                <span className="text-muted-foreground">
                  <span className="font-mono text-[11px]">{s.machine}</span>
                </span>
              </Badge>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:bg-background" onOpenAutoFocus={focusSheet}>
          {open && (
            <SessionNotes
              project={project}
              session={open}
              notes={handoffs.filter((h) => h.session_id === open.id)}
              onChanged={onChanged}
              onOpenTask={
                onOpenTask &&
                ((n) => {
                  // This sheet closes; the task's opens.
                  setOpenId(null);
                  setTimeout(() => onOpenTask(n), 0);
                })
              }
            />
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
  onOpenTask,
}: {
  project: ProjectData;
  session: ClaudeSession;
  notes: HandoffNote[];
  onChanged: () => void;
  onOpenTask?: (number: number) => void;
}) {
  const { db, act } = useApp();
  const done = new Set(project.statuses.filter((s) => s.is_done).map((s) => s.id));
  const tasks = project.tasks.filter((t) => t.assignee_session_id === session.id && !done.has(t.status_id));
  const others = project.sessions.filter((s) => s.id !== session.id);
  const loop = project.loops.find((l) => l.session_id === session.id);
  // A line on what it's doing: the task it took, or the one it's waiting to take.
  const taken = tasks.find((t) => t.picked_up_at);
  const doing = taken
    ? `Working on #${taken.number} ${taken.title} · ${since(taken.picked_up_at!)}`
    : tasks.length > 0
      ? `#${tasks[0].number} ${tasks[0].title} is waiting for it`
      : "Nothing given to it";
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
          {/* What it's doing first; where it is after, the folder by its short name. */}
          <span className="block text-foreground" data-testid="session-doing">
            {doing}
          </span>
          <span>
            on <span className="font-mono">{session.machine}</span>
            {session.folder && (
              <>
                {" in "}
                <span className="font-mono" title={session.folder}>
                  {folderName(session.folder)}
                </span>
              </>
            )}
          </span>
        </DialogDescription>
      </DialogHeader>
      {loop && <LoopGroup loop={loop} onChanged={onChanged} />}
      {tasks.length > 0 && (
        <Group title="Open tasks">
          <ul aria-label="Open tasks" className="divide-y">
            {tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-4 py-1.5 text-[15px] sm:text-sm">
                {/* The row opens the task; Give to… hands just this one over. */}
                <button
                  type="button"
                  className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left hover:underline disabled:no-underline"
                  disabled={!onOpenTask}
                  onClick={() => onOpenTask?.(t.number)}
                >
                  <span className="font-mono text-muted-foreground">#{t.number}</span>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                </button>
                <GiveTo
                  label={`Give #${t.number} to`}
                  text="Give to…"
                  project={project}
                  others={others}
                  onPick={(to) => act(() => updateTask(db, project, t, { assignee_person_id: to.person ?? null, assignee_session_id: to.session ?? null })).then((ok) => ok && onChanged())}
                />
              </li>
            ))}
          </ul>
          {tasks.length > 1 && (
            <Row>
              <GiveTo
                label={`Give ${session.name}'s open tasks to`}
                text={`Give all ${tasks.length} open tasks to…`}
                project={project}
                others={others}
                onPick={(to) => act(() => giveSessionTasks(db, project, session, to)).then((ok) => ok && onChanged())}
              />
            </Row>
          )}
        </Group>
      )}
      <Group title="Handoff notes">
        {notes.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No notes yet. In the session: <span className="font-mono">omicron handoff write</span>
          </p>
        ) : (
          <ul aria-label="Handoff notes" className="divide-y">
            {notes.map((n) => (
              <li key={n.id} className="grid gap-1.5 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:flex-nowrap">
                  <span className="whitespace-nowrap font-mono">#{n.number}</span>
                  <Badge
                    variant="outline"
                    className={cn("whitespace-nowrap font-normal", n.state === "waiting" && "border-transparent text-white")}
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
                <Markdown text={n.body} className="line-clamp-[12] text-[15px] sm:text-sm" />
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
function LoopGroup({ loop, onChanged }: { loop: SessionLoop; onChanged: () => void }) {
  const { db, act } = useApp();
  const now = useNow();
  const end =
    loop.times !== null
      ? `${loop.runs} of ${loop.times} runs done`
      : loop.until
        ? `until ${new Date(loop.until).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${loop.runs} run${loop.runs === 1 ? "" : "s"} so far`
        : `until stopped · ${loop.runs} run${loop.runs === 1 ? "" : "s"} so far`;
  return (
    <Group title="Loop">
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

/** How long since, in a few words: "just now", "4 min", "2 h". */
function since(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min`;
  return `${Math.round(min / 60)} h`;
}

/** A "Give to…" picker: a person in the Project, or another Claude session. */
function GiveTo({
  label,
  text,
  project,
  others,
  onPick,
}: {
  label: string;
  text: string;
  project: ProjectData;
  others: ClaudeSession[];
  onPick: (to: { person?: string; session?: string }) => void;
}) {
  return (
    <Select
      value=""
      onValueChange={(v) => {
        const [kind, id] = v.split(":");
        onPick(kind === "person" ? { person: id } : { session: id });
      }}
    >
      <SelectTrigger aria-label={label} className={cn(bare, "w-auto shrink-0 gap-1 px-0 text-link")}>
        <SelectValue placeholder={text} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel className="text-xs font-normal text-muted-foreground">People</SelectLabel>
          {project.members.map((m) => (
            <SelectItem key={m.id} value={`person:${m.id}`}>
              {m.display_name}
            </SelectItem>
          ))}
        </SelectGroup>
        {others.length > 0 && (
          <SelectGroup>
            <SelectLabel className="text-xs font-normal text-muted-foreground">Claude sessions</SelectLabel>
            {others.map((o) => (
              <SelectItem key={o.id} value={`session:${o.id}`}>
                {o.name}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
      </SelectContent>
    </Select>
  );
}
