import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useApp } from "@/lib/app";
import { addStatus, deleteStatus, markDoneStatus, renameStatus, setStatusColor, type Status } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { statusColor } from "@/lib/colors";
import { ColorSelect } from "@/components/ColorDot";
import type { SectionProps } from "@/components/settings/types";

export function StatusesSection({ project, change }: SectionProps) {
  const { db } = useApp();
  const [newStatus, setNewStatus] = useState("");
  return (
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
          <span className="shrink-0 text-xs text-muted-foreground">Counts as done</span>
        ) : (
          <Button variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs font-normal text-muted-foreground" onClick={() => change(() => markDoneStatus(db, status))}>
            Count as done
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
