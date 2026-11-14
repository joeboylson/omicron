import { AlertCircle, CalendarDays, CheckSquare, MessageSquare, Terminal } from "lucide-react";
import type { ProjectData, Task } from "@/lib/data";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusColor, tint, type Color } from "@/lib/colors";
import { ColorDot } from "@/components/ColorDot";

export function TaskCard({
  project,
  task,
  showStatus = false,
  describedBy,
  onOpen,
}: {
  project: ProjectData;
  task: Task;
  /** In columns that aren't statuses (by topic), say which status it's in. */
  showStatus?: boolean;
  /** The id of what's read after its name (how to move it, on the board). */
  describedBy?: string;
  onOpen: () => void;
}) {
  const labels = project.labels.filter((l) => task.labelIds.includes(l.id));
  const assignee = project.members.find((m) => m.id === task.assignee_person_id);
  const session = project.sessions.find((c) => c.id === task.assignee_session_id);
  const ticked = task.checklist.filter((c) => c.done).length;
  const status = project.statuses.find((s) => s.id === task.status_id);
  const done = status?.is_done ?? false;
  // Given to a session that has since ended, and not given out again.
  const ended = !assignee && !session && !done && task.ended_session ? task.ended_session : null;
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      // Enter opens it; Space picks it up to move it (on the board).
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onOpen())}
      className="cursor-pointer p-3 text-[15px] transition-colors hover:bg-accent active:bg-accent sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`#${task.number} ${task.title}`}
      aria-describedby={describedBy}
    >
      <div className="flex items-start gap-2">
        <span className={cn("min-w-0 flex-1 break-words", done && "text-muted-foreground line-through")}>{task.title}</span>
        <span className="font-mono text-xs text-muted-foreground">#{task.number}</span>
      </div>
      {((showStatus && status) || task.needs_review || task.question?.open || labels.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.question?.open && <TeamWaiting />}
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
        </div>
      )}
      {(task.due_on || task.checklist.length > 0 || task.comments.length > 0 || assignee || session || ended) && (
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          {task.due_on && (
            <span
              className={cn("flex items-center gap-1", !done && isOverdue(task.due_on) && "text-destructive")}
              title={!done && isOverdue(task.due_on) ? "Overdue" : undefined}
            >
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
          {task.comments.length > 0 && (
            <span className="flex items-center gap-1" title={`${task.comments.length} comments`}>
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="font-mono">{task.comments.length}</span>
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
          {ended && (
            <span className="ml-auto flex items-center gap-1 text-[var(--sys-orange)]" title={`${task.ended_session} has ended: give it to someone else`}>
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="font-mono">{task.ended_session}</span>
              <span>· ended</span>
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

/** Past its date (today doesn't count). */
export function isOverdue(iso: string): boolean {
  const today = new Date();
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return iso < t;
}

/** A team member asked this and is waiting on the answer. */
export function TeamWaiting() {
  return (
    <Badge className="border-transparent font-medium text-white hover:opacity-90" style={{ background: "var(--sys-blue)" }}>
      Team is waiting on you
    </Badge>
  );
}

/** The Needs review mark: orange, Apple's color for "look at this". */
export function NeedsReview() {
  return (
    <Badge className="border-transparent font-medium text-white hover:opacity-90" style={{ background: "var(--sys-orange)" }}>
      Needs review
    </Badge>
  );
}

/** A label, washed in its color, with its name in the normal text color so it stays readable. */
export function LabelBadge({ name, color, pressed }: { name: string; color: Color | null; pressed?: boolean }) {
  if (!color) {
    return (
      <Badge variant={pressed === false ? "outline" : "secondary"} className="font-normal">
        {name}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-transparent font-normal text-foreground"
      style={pressed === false ? { borderColor: tint(color, 45) } : { background: tint(color) }}
    >
      <ColorDot color={color} className="h-2 w-2" />
      {name}
    </Badge>
  );
}
