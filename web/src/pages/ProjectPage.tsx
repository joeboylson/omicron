import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, MessageCircle, Plus, Settings } from "lucide-react";
import { useApp, go } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { addTask, loadProject, type ProjectData, type Status, type Task } from "@/lib/data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TaskCard } from "@/components/TaskCard";
import { TaskDialog } from "@/components/TaskDialog";
import { ProjectSettings } from "@/components/ProjectSettings";
import { Sessions } from "@/components/Sessions";
import { NavBar } from "@/components/NavBar";
import { ColorDot } from "@/components/ColorDot";
import { statusColor } from "@/lib/colors";
import { Chat } from "@/components/Chat";

export function ProjectPage({ id }: { id: string }) {
  const { db, act } = useApp();
  // undefined: still loading. null: not found, or no longer a member.
  const [project, setProject] = useState<ProjectData | null | undefined>(undefined);
  const [openTask, setOpenTask] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [groupBy, setGroupBy] = useStored<"status" | "topic">(`omicron.groupBy.${id}`, "status");
  const [collapsed, setCollapsed] = useStored<string[]>(`omicron.collapsedTopics.${id}`, []);

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
      <NavBar
        title={project.name}
        left={
          <Button variant="ghost" className="gap-0.5 px-2 [&_svg]:size-5" aria-label="Back to Projects" onClick={() => go("/")}>
            <ChevronLeft /> Projects
          </Button>
        }
        right={
          <>
            {project.chatEnabled && (
              <Button variant="ghost" size="icon" aria-label="Chat" onClick={() => setChatOpen(true)}>
                <MessageCircle />
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label="Project settings" onClick={() => setSettingsOpen(true)}>
              <Settings />
            </Button>
          </>
        }
      />
      <Sessions project={project} onChanged={reload} />
      <div className="flex items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pb-2">
        <span id="group-by" className="text-sm text-muted-foreground">
          Group by
        </span>
        <div role="radiogroup" aria-labelledby="group-by" className="inline-flex rounded-lg bg-muted p-0.5">
          {(["status", "topic"] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={groupBy === g}
              onClick={() => setGroupBy(g)}
              className={cn(
                "min-h-8 rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                groupBy === g ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {g === "status" ? "Status" : "Status and topic"}
            </button>
          ))}
        </div>
      </div>
      {groupBy === "status" ? (
        <div className={boardRow}>
          {project.statuses.map((s) => (
            <Column
              key={s.id}
              project={project}
              status={s}
              topicId={null}
              label={s.name}
              tasks={project.tasks.filter((t) => t.status_id === s.id)}
              onOpen={(t) => setOpenTask(t.number)}
              onAdded={reload}
            />
          ))}
        </div>
      ) : (
        <Lanes
          project={project}
          collapsed={collapsed}
          onToggle={(key) => setCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])}
          onOpen={(t) => setOpenTask(t.number)}
          onAdded={reload}
          onSettings={() => setSettingsOpen(true)}
        />
      )}
      <TaskDialog project={project} task={task} onClose={() => setOpenTask(null)} onChanged={reload} />
      <Chat project={project} open={chatOpen && project.chatEnabled} onOpenChange={setChatOpen} />
      <ProjectSettings project={project} open={settingsOpen} onOpenChange={setSettingsOpen} onChanged={reload} />
    </main>
  );
}

const boardRow =
  "flex flex-1 snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] sm:snap-none";

/** A per-viewer setting kept in this browser (it may not be kept, which is fine). */
function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? initial : (JSON.parse(saved) as T);
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {}
  };
  return [value, set];
}

const NO_TOPIC = "none";

/** One row per topic (and one for tasks without a topic), each with the status columns. */
function Lanes({
  project,
  collapsed,
  onToggle,
  onOpen,
  onAdded,
  onSettings,
}: {
  project: ProjectData;
  collapsed: string[];
  onToggle: (key: string) => void;
  onOpen: (t: Task) => void;
  onAdded: () => void;
  onSettings: () => void;
}) {
  const lanes = project.topics.map((t) => ({ key: t.id, topicId: t.id as string | null, name: t.name }));
  if (lanes.length === 0 || project.tasks.some((t) => !t.topic_id)) lanes.push({ key: NO_TOPIC, topicId: null, name: "No topic" });
  return (
    <div className="flex flex-1 flex-col gap-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
      {project.topics.length === 0 && (
        <p className="px-[max(1rem,env(safe-area-inset-left))] text-sm text-muted-foreground">
          No topics yet. Topics group tasks into rows, like “Joe's to-do”.{" "}
          <Button variant="link" className="h-auto p-0 text-sm" onClick={onSettings}>
            Add topics in Project settings
          </Button>
        </p>
      )}
      {lanes.map((lane) => {
        const tasks = project.tasks.filter((t) => t.topic_id === lane.topicId);
        const open = !collapsed.includes(lane.key);
        return (
          <section key={lane.key} aria-label={lane.name} className="flex flex-col">
            <h2 className="px-[max(0.5rem,env(safe-area-inset-left))]">
              <Button
                variant="ghost"
                aria-expanded={open}
                onClick={() => onToggle(lane.key)}
                className="gap-1.5 px-2 text-[17px] font-semibold sm:text-base"
              >
                <ChevronDown className={cn("transition-transform motion-reduce:transition-none", !open && "-rotate-90")} aria-hidden />
                {lane.name}
                <span className="font-mono text-sm font-normal text-muted-foreground">{tasks.length}</span>
              </Button>
            </h2>
            {open && (
              <div className={cn(boardRow, "pb-1")}>
                {project.statuses.map((s) => (
                  <Column
                    key={s.id}
                    project={project}
                    status={s}
                    topicId={lane.topicId}
                    label={`${s.name} in ${lane.name}`}
                    tasks={tasks.filter((t) => t.status_id === s.id)}
                    onOpen={onOpen}
                    onAdded={onAdded}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Column({
  project,
  status,
  topicId,
  label,
  tasks,
  onOpen,
  onAdded,
}: {
  project: ProjectData;
  status: Status;
  topicId: string | null;
  /** What the column is called to screen readers (and tests). */
  label: string;
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
    if (await act(() => addTask(db, project, status.id, t, topicId))) {
      setTitle("");
      onAdded();
    }
  };

  return (
    <section
      aria-label={label}
      className="flex w-[86vw] shrink-0 snap-start flex-col rounded-xl bg-muted/60 p-2 sm:w-72"
    >
      <h2 className="flex min-h-9 items-center gap-2 px-2 pb-1 text-[15px] font-semibold sm:text-sm">
        <ColorDot color={statusColor(status)} />
        {status.name}
        <span className="font-mono font-normal text-muted-foreground">{tasks.length}</span>
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
            aria-label={`New task in ${label}`}
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
