import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus, Settings } from "lucide-react";
import { useApp, go } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { addTask, loadProject, type ProjectData, type Status, type Task } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TaskCard } from "@/components/TaskCard";
import { TaskDialog } from "@/components/TaskDialog";
import { ProjectSettings } from "@/components/ProjectSettings";
import { Sessions } from "@/components/Sessions";

export function ProjectPage({ id }: { id: string }) {
  const { db, act } = useApp();
  // undefined: still loading. null: not found, or no longer a member.
  const [project, setProject] = useState<ProjectData | null | undefined>(undefined);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const reload = useCallback(() => {
    act(async () => setProject(await loadProject(db, id)));
  }, [db, act, id]);
  useEffect(reload, [reload]);
  useChanges(db, id, reload);

  if (project === undefined) return <p className="p-4 text-muted-foreground">Loading…</p>;
  if (project === null) {
    return (
      <main className="p-4">
        <p>This Project doesn't exist, or you're not a member of it.</p>
        <Button variant="link" className="px-0" onClick={() => go("/")}>
          Back to Projects
        </Button>
      </main>
    );
  }

  // Found by number, so the dialog follows the task as it reloads.
  const task = project.tasks.find((t) => t.number === openTask) ?? null;
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 py-3">
        <Button variant="ghost" size="icon" aria-label="Back to Projects" onClick={() => go("/")}>
          <ArrowLeft />
        </Button>
        <h1 className="truncate text-xl font-semibold">{project.name}</h1>
        <Button variant="ghost" size="icon" className="ml-auto" aria-label="Project settings" onClick={() => setSettingsOpen(true)}>
          <Settings />
        </Button>
      </div>
      <Sessions sessions={project.sessions} />
      <div className="flex flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:snap-none">
        {project.statuses.map((s) => (
          <Column
            key={s.id}
            project={project}
            status={s}
            tasks={project.tasks.filter((t) => t.status_id === s.id)}
            onOpen={(t) => setOpenTask(t.number)}
            onAdded={reload}
          />
        ))}
      </div>
      <TaskDialog project={project} task={task} onClose={() => setOpenTask(null)} onChanged={reload} />
      <ProjectSettings project={project} open={settingsOpen} onOpenChange={setSettingsOpen} onChanged={reload} />
    </main>
  );
}

function Column({
  project,
  status,
  tasks,
  onOpen,
  onAdded,
}: {
  project: ProjectData;
  status: Status;
  tasks: Task[];
  onOpen: (t: Task) => void;
  onAdded: () => void;
}) {
  const { db, act } = useApp();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    if (await act(() => addTask(db, project, status.id, t))) {
      setTitle("");
      onAdded();
    }
  };

  return (
    <section
      aria-label={status.name}
      className="flex w-[85vw] shrink-0 snap-center flex-col rounded-lg bg-muted/60 p-2 sm:w-72"
    >
      <h2 className="flex items-center gap-2 px-1 pb-2 text-sm font-semibold">
        {status.name}
        <span className="font-normal text-muted-foreground">{tasks.length}</span>
        {status.is_done && (
          <Badge variant="outline" className="ml-auto font-normal">
            Done
          </Badge>
        )}
      </h2>
      <ul className="flex flex-col gap-2">
        {tasks.map((t) => (
          <li key={t.id}>
            <TaskCard project={project} task={t} onOpen={() => onOpen(t)} />
          </li>
        ))}
      </ul>
      {adding ? (
        <form onSubmit={add} className="mt-2 flex flex-col gap-2">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            placeholder="What needs doing?"
            aria-label={`New task in ${status.name}`}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!title.trim()}>
              Add task
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" size="sm" className="mt-2 justify-start text-muted-foreground" onClick={() => setAdding(true)}>
          <Plus /> Add a task
        </Button>
      )}
    </section>
  );
}
