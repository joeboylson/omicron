import { scrollMotion } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useToast } from "@/lib/toast";
import { ArrowDown, ArrowDownToLine, ArrowRight, ArrowUp, ArrowUpToLine, Check, Link2, ListChecks, MessageSquare, MoreHorizontal, Trash2, Repeat, Plus, Eye, EyeOff } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/base/dropdown-menu";
import { addPlan, addTaskToPlan, renumberTasks, type Task } from "@/lib/data";
import { reorder } from "@/lib/board-rules";
import { useApp } from "@/lib/app";
import { DialogDescription, DialogHeader, DialogTitle } from "@/components/base/dialog";
import { Button } from "@/components/base/button";
import { Textarea } from "@/components/ui/textarea";
import { statusColor } from "@/lib/colors";
import { ColorDot } from "@/components/ColorDot";
import { NeedsReview } from "@/components/TaskCard";
import { type SectionProps } from "@/components/task/save";
import { useWatch, watchers } from "@/components/WatchDialog";

/** The sheet's top: where the task is, its ⋯ menu, its title, and Needs review. */
export function TaskHeader({ project, task, save, change, onDelete }: SectionProps & { onDelete: (task: Task) => void }) {
  const watch = useWatch();
  const toast = useToast();
  const { db } = useApp();
  // Higher or lower in its column without dragging (HIG drag-and-drop #2).
  const places = (
    [
      ["top", "To the Top", ArrowUpToLine],
      ["up", "Move Up", ArrowUp],
      ["down", "Move Down", ArrowDown],
      ["bottom", "To the Bottom", ArrowDownToLine],
    ] as const
  ).map(([to, label, Icon]) => ({ to, label, Icon, place: reorder(project.tasks, task, to) }));
  const putAt = async (place: NonNullable<ReturnType<typeof reorder>>) => {
    if (place.renumber.length) await change(() => renumberTasks(db, place.renumber));
    await save({ position: place.position });
  };
  // Scroll the sheet to a section of it, and put focus there for the keyboard.
  const jump = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: scrollMotion(), block: "start" });
    el?.querySelector<HTMLElement>("input, button, textarea")?.focus({ preventScroll: true });
  };
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
          <span className="tabular-nums">#{task.number}</span> in {project.name}
        </DialogDescription>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              // On a phone, in the same row as the sheet's × (#242).
              className="h-11 w-11 shrink-0 max-sm:absolute max-sm:right-[3.75rem] max-sm:top-3 sm:h-8 sm:w-8"
              aria-label="More for this task"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {done && !isDone && (
              <DropdownMenuItem onSelect={() => save({ status_id: done.id })}>
                <Check /> Mark Done
              </DropdownMenuItem>
            )}
            {/* Moving without dragging (by keyboard, or on a small screen). */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRight /> Move To
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {project.statuses.map((st) => (
                  <DropdownMenuItem key={st.id} disabled={st.id === task.status_id} onSelect={() => save({ status_id: st.id })}>
                    <ColorDot color={statusColor(st)} /> {st.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {places.some((p) => p.place) && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ArrowUp /> Order
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {places.map(({ to, label, Icon, place }) => (
                    <DropdownMenuItem key={to} disabled={!place} onSelect={() => place && putAt(place)}>
                      <Icon /> {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {/* A session checks it each run (#279). */}
            <DropdownMenuItem onSelect={() => watch.open({ taskId: task.id })}>
              <Eye /> Watch With a Session…
            </DropdownMenuItem>
            {watchers(project, { taskId: task.id }).map((w) => (
              <DropdownMenuItem key={w.loop.id + w.index} onSelect={() => watch.stop(w)}>
                <EyeOff /> Stop {w.session.name} Watching
              </DropdownMenuItem>
            ))}
            {/* Into a draft loop, to start later (#253). */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Repeat /> Add to Loop
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {project.plans
                  .filter((p) => !p.template && p.kind === "tasks")
                  .map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      disabled={p.task_ids.includes(task.id)}
                      onSelect={() => change(() => addTaskToPlan(db, p, task.id)).then(() => toast({ message: `Added #${task.number} to the draft loop`, seconds: 3 }))}
                    >
                      {p.name || `${p.task_ids.length} ${p.task_ids.length === 1 ? "task" : "tasks"}`}
                    </DropdownMenuItem>
                  ))}
                <DropdownMenuItem
                  onSelect={() =>
                    change(() => addPlan(db, project, { kind: "tasks", task_ids: [task.id] })).then(() =>
                      toast({ message: `Added #${task.number} to a new draft loop`, seconds: 3 }),
                    )
                  }
                >
                  <Plus /> New Draft Loop
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              onSelect={() => {
                // This page's address, with the task open (?task=n).
                const url = new URL(window.location.href);
                url.searchParams.set("task", String(task.number));
                navigator.clipboard?.writeText(url.toString()).then(
                  () => toast({ message: `Link to #${task.number} copied`, seconds: 3 }),
                  () => toast({ message: "Couldn't copy the link", seconds: 4 }),
                );
              }}
            >
              <Link2 /> Copy Link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDelete(task)}>
              <Trash2 /> Delete Task
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
      {/* On a phone the checklist and comments are far down: say what's there, and jump to it. */}
      {(task.checklist.length > 0 || task.commentCount > 0) && (
        <div className="flex gap-1 text-sm">
          {task.checklist.length > 0 && (
            <button type="button" className="flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1 text-link hover:bg-accent sm:min-h-0" onClick={() => jump("task-checklist")}>
              <ListChecks className="h-4 w-4" aria-hidden />
              <span className="tabular-nums">
                {task.checklist.filter((c) => c.done).length} of {task.checklist.length} done
              </span>
            </button>
          )}
          {task.commentCount > 0 && (
            <button type="button" className="flex min-h-11 items-center gap-1.5 rounded-md px-2 py-1 text-link hover:bg-accent sm:min-h-0" onClick={() => jump("task-comments")}>
              <MessageSquare className="h-4 w-4" aria-hidden />
              <span className="tabular-nums">
                {task.commentCount} {task.commentCount === 1 ? "comment" : "comments"}
              </span>
            </button>
          )}
        </div>
      )}
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
