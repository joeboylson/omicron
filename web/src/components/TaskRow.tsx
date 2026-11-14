import { useId } from "react";
import { AlertCircle, CalendarDays, Terminal } from "lucide-react";
import type { ProjectData, Task } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusColor, type Color } from "@/lib/colors";
import { ColorDot } from "@/components/ColorDot";
import { LabelBadge, NeedsReview, cardSummary, formatDate, initials, isOverdue } from "@/components/TaskCard";

/** A task as one row of the list view: number, title, labels, who has it, date. */
export function TaskRow({
  project,
  task,
  showStatus,
  onOpen,
}: {
  project: ProjectData;
  task: Task;
  /** When the list isn't grouped by status, say which status it's in. */
  showStatus: boolean;
  onOpen: () => void;
}) {
  const labels = project.labels.filter((l) => task.labelIds.includes(l.id));
  const assignee = project.members.find((m) => m.id === task.assignee_person_id);
  const session = project.sessions.find((c) => c.id === task.assignee_session_id);
  const status = project.statuses.find((s) => s.id === task.status_id);
  const done = status?.is_done ?? false;
  const ended = !assignee && !session && !done && task.ended_session ? task.ended_session : null;
  const overdue = !done && !!task.due_on && isOverdue(task.due_on);
  const summaryId = useId();
  const summary = cardSummary(project, task, showStatus);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`#${task.number} ${task.title}`}
      aria-describedby={summary ? summaryId : undefined}
      className="relative flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-[15px] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent sm:text-sm"
    >
      {summary && (
        <span id={summaryId} className="sr-only">
          {summary}
        </span>
      )}
      <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">#{task.number}</span>
      <span className={cn("min-w-0 flex-1 break-words", done && "text-muted-foreground line-through")}>{task.title}</span>
      {(showStatus || task.needs_review || labels.length > 0) && (
        <span className="flex flex-wrap gap-1 max-sm:basis-full max-sm:pl-[3.25rem]">
          {showStatus && status && (
            <Badge variant="outline" className="gap-1.5 font-normal">
              <ColorDot color={statusColor(status)} />
              {status.name}
            </Badge>
          )}
          {task.needs_review && <NeedsReview />}
          {labels.map((l) => (
            <LabelBadge key={l.id} name={l.name} color={l.color as Color | null} />
          ))}
        </span>
      )}
      {(task.due_on || session || ended || assignee) && (
        <span className="flex items-center gap-3 text-xs text-muted-foreground max-sm:pl-[3.25rem]">
          {task.due_on && (
            <span className={cn("flex items-center gap-1", overdue && "text-destructive")} title={overdue ? "Overdue" : undefined}>
              {overdue ? <AlertCircle className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
              {overdue ? `Overdue · ${formatDate(task.due_on)}` : formatDate(task.due_on)}
            </span>
          )}
          {session && (
            <span className="flex items-center gap-1" title={task.picked_up_at ? `${session.name} picked it up` : `Waiting for ${session.name}`}>
              <Terminal className="h-3.5 w-3.5" />
              <span className="font-mono">{session.name}</span>
            </span>
          )}
          {ended && (
            <span className="flex items-center gap-1 text-[var(--sys-orange)]" title={`${ended} has ended: give it to someone else`}>
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="font-mono">{ended}</span>
            </span>
          )}
          {assignee && (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[11px] font-medium text-secondary-foreground"
              title={assignee.display_name}
            >
              {initials(assignee.display_name)}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
