import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { formatDate } from "@/components/TaskCard";
import { ArrowRight } from "lucide-react";
import { AlertCircle, Check, CheckCircle2, ChevronDown, Loader2, MoreHorizontal, Plus, Send, Terminal, Trash2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useApp } from "@/lib/app";
import { useAwakeMachines } from "@/lib/awake";
import {
  addChecklistItem,
  addLabel,
  deleteChecklistItem,
  giveUpDispatch,
  requestDispatch,
  linkJob,
  listProjectJobs,
  setLabel,
  unlinkJob,
  type JobLink,
  tickChecklistItem,
  updateTask,
  type ProjectData,
  type Task,
} from "@/lib/data";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/base/select";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { statusColor, type Color } from "@/lib/colors";
import { ColorDot } from "@/components/ColorDot";
import { LabelBadge, NeedsReview } from "@/components/TaskCard";
import { Comments } from "@/components/Comments";

const NOBODY = "nobody";
/** Given to: a session that has ended (shown, not chosen). */
const ENDED = "ended";

export function TaskDialog({
  project,
  task,
  onClose,
  onClosed,
  onChanged,
  onDelete,
  onPatch,
  focusNotes = false,
}: {
  project: ProjectData;
  task: Task | null;
  /** Opened right after adding it: straight into its notes. */
  focusNotes?: boolean;
  onClose: () => void;
  /** Once it has finished closing: where focus goes next is up to the page. */
  onClosed?: () => void;
  onChanged: () => void;
  /** Delete it (the page keeps an Undo for a few seconds). */
  onDelete: (task: Task) => void;
  /** Show a change at once, before it's saved. */
  /** Show a change at once; returns what to call once its save is done. */
  onPatch: (taskId: string, change: Partial<Task>) => () => void;
}) {
  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:max-w-xl sm:bg-background"
        // Focus the sheet itself, not the title: on a phone a focused title
        // opens the keyboard. Keyboard and screen-reader users start inside.
        onOpenAutoFocus={(e) => {
          const notes = focusNotes ? document.getElementById("task-notes") : null;
          if (notes) {
            e.preventDefault();
            notes.focus();
          } else focusSheet(e);
        }}
        // The board puts focus back on the task's card itself, once the
        // sheet is gone (while it closes, it still holds focus).
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed?.();
        }}
      >
        {task && <TaskForm key={task.id} project={project} task={task} onChanged={onChanged} onDelete={onDelete} onPatch={onPatch} />}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  project,
  task,
  onChanged,
  onDelete,
  onPatch,
}: {
  project: ProjectData;
  task: Task;
  onChanged: () => void;
  onDelete: (task: Task) => void;
  /** Show a change at once; returns what to call once its save is done. */
  onPatch: (taskId: string, change: Partial<Task>) => () => void;
}) {
  const { db, act } = useApp();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [newItem, setNewItem] = useState("");
  // Ticks show straight away, before the save comes back.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  // Once a reload shows the saved value, stop showing our own. A reload
  // that lands before the save keeps it, so the box doesn't flicker back.
  useEffect(
    () =>
      setTicked((t) => {
        const left = Object.fromEntries(
          Object.entries(t).filter(([id, done]) => task.checklist.some((c) => c.id === id && c.done !== done)),
        );
        return Object.keys(left).length === Object.keys(t).length ? t : left;
      }),
    [task.checklist],
  );

  // Someone else changed it while it's open: show their version, unless
  // this field is being typed in.
  useEffect(() => {
    if (document.activeElement?.id !== "task-title") setTitle(task.title);
  }, [task.title]);
  useEffect(() => {
    if (document.activeElement?.id !== "task-notes") setNotes(task.notes);
  }, [task.notes]);

  const change = async (work: () => Promise<unknown>) => {
    if (await act(work)) onChanged();
  };
  // Shows at once (the page updates its copy), then saves; a failure says
  // so and the reload puts it back.
  // Saves go one after another, in the order made: two quick changes to
  // one field (a date picked, then another) can't land the wrong way round.
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  // Given to's list, opened from the ended-session warning too.
  const [pickingWho, setPickingWho] = useState(false);
  const ended = !task.assignee_session_id && !task.assignee_person_id ? task.ended_session : null;
  const save = (c: Parameters<typeof updateTask>[3]) => {
    const done = onPatch(task.id, c);
    const next = saving.current
      .then(() => act(() => updateTask(db, project, task, c)))
      .finally(() => {
        done();
        onChanged();
      });
    saving.current = next.catch(() => {});
    return next;
  };

  const done = project.statuses.find((s) => s.is_done);
  const isDone = done?.id === task.status_id;

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2 pr-8">
          <DialogDescription className="flex-1 text-left">
            <span className="font-mono">#{task.number}</span> in {project.name}
          </DialogDescription>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="More for this task">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {done && !isDone && (
                <DropdownMenuItem onSelect={() => save({ status_id: done.id })}>
                  <Check /> Mark done
                </DropdownMenuItem>
              )}
              {/* Moving without dragging (by keyboard, or on a small screen). */}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowRight /> Move to
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {project.statuses.map((st) => (
                    <DropdownMenuItem key={st.id} disabled={st.id === task.status_id} onSelect={() => save({ status_id: st.id })}>
                      <ColorDot color={statusColor(st)} /> {st.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(task)}>
                <Trash2 /> Delete task
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <DialogTitle className="sr-only">{task.title}</DialogTitle>
        <Textarea
          id="task-title"
          aria-label="Title"
          rows={1}
          value={title}
          // One line, wrapped to fit: Enter is done, not a new line.
          onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
          onBlur={() => {
            const t = title.trim();
            if (!t) setTitle(task.title);
            else if (t !== task.title) save({ title: t });
          }}
          className="min-h-0 w-full resize-none border-transparent bg-transparent px-0 py-1 [overflow-wrap:anywhere] text-xl font-semibold leading-snug shadow-none [field-sizing:content] focus-visible:border-input focus-visible:bg-background focus-visible:px-3 focus-visible:ring-0 focus-visible:ring-offset-0 md:text-xl"
        />
      </DialogHeader>

      {task.needs_review && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-sm" data-testid="needs-review">
          <NeedsReview />
          <span className="min-w-[12rem] flex-1 text-muted-foreground">A Claude session asked for this to be checked.</span>
          <Button size="sm" variant="outline" onClick={() => save({ needs_review: false })}>
            <Check /> Reviewed
          </Button>
        </div>
      )}

      <Group label="Details">
        <Row>
          <Label htmlFor="task-status" className="flex-1 font-normal">
            Status
          </Label>
          <Select value={task.status_id} onValueChange={(v) => save({ status_id: v })}>
            <SelectTrigger id="task-status" className={cn(bare, "w-auto gap-1 text-muted-foreground")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {project.statuses.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  <span className="flex items-center gap-2">
                    <ColorDot color={statusColor(s)} />
                    {s.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
        {project.topics.length > 0 && (
          <Row>
            <Label htmlFor="task-topic" className="flex-1 font-normal">
              Topic
            </Label>
            <Select value={task.topic_id ?? NOBODY} onValueChange={(v) => save({ topic_id: v === NOBODY ? null : v })}>
              <SelectTrigger id="task-topic" className={cn(bare, "w-auto gap-1 text-muted-foreground")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value={NOBODY}>None</SelectItem>
                {project.topics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
        )}
        <Row>
          <Label htmlFor="task-date" className="flex-1 font-normal">
            Date
          </Label>
          <DateField id="task-date" value={task.due_on} onChange={(due_on) => save({ due_on })} />
        </Row>
        <Row>
          <Label htmlFor="task-assignee" className="flex-1 font-normal">
            Given to
          </Label>
          <Select
            open={pickingWho}
            onOpenChange={setPickingWho}
            value={
              task.assignee_session_id
                ? `session:${task.assignee_session_id}`
                : task.assignee_person_id
                  ? `person:${task.assignee_person_id}`
                  : ended
                    ? ENDED
                    : NOBODY
            }
            onValueChange={(v) => {
              if (v === ENDED) return;
              const [kind, id] = v.split(":");
              save({
                assignee_person_id: kind === "person" ? id : null,
                assignee_session_id: kind === "session" ? id : null,
              });
            }}
          >
            <SelectTrigger id="task-assignee" className={cn(bare, "w-auto gap-1 text-muted-foreground")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {/* As on its card: still shown as its ended session's, until given out. */}
              {ended && (
                <SelectItem value={ENDED} disabled className="hidden">
                  <span className="flex items-center gap-1.5 text-[var(--sys-orange)]">
                    <AlertCircle className="h-4 w-4" aria-hidden /> {ended} (ended)
                  </span>
                </SelectItem>
              )}
              <SelectItem value={NOBODY}>Nobody</SelectItem>
              <SelectGroup>
                <SelectLabel>People</SelectLabel>
                {project.members.map((m) => (
                  <SelectItem key={m.id} value={`person:${m.id}`}>
                    {m.display_name}
                  </SelectItem>
                ))}
              </SelectGroup>
              {project.sessions.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Claude sessions</SelectLabel>
                  {project.sessions.map((c) => (
                    <SelectItem key={c.id} value={`session:${c.id}`}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </Row>
        {task.assignee_session_id && <DispatchRow project={project} task={task} onChanged={onChanged} />}
        {!task.assignee_session_id && !task.assignee_person_id && task.ended_session && (
          <Row className="text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4 shrink-0 text-[var(--sys-orange)]" aria-hidden />
            <span data-testid="ended-session" className="flex-1">
              {task.ended_session} has ended.
            </span>
            <Button variant="ghost" size="sm" className="h-8 shrink-0 text-link" onClick={() => setPickingWho(true)}>
              Give to…
            </Button>
          </Row>
        )}
      </Group>

      <TeamJobs project={project} task={task} onChanged={onChanged} />

      <Group title="Labels">
        <Row className="flex-wrap gap-1.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Labels">
            {/* Only the task's own labels, each with ×; the rest are in Add label (like Trello). */}
            {project.labels
              .filter((l) => task.labelIds.includes(l.id))
              .map((l) => (
                <span key={l.id} className="flex min-h-9 items-center gap-0.5">
                  <LabelBadge name={l.name} color={l.color as Color | null} />
                  <button
                    type="button"
                    aria-label={`Take off ${l.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => change(() => setLabel(db, task, l.id, false))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            <AddLabel
              labels={project.labels.filter((l) => !task.labelIds.includes(l.id))}
              onPick={(id) => change(() => setLabel(db, task, id, true))}
              onCreate={(name) => {
                const existing = project.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
                change(async () => setLabel(db, task, existing?.id ?? (await addLabel(db, project.id, name)), true));
              }}
            />
          </div>
        </Row>
      </Group>

      <Group
        title={
          <label htmlFor="task-notes">
            {task.question ? `${task.question.worker} in ${task.question.team} asks` : "Notes"}
          </label>
        }
        className={task.question?.open ? "[&>div]:border-[var(--sys-blue)]" : undefined}
      >
        <Textarea
          id="task-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== task.notes && save({ notes })}
          rows={4}
          placeholder="Add notes"
          className="rounded-none border-0 bg-transparent px-4 focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      </Group>

      <Group
        label="Checklist"
        title={
          <>
            Checklist
            {task.checklist.length > 0 && (
              <span className="ml-2 font-mono normal-case">
                {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
              </span>
            )}
          </>
        }
      >
        <ul aria-label="Checklist" className={cn("divide-y", task.checklist.length === 0 && "hidden")}>
          {task.checklist.map((item) => (
            <li key={item.id}>
              <Row>
                <Checkbox
                  id={`item-${item.id}`}
                  className="h-5 w-5 rounded-full"
                  checked={ticked[item.id] ?? item.done}
                  onCheckedChange={(v) => {
                    setTicked((t) => ({ ...t, [item.id]: v === true }));
                    change(() => tickChecklistItem(db, item, v === true));
                  }}
                />
                <label
                  htmlFor={`item-${item.id}`}
                  className={cn("flex-1 py-2 text-[15px] sm:text-sm", (ticked[item.id] ?? item.done) && "text-muted-foreground line-through")}
                >
                  {item.text}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${item.text}`}
                  className="-mr-2 text-muted-foreground"
                  onClick={() => change(() => deleteChecklistItem(db, item))}
                >
                  <X />
                </Button>
              </Row>
            </li>
          ))}
        </ul>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const text = newItem.trim();
            if (text) change(async () => (await addChecklistItem(db, task, text), setNewItem("")));
          }}
        >
          <Row>
            <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="Add an item"
              aria-label="New checklist item"
              className={cn(bare, "px-0")}
            />
            <Button type="submit" variant="ghost" size="sm" aria-label="Add item" disabled={!newItem.trim()}>
              Add
            </Button>
          </Row>
        </form>
      </Group>

      <Comments project={project} task={task} change={change} when={when} />

    </>
  );
}

/** "now", "5m", "3h", "2d", then the date. */
function when(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h`;
  if (minutes < 60 * 24 * 7) return `${Math.round(minutes / 1440)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Whether the session has the task, and the Dispatch button: hands it to the
 * session now, on its machine (in its window, or when it's next opened). The
 * outcome of the latest Dispatch shows under it, for everyone, live.
 */
function DispatchRow({ project, task, onChanged }: { project: ProjectData; task: Task; onChanged: () => void }) {
  const { db, act } = useApp();
  const awake = useAwakeMachines(db);
  const [asking, setAsking] = useState(false);
  const session = project.sessions.find((s) => s.id === task.assignee_session_id);
  const latest = task.dispatches[0];
  // A request nobody took by the time the database allows (claim_by), or
  // one a machine took but never finished: over, whatever its state says;
  // give up on it. Drawn again at claim_by, so this is seen in time.
  const [, redraw] = useState(0);
  useEffect(() => {
    if (latest?.state !== "pending") return;
    const wait = new Date(latest.claim_by).getTime() - Date.now() + 1000;
    if (wait <= 0) return;
    const t = window.setTimeout(() => redraw((n) => n + 1), wait);
    return () => window.clearTimeout(t);
  }, [latest?.id, latest?.state, latest?.claim_by]);
  const stale =
    !!latest &&
    ((latest.state === "pending" && Date.now() > new Date(latest.claim_by).getTime()) ||
      (latest.state === "claimed" && !!latest.claimed_at && Date.now() - new Date(latest.claimed_at).getTime() > 125_000));
  useEffect(() => {
    if (!stale || !latest) return;
    const why =
      latest.state === "pending" ? `${session?.machine ?? "Its machine"} didn't pick it up in time. Is Omicron running on it?` : "Its machine took it but never said how it went.";
    giveUpDispatch(db, latest.id, why).catch(() => {}).finally(onChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, latest?.id]);
  const working = asking || (!stale && (latest?.state === "pending" || latest?.state === "claimed"));
  const asleep = !!session && awake !== null && !awake.has(session.machine_id);

  async function dispatch() {
    if (!session) return;
    setAsking(true);
    // If the machine doesn't take it in time, it's given up once its time
    // is past (above), or by the next Dispatch of the task (the database).
    const asked = await act(async () => {
      await requestDispatch(db, task);
      onChanged();
    });
    setAsking(false);
    if (!asked) onChanged();
  }

  // One line: where the task is with its session, and why Dispatch is off.
  const name = session?.name ?? "its session";
  const machine = session?.machine ?? "its computer";
  const failed = !working && !task.picked_up_at && latest?.state === "failed";
  const line = working
    ? latest?.state === "claimed"
      ? `${machine} is handing it to ${name}…`
      : `Sending it to ${name} on ${machine}…`
    : failed
      ? latest!.error ?? "It couldn't be sent."
      : task.picked_up_at
        ? `${name} has it.`
        : latest?.state === "done"
          ? (latest.result ?? `Sent to ${name}.`)
          : `${name} gets it when it next looks for tasks.`;
  // When the last send happened, beside what it said.
  const at = !working && !task.picked_up_at && latest && (latest.state === "done" || failed) ? latest.created_at : null;
  const off = asleep && !working && !task.picked_up_at ? ` ${machine} is off, so it can't be sent now.` : "";

  return (
    <Row className="text-sm">
      {failed ? (
        <AlertCircle className="h-4 w-4 shrink-0 text-[var(--sys-red)]" aria-hidden />
      ) : task.picked_up_at ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--sys-green)]" aria-hidden />
      ) : (
        <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span role="status" aria-live="polite" data-testid="dispatch" className={cn("flex-1", !failed && "text-muted-foreground")}>
        {line}
        {at && (
          <time dateTime={at} title={new Date(at).toLocaleString()} className="ml-1.5 font-mono text-xs text-muted-foreground">
            {when(at)}
          </time>
        )}
        {off}
      </span>
      {!task.picked_up_at && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!session || working || asleep}
          onClick={dispatch}
          title={`Hand it to ${name} now, on ${machine}`}
        >
          {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {working ? "Sending" : latest?.state === "done" || failed ? "Send again" : "Send now"}
        </Button>
      )}
    </Row>
  );
}

const JOB_STATE: Record<string, string> = {
  waiting: "waiting",
  working: "working",
  blocked: "blocked",
  done: "done",
  cancelled: "cancelled",
};

/**
 * Team jobs the task is linked to (the session handles the task; the team
 * handles the jobs), with each job's state, live. Shown when the Project
 * has any team jobs.
 */
function TeamJobs({ project, task, onChanged }: { project: ProjectData; task: Task; onChanged: () => void }) {
  const { db, act } = useApp();
  const [all, setAll] = useState<JobLink[] | null>(null);
  useEffect(() => {
    listProjectJobs(db, project.id).then(setAll, () => setAll([]));
  }, [db, project.id, task.jobs.length]);
  if (all === null || (all.length === 0 && task.jobs.length === 0)) return null;
  const linked = new Set(task.jobs.map((j) => j.id));
  const free = all.filter((j) => !linked.has(j.id) && j.state !== "cancelled");
  const change = (work: () => Promise<unknown>) => act(work).then((ok) => ok && onChanged());
  return (
    <Group title="Team jobs">
      {task.jobs.length > 0 && (
        <ul aria-label="Linked jobs" className="divide-y">
          {task.jobs.map((j) => (
            <li key={j.id} className="flex items-center gap-2 px-4 py-2.5 text-[15px] sm:text-sm">
              <span className="font-mono text-xs text-muted-foreground">
                {j.team} #{j.number}
              </span>
              <span className="flex-1 truncate">{j.title}</span>
              <Badge variant={j.state === "done" ? "secondary" : "outline"} className="font-normal">
                {JOB_STATE[j.state] ?? j.state}
                {j.step && j.state === "working" ? ` · ${j.step}` : ""}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-2 h-8 w-8 text-muted-foreground"
                aria-label={`Unlink ${j.team} job #${j.number}`}
                onClick={() => change(() => unlinkJob(db, task, j.id))}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {free.length > 0 && (
        <Row>
          <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
          <Select value="" onValueChange={(id) => change(() => linkJob(db, task, id))}>
            <SelectTrigger aria-label="Link a team job" className={cn(bare, "px-0 text-muted-foreground")}>
              <SelectValue placeholder="Link a team job…" />
            </SelectTrigger>
            <SelectContent>
              {free.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.team} #{j.number} {j.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Row>
      )}
    </Group>
  );
}

/** A day as YYYY-MM-DD, in local time. */
function dayISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The task's date: shown as on its card (Nov 15), with quick picks, any
 *  day, and Clear (like Reminders and Things). */
export function DateField({
  id,
  value,
  onChange,
  none = "None",
  className,
}: {
  id?: string;
  value: string | null;
  onChange: (v: string | null) => void;
  /** Shown when there's no date. */
  none?: string;
  /** For the button that opens it, in place of a sheet row's plain style. */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };
  const inDays = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return dayISO(d);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="ghost" className={className ?? cn(bare, "w-auto gap-1 pl-0 pr-3 font-normal text-muted-foreground hover:bg-transparent")}>
          {value ? formatDate(value) : none}
          <ChevronDown className="h-4 w-4 opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-60 gap-1 p-2">
        {(
          [
            ["Today", 0],
            ["Tomorrow", 1],
            ["Next week", 7],
          ] as const
        ).map(([label, n]) => (
          <Button key={label} variant="ghost" className="justify-between font-normal" onClick={() => pick(inDays(n))}>
            {label}
            <span className="text-xs text-muted-foreground">{formatDate(inDays(n))}</span>
          </Button>
        ))}
        <label className="grid gap-1 px-1 pt-1 text-xs text-muted-foreground">
          Another day
          <Input type="date" aria-label="Pick a date" value={value ?? ""} onChange={(e) => e.target.value && pick(e.target.value)} className="h-9" />
        </label>
        {value && (
          <Button variant="ghost" className="justify-start font-normal text-destructive hover:text-destructive" onClick={() => pick(null)}>
            Clear the date
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** + Add label: search the Project's other labels, or make a new one from what's typed. */
function AddLabel({
  labels,
  onPick,
  onCreate,
}: {
  labels: { id: string; name: string; color: string | null }[];
  onPick: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const name = typed.trim();
  const exists = labels.some((l) => l.name.toLowerCase() === name.toLowerCase());
  const done = () => {
    setOpen(false);
    setTyped("");
  };
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o || setTyped(""))}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-9 gap-1 px-2 text-link">
          <Plus /> Add label
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Label" value={typed} onValueChange={setTyped} />
          <CommandList>
            {!name && labels.length === 0 && <CommandEmpty>Type a name for a new label.</CommandEmpty>}
            <CommandGroup>
              {labels.map((l) => (
                <CommandItem key={l.id} value={`${l.name} ${l.id}`} onSelect={() => (onPick(l.id), done())}>
                  <LabelBadge name={l.name} color={l.color as Color | null} />
                </CommandItem>
              ))}
              {name && !exists && (
                <CommandItem value={`new ${name}`} onSelect={() => (onCreate(name), done())}>
                  <Plus className="h-4 w-4" aria-hidden /> New label “{name}”
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
