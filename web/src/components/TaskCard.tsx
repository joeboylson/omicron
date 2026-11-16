import { useId } from "react";
import { AlertCircle, CalendarDays, CheckSquare, MessageSquare, Terminal } from "lucide-react";
import type { ProjectData, Task } from "@/lib/data";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusColor, tint, type Color } from "@/lib/colors";
import { ColorDot } from "@/components/ColorDot";
import { CARD_SHOW, useCardShow, type CardShow } from "@/lib/cardShow";

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
  // Only what View › Show on Cards asks for (#269).
  const show = useCardShow();
  showStatus = showStatus && show.status;
  const labels = show.labels ? project.labels.filter((l) => task.labelIds.includes(l.id)) : [];
  const assignee = show.givenTo ? project.members.find((m) => m.id === task.assignee_person_id) : undefined;
  const session = show.givenTo ? project.sessions.find((c) => c.id === task.assignee_session_id) : undefined;
  const ticked = task.checklist.filter((c) => c.done).length;
  const checklist = show.checklist ? task.checklist.length : 0;
  const commentCount = show.comments ? task.commentCount : 0;
  const due = show.date ? task.due_on : null;
  const status = project.statuses.find((s) => s.id === task.status_id);
  const done = status?.is_done ?? false;
  // Given to a session that has since ended, and not given out again.
  const ended = show.givenTo && !assignee && !session && !done && task.ended_session ? task.ended_session : null;
  const summaryId = useId();
  const summary = cardSummary(project, task, showStatus, show);
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      // Enter opens it; Space picks it up to move it (on the board).
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), onOpen())}
      className="group/card relative cursor-pointer p-3 text-[0.9375rem] transition-colors hover:bg-accent active:bg-accent sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`#${task.number} ${task.title}`}
      aria-describedby={[summary ? summaryId : "", describedBy ?? ""].filter(Boolean).join(" ") || undefined}
    >
      {summary && (
        <span id={summaryId} className="sr-only">
          {summary}
        </span>
      )}
      <div className="flex items-start gap-2">
        <span className={cn("min-w-0 flex-1 break-words", done && "text-muted-foreground line-through")}>{task.title}</span>
        <span className="tabular-nums text-xs text-muted-foreground group-hover/card:text-foreground/80 group-active/card:text-foreground/80">#{task.number}</span>
      </div>
      {show.notes && task.notes.trim() && <p className="mt-1 line-clamp-2 whitespace-pre-line break-words text-xs text-muted-foreground">{task.notes.trim()}</p>}
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
      {(due || checklist > 0 || commentCount > 0 || assignee || session || ended) && (
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          {due && (
            <span
              className={cn("flex items-center gap-1", !done && isOverdue(due) && "text-destructive")}
              title={!done && isOverdue(due) ? "Overdue" : undefined}
            >
              {!done && isOverdue(due) ? <AlertCircle className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
              {!done && isOverdue(due) ? `Overdue · ${formatDate(due)}` : formatDate(due)}
            </span>
          )}
          {checklist > 0 && (
            <span className="flex items-center gap-1">
              <CheckSquare className="h-3.5 w-3.5" />
              <span className="tabular-nums">
                {ticked}/{task.checklist.length}
              </span>
            </span>
          )}
          {commentCount > 0 && (
            <span className="flex items-center gap-1" title={`${task.commentCount} comments`}>
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="tabular-nums">{task.commentCount}</span>
            </span>
          )}
          {session && (
            <span
              className="ml-auto flex items-center gap-1"
              title={task.picked_up_at ? `${session.name} picked it up` : `Waiting for ${session.name}`}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span className="tabular-nums">{session.name}</span>
              {!task.picked_up_at && <span>hasn't started it</span>}
            </span>
          )}
          {ended && (
            <span className="ml-auto flex items-center gap-1 text-[var(--orange-text)]" title={`${task.ended_session} has ended: give it to someone else`}>
              <AlertCircle className="h-3.5 w-3.5" />
              <span className="tabular-nums">{task.ended_session}</span>
              <span>has ended</span>
            </span>
          )}
          {assignee && (
            <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-[0.6875rem] font-medium text-secondary-foreground" title={assignee.display_name}>
              {initials(assignee.display_name)}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

/**
 * What a card shows besides its name, said in words for screen readers
 * (the card's name is only its number and title) (#201).
 */
export function cardSummary(project: ProjectData, task: Task, showStatus: boolean, show: CardShow = CARD_SHOW): string {
  // Says what the card shows, so it follows View › Show on Cards too (#269).
  const parts: string[] = [];
  const status = project.statuses.find((s) => s.id === task.status_id);
  const done = status?.is_done ?? false;
  if (showStatus && show.status && status) parts.push(status.name);
  if (task.question?.open) parts.push("Team is waiting on you");
  if (task.needs_review) parts.push("Needs review");
  const labels = show.labels ? project.labels.filter((l) => task.labelIds.includes(l.id)).map((l) => l.name) : [];
  if (labels.length) parts.push(`${labels.length === 1 ? "Label" : "Labels"}: ${labels.join(", ")}`);
  if (show.date && task.due_on) parts.push(!done && isOverdue(task.due_on) ? `Overdue, was due ${formatDate(task.due_on)}` : `Due ${formatDate(task.due_on)}`);
  if (show.checklist && task.checklist.length) parts.push(`Checklist: ${task.checklist.filter((c) => c.done).length} of ${task.checklist.length} done`);
  if (show.comments && task.commentCount) parts.push(task.commentCount === 1 ? "1 comment" : `${task.commentCount} comments`);
  if (show.givenTo) {
    const person = project.members.find((m) => m.id === task.assignee_person_id);
    const session = project.sessions.find((c) => c.id === task.assignee_session_id);
    if (person) parts.push(`Given to ${person.display_name}`);
    else if (session) parts.push(task.picked_up_at ? `Given to ${session.name}, which has it` : `Given to ${session.name}, waiting for it`);
    else if (!done && task.ended_session) parts.push(`Was given to ${task.ended_session}, which has ended`);
  }
  return parts.join(". ");
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
    // The darker blue buttons use: white text on it reads at 4.5:1 (#203).
    <Badge className="border-transparent bg-primary font-medium text-primary-foreground hover:bg-primary/90">
      Team is waiting on you
    </Badge>
  );
}

/** The Needs review mark: orange, Apple's color for "look at this". */
/** "Check this": indigo, apart from the orange that warns something's wrong (an ended session, remote control off). */
export function NeedsReview() {
  return (
    <Badge className="border-transparent font-medium text-white hover:opacity-90" style={{ background: "var(--sys-indigo)" }}>
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
