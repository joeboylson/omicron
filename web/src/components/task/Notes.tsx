import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Group } from "@/components/Grouped";
import { type SectionProps } from "@/components/task/save";

/** The task's notes (or a team member's question, when it's one). */
export function TaskNotes({ task, save }: SectionProps) {
  const [notes, setNotes] = useState(task.notes);
  // Someone else changed them while it's open: show theirs, unless they're being typed in.
  useEffect(() => {
    if (document.activeElement?.id !== "task-notes") setNotes(task.notes);
  }, [task.notes]);
  // Saved a moment after typing stops, and when the sheet closes, not only
  // when the box loses focus, so closing never loses them (#200).
  const latest = useRef({ notes, saved: task.notes, save });
  latest.current = { notes, saved: task.notes, save };
  useEffect(() => {
    if (notes === task.notes) return;
    const t = setTimeout(() => latest.current.save({ notes: latest.current.notes }), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);
  useEffect(
    () => () => {
      const { notes: now, saved, save: saveNow } = latest.current;
      if (now !== saved) saveNow({ notes: now });
    },
    [],
  );
  return (
    <Group
      title={
        <label htmlFor="task-notes">
          {task.question ? `${task.question.worker} in ${task.question.team} asks` : "Notes"}
        </label>
      }
      className={task.question?.open ? "[&>div]:border-[var(--sys-blue)]" : undefined}
    >
      <Textarea
        id="task-notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== task.notes && save({ notes })}
        rows={4}
        placeholder="Add notes"
        className="rounded-none border-0 bg-transparent px-4 focus-visible:ring-0 focus-visible:ring-offset-0"
      />
    </Group>
  );
}
