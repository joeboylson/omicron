import { useEffect, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Loader2, Plus, Send, Terminal, Trash2, X } from "lucide-react";
import { useApp } from "@/lib/app";
import { useAwakeMachines } from "@/lib/awake";
import {
  addChecklistItem,
  addLabel,
  deleteChecklistItem,
  deleteTask,
  DISPATCH_CLAIM_SECONDS,
  giveUpDispatch,
  requestDispatch,
  setLabel,
  tickChecklistItem,
  updateTask,
  type ProjectData,
  type Task,
} from "@/lib/data";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "@/components/ui/select";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { statusColor, type Color } from "@/lib/colors";
import { ColorDot } from "@/components/ColorDot";
import { LabelBadge, NeedsReview } from "@/components/TaskCard";
import { Comments } from "@/components/Comments";

const NOBODY = "nobody";

export function TaskDialog({
  project,
  task,
  onClose,
  onChanged,
}: {
  project: ProjectData;
  task: Task | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:max-w-xl sm:bg-background"
        // Don't jump into the title: on a phone that opens the keyboard.
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {task && <TaskForm key={task.id} project={project} task={task} onClose={onClose} onChanged={onChanged} />}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  project,
  task,
  onClose,
  onChanged,
}: {
  project: ProjectData;
  task: Task;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { db, act } = useApp();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [newItem, setNewItem] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [sure, setSure] = useState(false);
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
  const save = (c: Parameters<typeof updateTask>[3]) => change(() => updateTask(db, project, task, c));

  const done = project.statuses.find((s) => s.is_done);
  const isDone = done?.id === task.status_id;

  return (
    <>
      <DialogHeader>
        <DialogDescription className="text-left">
          <span className="font-mono">#{task.number}</span> in {project.name}
        </DialogDescription>
        <DialogTitle className="sr-only">{task.title}</DialogTitle>
        <Input
          id="task-title"
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onBlur={() => {
            const t = title.trim();
            if (!t) setTitle(task.title);
            else if (t !== task.title) save({ title: t });
          }}
          className="h-auto border-transparent bg-transparent px-0 py-1 text-xl font-semibold shadow-none focus-visible:border-input focus-visible:bg-background focus-visible:px-3 md:text-xl"
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
          <Input
            id="task-date"
            type="date"
            value={task.due_on ?? ""}
            onChange={(e) => save({ due_on: e.target.value || null })}
            className={cn(bare, "w-auto px-0 text-right text-muted-foreground")}
          />
        </Row>
        <Row>
          <Label htmlFor="task-assignee" className="flex-1 font-normal">
            Given to
          </Label>
          <Select
            value={
              task.assignee_session_id
                ? `session:${task.assignee_session_id}`
                : task.assignee_person_id
                  ? `person:${task.assignee_person_id}`
                  : NOBODY
            }
            onValueChange={(v) => {
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
                    <SelectItem key={c.id} value={`session:${c.id}`} disabled={c.state !== "open" && c.id !== task.assignee_session_id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </Row>
        {task.assignee_session_id && <DispatchRow project={project} task={task} onChanged={onChanged} />}
      </Group>

      <Group title="Labels">
        <Row className="flex-wrap gap-1.5 py-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Labels">
            {project.labels.map((l) => {
              const on = task.labelIds.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  className="flex min-h-9 items-center"
                  onClick={() => change(() => setLabel(db, task, l.id, !on))}
                >
                  {l.color ? (
                    <LabelBadge name={l.name} color={l.color as Color} pressed={on} />
                  ) : (
                    <Badge variant={on ? "default" : "outline"} className="cursor-pointer px-3 py-1 font-normal">
                      {l.name}
                    </Badge>
                  )}
                </button>
              );
            })}
            <form
              className="flex items-center"
              onSubmit={(e) => {
                e.preventDefault();
                const name = newLabel.trim();
                if (!name) return;
                const existing = project.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
                change(async () => {
                  await setLabel(db, task, existing?.id ?? (await addLabel(db, project.id, name)), true);
                  setNewLabel("");
                });
              }}
            >
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="New label"
                aria-label="New label"
                className={cn(bare, "h-9 w-32 px-1")}
              />
            </form>
          </div>
        </Row>
      </Group>

      <Group title={<label htmlFor="task-notes">Notes</label>}>
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

      <div className="flex flex-wrap gap-2 pt-2">
        {done && !isDone && (
          <Button className="flex-1 sm:flex-none" onClick={() => save({ status_id: done.id })}>
            <Check /> Mark done
          </Button>
        )}
        <Button
          variant={sure ? "destructive" : "ghost"}
          className={cn("ml-auto", !sure && "text-destructive hover:text-destructive")}
          onClick={() => (sure ? change(async () => (await deleteTask(db, task), onClose())) : setSure(true))}
          onBlur={() => setSure(false)}
        >
          <Trash2 /> {sure ? "Delete for good" : "Delete task"}
        </Button>
      </div>
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
 * session now, on its machine (typed in, or the session reopened there). The
 * outcome of the latest Dispatch shows under it, for everyone, live.
 */
function DispatchRow({ project, task, onChanged }: { project: ProjectData; task: Task; onChanged: () => void }) {
  const { db, act } = useApp();
  const awake = useAwakeMachines(db);
  const [asking, setAsking] = useState(false);
  const session = project.sessions.find((s) => s.id === task.assignee_session_id);
  const latest = task.dispatches[0];
  const working = asking || latest?.state === "pending" || latest?.state === "claimed";
  const asleep = !!session && awake !== null && !awake.has(session.machine_id);

  async function dispatch() {
    if (!session) return;
    setAsking(true);
    const asked = await act(async () => {
      const id = await requestDispatch(db, task);
      onChanged();
      // If the machine hasn't taken it in time, it fails. Kept even if the
      // dialog closes, so the request never stays waiting.
      setTimeout(() => {
        giveUpDispatch(db, id, `${session.machine} didn't pick it up in time. Is its daemon running?`)
          .catch(() => {})
          .finally(onChanged);
      }, DISPATCH_CLAIM_SECONDS * 1000);
    });
    setAsking(false);
    if (!asked) onChanged();
  }

  return (
    <>
      <Row className="text-sm text-muted-foreground">
        <Terminal className="h-4 w-4 shrink-0" aria-hidden />
        <span data-testid="pickup" className="flex-1">
          {task.picked_up_at
            ? "Picked up by the session."
            : "Waiting until the session is told to get its tasks, or it's dispatched."}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={!session || working || asleep}
          onClick={dispatch}
          title={asleep ? `${session?.machine} is asleep` : `Hand it to ${session?.name} now, on ${session?.machine}`}
        >
          {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
          {working ? "Dispatching" : "Dispatch"}
        </Button>
      </Row>
      {latest && (
        <Row className="text-sm">
          <div role="status" aria-live="polite" data-testid="dispatch" className="flex flex-1 items-start gap-2">
            {latest.state === "pending" ? (
              <span className="text-muted-foreground">Waiting for {session?.machine} to pick it up…</span>
            ) : latest.state === "claimed" ? (
              <span className="text-muted-foreground">
                {session?.machine} is opening {session?.name}…
              </span>
            ) : latest.state === "done" ? (
              <>
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sys-green)]" aria-hidden />
                <span className="flex-1">{latest.result}</span>
              </>
            ) : (
              <>
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sys-red)]" aria-hidden />
                <span className="flex-1">{latest.error}</span>
              </>
            )}
            <time
              dateTime={latest.created_at}
              title={new Date(latest.created_at).toLocaleString()}
              className="shrink-0 font-mono text-muted-foreground"
            >
              {when(latest.created_at)}
            </time>
          </div>
        </Row>
      )}
      {asleep && !working && (
        <Row className="text-sm text-muted-foreground">
          <span data-testid="dispatch-asleep">{session?.machine} is asleep, so Dispatch is off until its daemon runs.</span>
        </Row>
      )}
    </>
  );
}
