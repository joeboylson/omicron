import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { go, useApp } from "@/lib/app";
import {
  addMember,
  addProjectMachine,
  deleteProject,
  addStatus,
  addTopic,
  deleteStatus,
  deleteTopic,
  renameTopic,
  listMachines,
  listPeople,
  markDoneStatus,
  removeMember,
  removeProjectMachine,
  renameProject,
  renameStatus,
  deleteLabel,
  renameLabel,
  setLabelColor,
  setStatusColor,
  type MachineRow,
  type Person,
  type ProjectData,
  type Status,
  type Label,
  type Topic,
} from "@/lib/data";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Badge } from "@/components/ui/badge";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { statusColor, type Color } from "@/lib/colors";
import { ColorSelect } from "@/components/ColorDot";
import { MultiSelect } from "@/components/MultiSelect";

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
  const [machines, setMachines] = useState<MachineRow[]>([]);
  // Deleting asks for the Project's name, typed, first.
  const [typedName, setTypedName] = useState("");
  useEffect(() => setTypedName(""), [open]);

  useEffect(() => setName(project.name), [project.name]);
  useEffect(() => {
    if (open) {
      act(async () => {
        const [p, m] = await Promise.all([listPeople(db), listMachines(db)]);
        setPeople(p);
        setMachines(m);
      });
    }
  }, [open, db, act]);

  const change = async (work: () => Promise<unknown>) => {
    if (await act(work)) onChanged();
  };
  // Machines change here, and the list is read here: read it again after.
  const changeMachines = async (work: () => Promise<unknown>) => {
    if (await act(work)) {
      setMachines(await listMachines(db));
      onChanged();
    }
  };
  // Machines on every Project are always in it; the rest can be picked
  // (switched-off ones only while they're still in it).
  const pickable = machines.filter((m) => !m.all_projects && (m.active || m.projectIds.includes(project.id)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:bg-background"
        onOpenAutoFocus={focusSheet}
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

        <Group title="Statuses">
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
          <Group title="Labels">
            <ul className="divide-y" aria-label="Labels">
              {project.labels.map((l) => (
                <LabelRow key={l.id} label={l} count={project.tasks.filter((t) => t.labelIds.includes(l.id)).length} change={change} />
              ))}
            </ul>
          </Group>
        )}

        <Group title="Members">
          <Row className="py-2">
            <MultiSelect
              label="Members"
              none="Just you"
              choices={people.filter((p) => p.id !== me.personId).map((p) => ({ id: p.id, name: p.display_name }))}
              picked={new Set(project.members.map((m) => m.id))}
              toggle={(id, on) => change(() => (on ? addMember(db, project.id, id) : removeMember(db, project.id, id)))}
            />
          </Row>
        </Group>

        <Group title="Machines">
          <Row className="py-2">
            <MultiSelect
              label="Machines"
              none="No machines"
              choices={pickable.map((m) => ({ id: m.id, name: m.name, mono: true }))}
              picked={new Set(pickable.filter((m) => m.projectIds.includes(project.id)).map((m) => m.id))}
              toggle={(id, on) => changeMachines(() => (on ? addProjectMachine(db, project.id, id) : removeProjectMachine(db, project.id, id)))}
            />
          </Row>
        </Group>

        <Group
          title={<label htmlFor="delete-project">Delete Project</label>}
          note="Deletes it for everyone, with all its tasks and sessions. This can't be undone."
        >
          <form
            className="flex items-center gap-2 py-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (typedName !== project.name) return;
              if (await act(() => deleteProject(db, project.id))) {
                onOpenChange(false);
                go("/");
              }
            }}
          >
            <Input
              id="delete-project"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder={`Type ${project.name} to delete it`}
              autoComplete="off"
              className="flex-1"
            />
            <Button type="submit" variant="destructive" size="sm" disabled={typedName !== project.name}>
              <Trash2 /> Delete
            </Button>
          </form>
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

function LabelRow({
  label,
  count,
  change,
}: {
  label: Label;
  count: number;
  change: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const { db } = useApp();
  const [name, setName] = useState(label.name);
  useEffect(() => setName(label.name), [label.name]);
  return (
    <li>
      <Row>
        <ColorSelect
          value={(label.color as Color | null) ?? "gray"}
          label={`Color of label ${label.name}`}
          className="-ml-2"
          onChange={(c) => change(() => setLabelColor(db, label, c))}
        />
        <Input
          value={name}
          aria-label={`Label name: ${label.name}`}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={() => {
            const n = name.trim();
            if (!n) setName(label.name);
            else if (n !== label.name) change(() => renameLabel(db, label, n));
          }}
          className={cn(bare, "px-0")}
        />
        <span className="shrink-0 font-mono text-sm text-muted-foreground" title={`On ${count} ${count === 1 ? "task" : "tasks"}`}>
          {count}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 shrink-0 text-destructive hover:text-destructive"
          aria-label={`Remove label ${label.name}`}
          onClick={() => change(() => deleteLabel(db, label))}
        >
          <Trash2 />
        </Button>
      </Row>
    </li>
  );
}
