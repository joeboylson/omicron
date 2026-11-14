import { useRef } from "react";
import { useApp } from "@/lib/app";
import { updateTask, type ProjectData, type Task } from "@/lib/data";

/** A change to a task's own fields, as saved. */
export type TaskChange = Parameters<typeof updateTask>[3];

/**
 * How a task's sheet saves. `save` shows a change at once (the page updates
 * its copy and holds it over reloads), then saves; a failure says so and the
 * reload puts it back. Saves go one after another, in the order made: two
 * quick changes to one field (a date picked, then another) can't land the
 * wrong way round. `change` runs other work (labels, checklist, comments)
 * and reloads once it's done.
 */
export function useTaskSave({
  project,
  task,
  onChanged,
  onPatch,
}: {
  project: ProjectData;
  task: Task;
  onChanged: () => void;
  onPatch: (taskId: string, change: Partial<Task>) => () => void;
}) {
  const { db, act } = useApp();
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  const save = (c: TaskChange) => {
    const done = onPatch(task.id, c);
    const next = saving.current
      .then(() => act(() => updateTask(db, project, task, c)))
      .finally(() => {
        done();
        onChanged();
      });
    saving.current = next.catch(() => {});
    return next;
  };
  const change = async (work: () => Promise<unknown>) => {
    if (await act(work)) onChanged();
  };
  return { save, change };
}

/** What each section of the sheet gets. */
export type SectionProps = {
  project: ProjectData;
  task: Task;
  save: (c: TaskChange) => Promise<unknown>;
  change: (work: () => Promise<unknown>) => Promise<void>;
};
