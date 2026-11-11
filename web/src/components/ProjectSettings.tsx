import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useApp } from "@/lib/app";
import {
  addMember,
  addStatus,
  addTopic,
  deleteStatus,
  deleteTopic,
  renameTopic,
  listPeople,
  markDoneStatus,
  removeMember,
  renameProject,
  renameStatus,
  setLabelColor,
  setStatusColor,
  type Person,
  type ProjectData,
  type Status,
  type Topic,
} from "@/lib/data";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { statusColor, type Color } from "@/lib/colors";
import { ColorSelect } from "@/components/ColorDot";

export function ProjectSettings({
  project,
  open,
  onOpenChange,
  onChanged,
}: {
  project: ProjectData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { db, act, me } = useApp();
  const [name, setName] = useState(project.name);
  const [newStatus, setNewStatus] = useState("");
  const [newTopic, setNewTopic] = useState("");
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => setName(project.name), [project.name]);
  useEffect(() => {
    if (open) act(async () => setPeople(await listPeople(db)));
  }, [open, db, act]);

  const change = async (work: () => Promise<unknown>) => {
    if (await act(work)) onChanged();
  };
  const outsiders = people.filter((p) => !project.members.some((m) => m.id === p.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:bg-background"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="text-left">
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>Changes save as you make them.</DialogDescription>
        </DialogHeader>

        <Group title={<label htmlFor="project-name">Name</label>}>
          <Row>
            <Input
              id="project-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const n = name.trim();
                if (!n) setName(project.name);
                else if (n !== project.name) change(() => renameProject(db, project.id, n));
              }}
              className={cn(bare, "px-0")}
            />
          </Row>
        </Group>

        <Group title="Statuses" note="One status is the Done status. A status with tasks in it can't be removed.">
          <ul className="divide-y">
            {project.statuses.map((s) => (
              <StatusRow key={s.id} status={s} inUse={project.tasks.some((t) => t.status_id === s.id)} change={change} />
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = newStatus.trim();
              if (n) change(async () => (await addStatus(db, project, n), setNewStatus("")));
            }}
          >
            <Row>
              <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
              <Input
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                placeholder="New status"
                aria-label="New status"
                className={cn(bare, "px-0")}
              />
              <Button type="submit" variant="ghost" size="sm" aria-label="Add status" disabled={!newStatus.trim()}>
                Add
              </Button>
            </Row>
          </form>
        </Group>

        <Group
          title="Topics"
          note="Topics group tasks into rows on the board, like “Joe's to-do”. Removing one keeps its tasks, without a topic."
        >
          {project.topics.length > 0 && (
            <ul className="divide-y" aria-label="Topics">
              {project.topics.map((t) => (
                <TopicRow key={t.id} topic={t} count={project.tasks.filter((x) => x.topic_id === t.id).length} change={change} />
              ))}
            </ul>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = newTopic.trim();
              if (n) change(async () => (await addTopic(db, project, n), setNewTopic("")));
            }}
          >
            <Row>
              <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
              <Input
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                placeholder="New topic"
                aria-label="New topic"
                className={cn(bare, "px-0")}
              />
              <Button type="submit" variant="ghost" size="sm" aria-label="Add topic" disabled={!newTopic.trim()}>
                Add
              </Button>
            </Row>
          </form>
        </Group>

        {project.labels.length > 0 && (
          <Group title="Labels" note="Labels are made from a task's Labels box.">
            <ul className="divide-y">
              {project.labels.map((l) => (
                <li key={l.id}>
                  <Row>
                    <span className="flex-1 py-2 text-[15px] sm:text-sm">{l.name}</span>
                    <ColorSelect
                      value={(l.color as Color | null) ?? "gray"}
                      label={`Color of label ${l.name}`}
                      onChange={(c) => change(() => setLabelColor(db, l, c))}
                    />
                  </Row>
                </li>
              ))}
            </ul>
          </Group>
        )}

        <Group title="Members">
          <ul className="divide-y">
            {project.members.map((m) => (
              <li key={m.id}>
                <Row>
                  <span className="flex-1 py-2 text-[15px] sm:text-sm">
                    {m.display_name}
                    {m.id === me.personId && <span className="text-muted-foreground"> (you)</span>}
                  </span>
                  {m.id !== me.personId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-mr-2 text-destructive hover:text-destructive"
                      aria-label={`Remove ${m.display_name}`}
                      onClick={() => change(() => removeMember(db, project.id, m.id))}
                    >
                      <X />
                    </Button>
                  )}
                </Row>
              </li>
            ))}
          </ul>
          {outsiders.length > 0 && (
            <Row>
              <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
              <Select value="" onValueChange={(id) => change(() => addMember(db, project.id, id))}>
                <SelectTrigger aria-label="Add a member" className={cn(bare, "px-0 text-muted-foreground")}>
                  <SelectValue placeholder="Add a member…" />
                </SelectTrigger>
                <SelectContent>
                  {outsiders.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          )}
        </Group>
      </DialogContent>
    </Dialog>
  );
}

function StatusRow({
  status,
  inUse,
  change,
}: {
  status: Status;
  inUse: boolean;
  change: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const { db } = useApp();
  const [name, setName] = useState(status.name);
  useEffect(() => setName(status.name), [status.name]);
  return (
    <li>
      <Row>
        <ColorSelect
          value={statusColor(status)}
          label={`Color of ${status.name}`}
          className="-ml-2"
          onChange={(c) => change(() => setStatusColor(db, status, c))}
        />
        <Input
          value={name}
          aria-label={`Status name: ${status.name}`}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const n = name.trim();
            if (!n) setName(status.name);
            else if (n !== status.name) change(() => renameStatus(db, status, n));
          }}
          className={cn(bare, "px-0")}
        />
        {status.is_done ? (
          <Badge variant="secondary" className="shrink-0 font-normal">
            Done status
          </Badge>
        ) : (
          <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={() => change(() => markDoneStatus(db, status))}>
            Make Done
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 shrink-0 text-destructive hover:text-destructive disabled:text-muted-foreground"
          aria-label={`Remove status ${status.name}`}
          disabled={status.is_done || inUse}
          onClick={() => change(() => deleteStatus(db, status))}
        >
          <Trash2 />
        </Button>
      </Row>
    </li>
  );
}

function TopicRow({
  topic,
  count,
  change,
}: {
  topic: Topic;
  count: number;
  change: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const { db } = useApp();
  const [name, setName] = useState(topic.name);
  useEffect(() => setName(topic.name), [topic.name]);
  return (
    <li>
      <Row>
        <Input
          value={name}
          aria-label={`Topic name: ${topic.name}`}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={() => {
            const n = name.trim();
            if (!n) setName(topic.name);
            else if (n !== topic.name) change(() => renameTopic(db, topic, n));
          }}
          className={cn(bare, "px-0")}
        />
        <span className="shrink-0 font-mono text-sm text-muted-foreground" aria-label={`${count} tasks`}>
          {count}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 shrink-0 text-destructive hover:text-destructive"
          aria-label={`Remove topic ${topic.name}`}
          onClick={() => change(() => deleteTopic(db, topic))}
        >
          <Trash2 />
        </Button>
      </Row>
    </li>
  );
}
