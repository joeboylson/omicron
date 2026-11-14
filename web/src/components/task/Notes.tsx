import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Group } from "@/components/Grouped";
import { Markdown } from "@/components/Markdown";
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
  // A team member's question: fixed text, who asks and what; the answer
  // is a comment (#222).
  if (task.question) {
    const q = task.question;
    return (
      <Group title="Question" className={q.open ? "[&>div]:border-[var(--sys-blue)]" : undefined}>
        <div className="grid gap-1 px-4 py-3">
          <span className="text-sm text-muted-foreground" data-testid="asked-by">
            {q.team} team, {q.worker}
          </span>
          <Markdown text={task.notes.replace(/^.* asks[^\n]*:\n\n/, "").replace(/\n\nAnswer with a comment;[^\n]*$/, "")} />
        </div>
      </Group>
    );
  }
  return (
    <Group title={<label htmlFor="task-notes">Notes</label>}>
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
