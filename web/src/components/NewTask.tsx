import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useApp } from "@/lib/app";
import { addLabel, addTask } from "@/lib/data";
import type { ProjectData, Who } from "@/lib/data/types";
import { Button } from "@/components/base/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/base/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/base/select";
import { Group, Row, bare } from "@/components/Grouped";
import { ColorDot } from "@/components/ColorDot";
import { DateField } from "@/components/task/DateField";
import { AddLabel } from "@/components/task/Labels";
import { LabelBadge } from "@/components/TaskCard";
import { statusColor, type Color } from "@/lib/colors";
import { cn } from "@/lib/utils";

/** Where a new task starts: the column it was added from. */
export type NewTaskStart = { statusId: string; topicId: string | null; who?: Who };

const NOBODY = "nobody";

/**
 * New Task (#254): the title and every other choice in one window, opened
 * from New Task, a column's Add Task, or "c". Enter adds it; Shift+Enter
 * adds it and opens it.
 */
export function NewTask({
  project,
  start,
  onClose,
  onAdded,
}: {
  project: ProjectData;
  /** Open while set. */
  start: NewTaskStart | null;
  onClose: () => void;
  /** Added: its number, and whether to open it. */
  onAdded: (number: number, open: boolean) => void;
}) {
  const { db, act } = useApp();
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [statusId, setStatusId] = useState("");
  const [topicId, setTopicId] = useState<string | null>(null);
  const [who, setWho] = useState<string>(NOBODY);
  const [due, setDue] = useState<string | null>(null);
  const [labelIds, setLabelIds] = useState<string[]>([]);
  // Labels made here, until the Project reloads with them.
  const [made, setMade] = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const titleBox = useRef<HTMLTextAreaElement>(null);

  // A fresh form each time it opens, starting from where it was opened.
  useEffect(() => {
    if (!start) return;
    setTitle("");
    setNotes("");
    setStatusId(start.statusId);
    setTopicId(start.topicId);
    setWho(start.who?.person ? `person:${start.who.person}` : start.who?.session ? `session:${start.who.session}` : NOBODY);
    setDue(null);
    setLabelIds([]);
    setMade([]);
  }, [start]);

  const labels = [...project.labels, ...made.filter((m) => !project.labels.some((l) => l.id === m.id))];
  const add = async (open: boolean) => {
    const t = title.trim().replace(/[\r\n]+/g, " ");
    if (!t || saving || !statusId) return;
    setSaving(true);
    const [kind, id] = who.split(":");
    const given: Who | undefined = who === NOBODY ? undefined : { person: kind === "person" ? id : null, session: kind === "session" ? id : null };
    let number: number | undefined;
    const ok = await act(async () => {
      number = await addTask(db, project, statusId, t, topicId, given, due, { notes: notes.trim(), labelIds });
    });
    setSaving(false);
    if (ok && number !== undefined) {
      onClose();
      onAdded(number, open);
    }
  };

  return (
    <Dialog open={start !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[92dvh] gap-4 overflow-y-auto bg-muted sm:max-w-lg sm:bg-background"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          titleBox.current?.focus();
        }}
      >
        <DialogHeader className="text-left">
          <DialogTitle>New Task</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            add(false);
          }}
        >
          <Group>
            <Row className="py-2">
              <Textarea
                ref={titleBox}
                rows={1}
                value={title}
                // A title is one line: what's typed wraps, and a pasted line break becomes a space.
                onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    add(e.shiftKey);
                  }
                }}
                placeholder="What needs doing?"
                aria-label="Title"
                className={cn(bare, "min-h-10 resize-none px-0 py-2 text-base [field-sizing:content] [overflow-wrap:anywhere]")}
              />
            </Row>
            <Row className="py-2">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes"
                aria-label="Notes"
                className={cn(bare, "min-h-20 resize-none px-0 py-2 [field-sizing:content]")}
              />
            </Row>
          </Group>

          <Group>
            <Row>
              <Label htmlFor="new-status" className="flex-1 font-normal">
                Status
              </Label>
              <Select value={statusId} onValueChange={setStatusId}>
                <SelectTrigger id="new-status" className={cn(bare, "w-auto gap-1 text-muted-foreground")}>
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
                <Label htmlFor="new-topic" className="flex-1 font-normal">
                  Topic
                </Label>
                <Select value={topicId ?? NOBODY} onValueChange={(v) => setTopicId(v === NOBODY ? null : v)}>
                  <SelectTrigger id="new-topic" className={cn(bare, "w-auto gap-1 text-muted-foreground")}>
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
              <Label htmlFor="new-date" className="flex-1 font-normal">
                Date
              </Label>
              <DateField id="new-date" value={due} onChange={setDue} />
            </Row>
            <Row>
              <Label htmlFor="new-who" className="flex-1 font-normal">
                Given to
              </Label>
              <Select value={who} onValueChange={setWho}>
                <SelectTrigger id="new-who" className={cn(bare, "w-auto gap-1 text-muted-foreground")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value={NOBODY}>Nobody</SelectItem>
                  <SelectGroup>
                    <SelectLabel className="text-xs font-normal text-muted-foreground">People</SelectLabel>
                    {project.members.map((m) => (
                      <SelectItem key={m.id} value={`person:${m.id}`}>
                        {m.display_name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {project.sessions.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="text-xs font-normal text-muted-foreground">Claude sessions</SelectLabel>
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
          </Group>

          <Group title="Labels">
            <Row className="flex-wrap gap-1.5 py-2">
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Labels">
                {labels
                  .filter((l) => labelIds.includes(l.id))
                  .map((l) => (
                    <span key={l.id} className="flex min-h-9 items-center gap-0.5">
                      <LabelBadge name={l.name} color={l.color as Color | null} />
                      <button
                        type="button"
                        aria-label={`Take off ${l.name}`}
                        className="relative flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => setLabelIds((ids) => ids.filter((i) => i !== l.id))}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                <AddLabel
                  labels={labels.filter((l) => !labelIds.includes(l.id))}
                  onPick={(id) => setLabelIds((ids) => [...ids, id])}
                  onCreate={(name) => {
                    const existing = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
                    if (existing) return setLabelIds((ids) => [...ids, existing.id]);
                    act(async () => {
                      const id = await addLabel(db, project.id, name);
                      setMade((m) => [...m, { id, name, color: null }]);
                      setLabelIds((ids) => [...ids, id]);
                    });
                  }}
                />
              </div>
            </Row>
          </Group>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" variant="outline" disabled={!title.trim() || saving} onClick={() => add(true)}>
              Add and Open
            </Button>
            <Button type="submit" disabled={!title.trim() || saving}>
              {saving ? "Adding…" : "Add Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
