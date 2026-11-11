import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useApp } from "@/lib/app";
import {
  addMember,
  addStatus,
  deleteStatus,
  listPeople,
  markDoneStatus,
  removeMember,
  renameProject,
  renameStatus,
  type Person,
  type ProjectData,
  type Status,
} from "@/lib/data";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
      <DialogContent className="max-h-[90dvh] overflow-y-auto" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>Changes save as you make them.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const n = name.trim();
              if (!n) setName(project.name);
              else if (n !== project.name) change(() => renameProject(db, project.id, n));
            }}
          />
        </div>

        <section className="grid gap-2" aria-label="Statuses">
          <Label>Statuses</Label>
          <p className="text-xs text-muted-foreground">
            One status is the Done status. A status with tasks in it can't be removed.
          </p>
          <ul className="grid gap-1.5">
            {project.statuses.map((s) => (
              <StatusRow
                key={s.id}
                status={s}
                inUse={project.tasks.some((t) => t.status_id === s.id)}
                change={change}
              />
            ))}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = newStatus.trim();
              if (n) change(async () => (await addStatus(db, project, n), setNewStatus("")));
            }}
          >
            <Input value={newStatus} onChange={(e) => setNewStatus(e.target.value)} placeholder="New status" aria-label="New status" />
            <Button type="submit" variant="outline" disabled={!newStatus.trim()}>
              <Plus /> Add
            </Button>
          </form>
        </section>

        <section className="grid gap-2" aria-label="Members">
          <Label>Members</Label>
          <ul className="grid gap-1">
            {project.members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1">
                  {m.display_name}
                  {m.id === me.personId && <span className="text-muted-foreground"> (you)</span>}
                </span>
                {m.id !== me.personId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${m.display_name}`}
                    onClick={() => change(() => removeMember(db, project.id, m.id))}
                  >
                    <X />
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {outsiders.length > 0 && (
            <Select value="" onValueChange={(id) => change(() => addMember(db, project.id, id))}>
              <SelectTrigger aria-label="Add a member">
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
          )}
        </section>
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
    <li className="flex items-center gap-2">
      <Input
        value={name}
        aria-label={`Status name: ${status.name}`}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => {
          const n = name.trim();
          if (!n) setName(status.name);
          else if (n !== status.name) change(() => renameStatus(db, status, n));
        }}
      />
      {status.is_done ? (
        <Badge variant="outline" className="h-10 w-28 shrink-0 justify-center font-normal">
          Done status
        </Badge>
      ) : (
        <Button variant="outline" className="w-28 shrink-0" onClick={() => change(() => markDoneStatus(db, status))}>
          Make Done
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        aria-label={`Remove status ${status.name}`}
        disabled={status.is_done || inUse}
        onClick={() => change(() => deleteStatus(db, status))}
      >
        <Trash2 />
      </Button>
    </li>
  );
}
