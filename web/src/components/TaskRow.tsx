import { useId } from "react";
import { AlertCircle, CalendarDays, Terminal, ChevronRight } from "lucide-react";
import type { ProjectData, Task } from "@/lib/data";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusColor, type Color } from "@/lib/colors";
import { ColorDot } from "@/components/ColorDot";
import { LabelBadge, NeedsReview, cardSummary, formatDate, initials, isOverdue } from "@/components/TaskCard";
import { useCardShow } from "@/lib/cardShow";

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
  // Only what View › Show on Cards asks for (#269).
  const show = useCardShow();
  showStatus = showStatus && show.status;
  const labels = show.labels ? project.labels.filter((l) => task.labelIds.includes(l.id)) : [];
  const assignee = show.givenTo ? project.members.find((m) => m.id === task.assignee_person_id) : undefined;
  const session = show.givenTo ? project.sessions.find((c) => c.id === task.assignee_session_id) : undefined;
  const status = project.statuses.find((s) => s.id === task.status_id);
  const done = status?.is_done ?? false;
  const ended = show.givenTo && !assignee && !session && !done && task.ended_session ? task.ended_session : null;
  const due = show.date ? task.due_on : null;
  const overdue = !done && !!due && isOverdue(due);
  const summaryId = useId();
  const summary = cardSummary(project, task, showStatus, show);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`#${task.number} ${task.title}`}
      aria-describedby={summary ? summaryId : undefined}
      className="relative flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 max-sm:pr-9 text-left text-[0.9375rem] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent sm:text-sm"
    >
      {summary && (
        <span id={summaryId} className="sr-only">
          {summary}
        </span>
      )}
      <span className="w-10 shrink-0 tabular-nums text-xs text-muted-foreground">#{task.number}</span>
      <span className={cn("min-w-0 flex-1 break-words", done && "text-muted-foreground line-through")}>{task.title}</span>
      {show.notes && task.notes.trim() && (
        <span className="line-clamp-2 basis-full whitespace-pre-line break-words pl-[3.25rem] text-xs text-muted-foreground">{task.notes.trim()}</span>
      )}
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
      {(due || session || ended || assignee) && (
        <span className="flex items-center gap-3 text-xs text-muted-foreground max-sm:pl-[3.25rem]">
          {due && (
            <span className={cn("flex items-center gap-1", overdue && "text-destructive")} title={overdue ? "Overdue" : undefined}>
              {overdue ? <AlertCircle className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
              {overdue ? `Overdue · ${formatDate(due)}` : formatDate(due)}
            </span>
          )}
          {session && (
            <span className="flex items-center gap-1" title={task.picked_up_at ? `${session.name} picked it up` : `Waiting for ${session.name}`}>
              <Terminal className="h-3.5 w-3.5" />
              <span className="tabular-nums">{session.name}</span>
            </span>
          )}
          {ended && (
            <span className="flex items-center gap-1 text-[var(--orange-text)]" title={`${ended} has ended: give it to someone else`}>
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="tabular-nums">{ended}</span>
            </span>
          )}
          {assignee && (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[0.6875rem] font-medium text-secondary-foreground"
              title={assignee.display_name}
            >
              {initials(assignee.display_name)}
            </span>
          )}
        </span>
      )}
      {/* A row that opens something shows it (HIG lists-and-tables #9). */}
      <ChevronRight aria-hidden className="h-4 w-4 shrink-0 self-center text-muted-foreground/60 max-sm:absolute max-sm:right-3 max-sm:top-1/2 max-sm:-translate-y-1/2" />
    </button>
  );
}
