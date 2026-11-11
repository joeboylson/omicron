import { CalendarDays, CheckSquare, Terminal } from "lucide-react";
import type { ProjectData, Task } from "@/lib/data";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function TaskCard({ project, task, onOpen }: { project: ProjectData; task: Task; onOpen: () => void }) {
  const labels = project.labels.filter((l) => task.labelIds.includes(l.id));
  const assignee = project.members.find((m) => m.id === task.assignee_person_id);
  const session = project.sessions.find((c) => c.id === task.assignee_session_id);
  const ticked = task.checklist.filter((c) => c.done).length;
  const done = project.statuses.find((s) => s.id === task.status_id)?.is_done ?? false;
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className="cursor-pointer p-3 text-[15px] transition-colors hover:bg-accent active:bg-accent sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`#${task.number} ${task.title}`}
    >
      <div className="flex items-start gap-2">
        <span className={cn("flex-1 break-words", done && "text-muted-foreground line-through")}>{task.title}</span>
        <span className="font-mono text-xs text-muted-foreground">#{task.number}</span>
      </div>
      {(task.needs_review || labels.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.needs_review && <Badge>Needs review</Badge>}
          {labels.map((l) => (
            <Badge key={l.id} variant="secondary" className="font-normal">
              {l.name}
            </Badge>
          ))}
        </div>
      )}
      {(task.due_on || task.checklist.length > 0 || assignee || session) && (
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          {task.due_on && (
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              {formatDate(task.due_on)}
            </span>
          )}
          {task.checklist.length > 0 && (
            <span className="flex items-center gap-1">
              <CheckSquare className="h-3.5 w-3.5" />
              <span className="font-mono">
                {ticked}/{task.checklist.length}
              </span>
            </span>
          )}
          {session && (
            <span
              className="ml-auto flex items-center gap-1"
              title={task.picked_up_at ? `${session.name} picked it up` : `Waiting for ${session.name}`}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span className="font-mono">{session.name}</span>
              {!task.picked_up_at && <span>· waiting</span>}
            </span>
          )}
          {assignee && (
            <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-secondary-foreground" title={assignee.display_name}>
              {initials(assignee.display_name)}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = y === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
