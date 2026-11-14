import { useEffect, useState } from "react";
import { ArrowRight, Check, MoreHorizontal, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type Task } from "@/lib/data";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/base/dialog";
import { Button } from "@/components/base/button";
import { Textarea } from "@/components/ui/textarea";
import { statusColor } from "@/lib/colors";
import { ColorDot } from "@/components/ColorDot";
import { NeedsReview } from "@/components/TaskCard";
import { type SectionProps } from "@/components/task/save";

/** The sheet's top: where the task is, its ⋯ menu, its title, and Needs review. */
export function TaskHeader({ project, task, save, onDelete }: SectionProps & { onDelete: (task: Task) => void }) {
  const [title, setTitle] = useState(task.title);
  // Someone else changed it while it's open: show theirs, unless it's being typed in.
  useEffect(() => {
    if (document.activeElement?.id !== "task-title") setTitle(task.title);
  }, [task.title]);
  const done = project.statuses.find((s) => s.is_done);
  const isDone = done?.id === task.status_id;
  return (
    <>
    <DialogHeader>
      <div className="flex items-center gap-2 pr-8">
        <DialogDescription className="flex-1 text-left">
          <span className="font-mono">#{task.number}</span> in {project.name}
        </DialogDescription>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="More for this task">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {done && !isDone && (
              <DropdownMenuItem onSelect={() => save({ status_id: done.id })}>
                <Check /> Mark done
              </DropdownMenuItem>
            )}
            {/* Moving without dragging (by keyboard, or on a small screen). */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRight /> Move to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {project.statuses.map((st) => (
                  <DropdownMenuItem key={st.id} disabled={st.id === task.status_id} onSelect={() => save({ status_id: st.id })}>
                    <ColorDot color={statusColor(st)} /> {st.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(task)}>
              <Trash2 /> Delete task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <DialogTitle className="sr-only">{task.title}</DialogTitle>
      <Textarea
        id="task-title"
        aria-label="Title"
        rows={1}
        value={title}
        // One line, wrapped to fit: Enter is done, not a new line.
        onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        onBlur={() => {
          const t = title.trim();
          if (!t) setTitle(task.title);
          else if (t !== task.title) save({ title: t });
        }}
        className="min-h-0 w-full resize-none border-transparent bg-transparent px-0 py-1 [overflow-wrap:anywhere] text-xl font-semibold leading-snug shadow-none [field-sizing:content] focus-visible:border-input focus-visible:bg-background focus-visible:px-3 focus-visible:ring-0 focus-visible:ring-offset-0 md:text-xl"
      />
    </DialogHeader>

    {task.needs_review && (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 text-sm" data-testid="needs-review">
        <NeedsReview />
        <span className="min-w-[12rem] flex-1 text-muted-foreground">A Claude session asked for this to be checked.</span>
        <Button size="sm" variant="outline" onClick={() => save({ needs_review: false })}>
          <Check /> Reviewed
        </Button>
      </div>
    )}

    </>
  );
}
