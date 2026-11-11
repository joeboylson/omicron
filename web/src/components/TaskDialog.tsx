import { useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { useApp } from "@/lib/app";
import {
  addChecklistItem,
  addLabel,
  deleteChecklistItem,
  deleteTask,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
        className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"
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
  useEffect(() => setTicked({}), [task.checklist]);

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
        <DialogDescription>
          #{task.number} in {project.name}
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
          className="border-transparent px-0 text-lg font-semibold shadow-none focus-visible:border-input focus-visible:px-3"
        />
      </DialogHeader>

      {task.needs_review && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm" data-testid="needs-review">
          <Badge>Needs review</Badge>
          <span className="min-w-[12rem] flex-1 text-muted-foreground">A Claude session asked for this to be checked.</span>
          <Button size="sm" variant="outline" onClick={() => save({ needs_review: false })}>
            <Check /> Reviewed
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="task-status">Status</Label>
          <Select value={task.status_id} onValueChange={(v) => save({ status_id: v })}>
            <SelectTrigger id="task-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {project.statuses.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="task-date">Date</Label>
          <Input
            id="task-date"
            type="date"
            value={task.due_on ?? ""}
            onChange={(e) => save({ due_on: e.target.value || null })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="task-assignee">Given to</Label>
          <Select
            value={task.assignee_person_id ?? NOBODY}
            onValueChange={(v) => save({ assignee_person_id: v === NOBODY ? null : v })}
          >
            <SelectTrigger id="task-assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOBODY}>Nobody</SelectItem>
              {project.members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label>Labels</Label>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Labels">
          {project.labels.map((l) => {
            const on = task.labelIds.includes(l.id);
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={on}
                onClick={() => change(() => setLabel(db, task, l.id, !on))}
              >
                <Badge variant={on ? "default" : "outline"} className="cursor-pointer font-normal">
                  {l.name}
                </Badge>
              </button>
            );
          })}
          <form
            className="flex items-center gap-1"
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
              className="h-7 w-28 text-xs"
            />
          </form>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="task-notes">Notes</Label>
        <Textarea
          id="task-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes !== task.notes && save({ notes })}
          rows={4}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>
          Checklist
          {task.checklist.length > 0 && (
            <span className="ml-2 font-normal text-muted-foreground">
              {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
            </span>
          )}
        </Label>
        <ul className="grid gap-1" aria-label="Checklist">
          {task.checklist.map((item) => (
            <li key={item.id} className="group flex items-center gap-2 text-sm">
              <Checkbox
                id={`item-${item.id}`}
                checked={ticked[item.id] ?? item.done}
                onCheckedChange={(v) => {
                  setTicked((t) => ({ ...t, [item.id]: v === true }));
                  change(() => tickChecklistItem(db, item, v === true));
                }}
              />
              <label htmlFor={`item-${item.id}`} className={(ticked[item.id] ?? item.done) ? "flex-1 text-muted-foreground line-through" : "flex-1"}>
                {item.text}
              </label>
              <button
                type="button"
                aria-label={`Remove ${item.text}`}
                className="opacity-50 hover:opacity-100"
                onClick={() => change(() => deleteChecklistItem(db, item))}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = newItem.trim();
            if (text) change(async () => (await addChecklistItem(db, task, text), setNewItem("")));
          }}
        >
          <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add an item" aria-label="New checklist item" />
          <Button type="submit" variant="outline" size="icon" aria-label="Add item" disabled={!newItem.trim()}>
            <Plus />
          </Button>
        </form>
      </div>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        {done && !isDone && (
          <Button onClick={() => save({ status_id: done.id })}>
            <Check /> Mark done
          </Button>
        )}
        <Button
          variant={sure ? "destructive" : "ghost"}
          className="ml-auto"
          onClick={() => (sure ? change(async () => (await deleteTask(db, task), onClose())) : setSure(true))}
          onBlur={() => setSure(false)}
        >
          <Trash2 /> {sure ? "Delete for good" : "Delete task"}
        </Button>
      </div>
    </>
  );
}
