import { useEffect, useState } from "react";
import { useApp } from "@/lib/app";
import { loadProjectComments, type Comment, type ProjectData, type Status, type Task } from "@/lib/data";
import { ColorDot } from "@/components/ColorDot";
import { Comments } from "@/components/Comments";
import { Markdown } from "@/components/Markdown";
import { TaskRow } from "@/components/TaskRow";
import { when } from "@/components/task/when";
import { statusColor } from "@/lib/colors";

type TreeGroup = { key: string; name: string; status: Status | null; tasks: Task[] };

/**
 * The tree view (#268): each group (status, topic or who it's given to) at
 * the top, its tasks under it, and under each task its notes as a quote and
 * its comments, with a box to add one. Comments are read for the whole
 * Project at once, and again whenever it reloads.
 */
export function TaskTree({
  project,
  groups,
  showStatus,
  filtering,
  onOpen,
  onChanged,
}: {
  project: ProjectData;
  groups: TreeGroup[];
  showStatus: boolean;
  filtering: boolean;
  onOpen: (t: Task) => void;
  onChanged: () => void;
}) {
  const { db, act } = useApp();
  const [comments, setComments] = useState<Map<string, Comment[]>>(new Map());
  useEffect(() => {
    let current = true;
    loadProjectComments(db, project.id).then(
      (c) => current && setComments(c),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [db, project]);
  const change = async (work: () => Promise<unknown>) => {
    if (await act(work)) onChanged();
  };
  const shown = groups.filter((g) => g.tasks.length > 0);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      {shown.length === 0 && !filtering && <p className="py-8 text-center text-sm text-muted-foreground">No tasks yet.</p>}
      <div className="flex max-w-3xl flex-col gap-6">
        {shown.map((g) => (
          <section key={g.key} aria-label={g.name}>
            <h2 className="sticky top-0 z-10 flex min-h-9 items-center gap-2 bg-background px-1 text-[0.9375rem] font-semibold sm:text-sm">
              {g.status && <ColorDot color={statusColor(g.status)} />}
              {g.name}
              <span className="font-normal tabular-nums text-muted-foreground">{g.tasks.length}</span>
            </h2>
            {/* The branches: a line down the side, each task a node off it. */}
            <ul aria-label={g.name} className="ml-2 flex flex-col gap-4 border-l pl-4">
              {g.tasks.map((t) => (
                <li key={t.id} className="flex flex-col gap-2">
                  <div className="overflow-hidden rounded-xl border">
                    <TaskRow project={project} task={t} showStatus={showStatus} onOpen={() => onOpen(t)} />
                  </div>
                  <div className="ml-3 flex flex-col gap-3 border-l pl-4">
                    {t.notes.trim() && (
                      <blockquote aria-label={`Notes of #${t.number}`} className="border-l-2 border-muted-foreground/40 pl-3 text-sm text-muted-foreground">
                        <Markdown text={t.notes} />
                      </blockquote>
                    )}
                    <Comments project={project} task={{ ...t, comments: comments.get(t.id) ?? [] }} change={change} when={when} id={`task-comments-${t.number}`} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
