import { type ProjectData, type Task } from "@/lib/data";
import { Dialog, DialogContent, focusSheet } from "@/components/base/dialog";
import { Comments } from "@/components/Comments";
import { useTaskSave } from "@/components/task/save";
import { TaskHeader } from "@/components/task/Header";
import { TaskDetails } from "@/components/task/Details";
import { TaskLabels } from "@/components/task/Labels";
import { TaskNotes } from "@/components/task/Notes";
import { TaskChecklist } from "@/components/task/Checklist";
import { TeamJobs } from "@/components/task/TeamJobs";
import { when } from "@/components/task/when";

// Used by the board's Add a task too.
export { DateField } from "@/components/task/DateField";

export function TaskDialog({
  project,
  task,
  onClose,
  onClosed,
  onChanged,
  onDelete,
  onPatch,
  focusNotes = false,
}: {
  project: ProjectData;
  task: Task | null;
  /** Opened right after adding it: straight into its notes. */
  focusNotes?: boolean;
  onClose: () => void;
  /** Once it has finished closing: where focus goes next is up to the page. */
  onClosed?: () => void;
  onChanged: () => void;
  /** Delete it (the page keeps an Undo for a few seconds). */
  onDelete: (task: Task) => void;
  /** Show a change at once, before it's saved. */
  /** Show a change at once; returns what to call once its save is done. */
  onPatch: (taskId: string, change: Partial<Task>) => () => void;
}) {
  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:max-w-xl sm:bg-background"
        // Focus the sheet itself, not the title: on a phone a focused title
        // opens the keyboard. Keyboard and screen-reader users start inside.
        onOpenAutoFocus={(e) => {
          const notes = focusNotes ? document.getElementById("task-notes") : null;
          if (notes) {
            e.preventDefault();
            notes.focus();
          } else focusSheet(e);
        }}
        // The board puts focus back on the task's card itself, once the
        // sheet is gone (while it closes, it still holds focus).
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClosed?.();
        }}
      >
        {task && <TaskForm key={task.id} project={project} task={task} onChanged={onChanged} onDelete={onDelete} onPatch={onPatch} />}
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({
  project,
  task,
  onChanged,
  onDelete,
  onPatch,
}: {
  project: ProjectData;
  task: Task;
  onChanged: () => void;
  onDelete: (task: Task) => void;
  /** Show a change at once; returns what to call once its save is done. */
  onPatch: (taskId: string, change: Partial<Task>) => () => void;
}) {
  const { save, change } = useTaskSave({ project, task, onChanged, onPatch });
  const section = { project, task, save, change };
  return (
    <>
      <TaskHeader {...section} onDelete={onDelete} />
      <TaskDetails {...section} onChanged={onChanged} />
      <TeamJobs project={project} task={task} onChanged={onChanged} />
      <TaskLabels {...section} />
      <TaskNotes {...section} />
      <TaskChecklist {...section} />
      <Comments project={project} task={task} change={change} when={when} />
    </>
  );
}
