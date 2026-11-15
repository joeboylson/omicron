import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/base/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/base/select";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { statusColor } from "@/lib/colors";
import { ColorDot } from "@/components/ColorDot";
import { type SectionProps } from "@/components/task/save";
import { DispatchRow } from "@/components/task/DispatchRow";
import { DateField } from "@/components/task/DateField";

const NOBODY = "nobody";
/** Given to: still its ended session's, until given out again. */
const ENDED = "ended";

/** Status, topic, date, who it's given to, and its Dispatch line. */
export function TaskDetails({ project, task, save, onChanged }: SectionProps & { onChanged: () => void }) {
  // Given to's list, opened from the ended-session warning too.
  const [pickingWho, setPickingWho] = useState(false);
  const ended = !task.assignee_session_id && !task.assignee_person_id ? task.ended_session : null;
  return (
    <Group label="Details">
      <Row>
        <Label htmlFor="task-status" className="flex-1 font-normal">
          Status
        </Label>
        <Select value={task.status_id} onValueChange={(v) => save({ status_id: v })}>
          <SelectTrigger id="task-status" className={cn(bare, "w-auto gap-1 text-muted-foreground")}>
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
          <Label htmlFor="task-topic" className="flex-1 font-normal">
            Topic
          </Label>
          <Select value={task.topic_id ?? NOBODY} onValueChange={(v) => save({ topic_id: v === NOBODY ? null : v })}>
            <SelectTrigger id="task-topic" className={cn(bare, "w-auto gap-1 text-muted-foreground")}>
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
        <Label htmlFor="task-date" className="flex-1 font-normal">
          Date
        </Label>
        <DateField id="task-date" value={task.due_on} onChange={(due_on) => save({ due_on })} />
      </Row>
      <Row>
        <Label htmlFor="task-assignee" className="flex-1 font-normal">
          Given to
        </Label>
        <Select
          open={pickingWho}
          onOpenChange={setPickingWho}
          value={
            task.assignee_session_id
              ? `session:${task.assignee_session_id}`
              : task.assignee_person_id
                ? `person:${task.assignee_person_id}`
                : ended
                  ? ENDED
                  : NOBODY
          }
          onValueChange={(v) => {
            if (v === ENDED) return;
            const [kind, id] = v.split(":");
            save({
              assignee_person_id: kind === "person" ? id : null,
              assignee_session_id: kind === "session" ? id : null,
            });
          }}
        >
          <SelectTrigger id="task-assignee" className={cn(bare, "w-auto gap-1 text-muted-foreground")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {/* As on its card: still shown as its ended session's, until given out. */}
            {ended && (
              <SelectItem value={ENDED} disabled className="hidden">
                <span className="flex items-center gap-1.5 text-[var(--orange-text)]">
                  <AlertCircle className="h-4 w-4" aria-hidden /> {ended} (ended)
                </span>
              </SelectItem>
            )}
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
      {task.assignee_session_id && <DispatchRow project={project} task={task} onChanged={onChanged} />}
      {!task.assignee_session_id && !task.assignee_person_id && task.ended_session && (
        <Row className="text-sm text-muted-foreground">
          <AlertCircle className="h-4 w-4 shrink-0 text-[var(--orange-text)]" aria-hidden />
          <span data-testid="ended-session" className="flex-1">
            {task.ended_session} has ended.
          </span>
          <Button variant="ghost" size="sm" className="h-11 shrink-0 text-link sm:h-8" onClick={() => setPickingWho(true)}>
            Give To…
          </Button>
        </Row>
      )}
    </Group>
  );
}
