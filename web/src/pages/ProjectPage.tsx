import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpDown, ChevronDown, ChevronLeft, MoreHorizontal, Plus, Search, Settings } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/base/select";
import { useApp, go, useAddressValue } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { addTask, deleteTask, loadProject, moveTask, organize, positionBetween, type ProjectData, type Status, type Task } from "@/lib/data";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Badge } from "@/components/ui/badge";
import { TaskCard } from "@/components/TaskCard";
import { TaskDialog } from "@/components/TaskDialog";
import { ProjectSettings } from "@/components/ProjectSettings";
import { Sessions } from "@/components/Sessions";
import { NavBar } from "@/components/NavBar";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GateButton } from "@/components/GateButton";
import { DevView } from "@/components/DevView";
import { RunBar } from "@/components/RunBar";
import { useDev } from "@/lib/dev";
import { ColorDot } from "@/components/ColorDot";
import { statusColor } from "@/lib/colors";
import { BoardSkeleton } from "@/components/Skeleton";
import { useToast } from "@/lib/toast";
import { typing, useCommands } from "@/lib/commands";

export function ProjectPage({ id }: { id: string }) {
  const { db, act, me } = useApp();
  // undefined: still loading. null: not found, or no longer a member.
  const [loaded, setProject] = useState<ProjectData | null | undefined>(undefined);
  // The open task is in the address (?task=6): reloading keeps it open, a
  // link opens it, and Back closes it.
  const [taskInAddress, setTaskInAddress] = useAddressValue("task");
  const openTask = taskInAddress && /^\d+$/.test(taskInAddress) ? Number(taskInAddress) : null;
  const setOpenTask = useCallback(
    (n: number | null) => {
      if (n === null) {
        // Opened here: Back takes the step off. Opened from a link: just drop it.
        if (window.history.state?.omicronTask) window.history.back();
        else setTaskInAddress(null);
      } else {
        setTaskInAddress(String(n), true);
        window.history.replaceState({ omicronTask: n }, "", window.location.href);
      }
    },
    [setTaskInAddress],
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notesFor, setNotesFor] = useState<number | null>(null);
  // The Dev view, for the owner of the computer serving the page (?view=dev).
  const [dev] = useDev(db);
  const [viewInAddress, setViewInAddress] = useAddressValue("view");
  const view = dev && viewInAddress === "dev" ? "dev" : "tasks";
  const [groupBy, setGroupBy] = useStored<"status" | "topic">(`omicron.groupBy.${id}`, "status");
  const [collapsed, setCollapsed] = useStored<string[]>(`omicron.collapsedTopics.${id}`, []);
  const [dragging, setDragging] = useState<Task | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  // Bumped to open "Add a task" in the first column (c, or the menu).
  const [addSignal, setAddSignal] = useState(0);
  // Search and filters (not kept: a fresh look each visit).
  // The search is in the address too.
  const [queryInAddress, setQueryInAddress] = useAddressValue("q");
  const query = queryInAddress ?? "";
  const setQuery = (q: string) => setQueryInAddress(q);
  const [filters, setFilters] = useState<{ mine: boolean; review: boolean; due: boolean; label: string | null }>({
    mine: false,
    review: false,
    due: false,
    label: null,
  });
  const sensors = useSensors(
    // A small move starts a drag, so a click still opens the task.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // On a phone, press and hold, so scrolling still works.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    // Space picks a card up (Enter opens it), arrows move it, Space drops it.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  // Changes made on this page that are still being saved: kept applied on
  // top of whatever a reload brings, so the board never jumps back to how
  // things were before the save lands.
  const saving = useRef(new Map<string, { change: Partial<Task>; count: number }>());
  const withSaving = (p: ProjectData | null) =>
    p && saving.current.size > 0
      ? { ...p, tasks: p.tasks.map((t) => (saving.current.has(t.id) ? { ...t, ...saving.current.get(t.id)!.change } : t)) }
      : p;
  const reload = useCallback(() => {
    act(async () => setProject(withSaving(await loadProject(db, id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, act, id]);
  useEffect(reload, [reload]);
  useChanges(db, id, reload);
  let project = loaded;
  const ready = loaded ?? null;
  useCommands(
    "project",
    ready
      ? [
          { id: "new-task", label: "New task", group: ready.name, shortcut: "c", keywords: "add", run: () => setAddSignal((n) => n + 1) },
          { id: "search", label: "Search tasks", group: ready.name, shortcut: "/", keywords: "find filter", run: () => searchBox.current?.focus() },
          { id: "settings", label: "Project settings", group: ready.name, run: () => setSettingsOpen(true) },
          { id: "group-status", label: "Group by status", group: ready.name, keywords: "columns", run: () => setGroupBy("status") },
          { id: "group-topic", label: "Group by status and topic", group: ready.name, keywords: "rows lanes", run: () => setGroupBy("topic") },
          ...ready.tasks.map((t) => ({
            id: `task-${t.id}`,
            label: `#${t.number} ${t.title}`,
            group: "Tasks",
            keywords: "open task",
            run: () => setOpenTask(t.number),
          })),
        ]
      : [],
  );
  // Single-key shortcuts, when not typing and nothing else is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e) || document.querySelector('[role="dialog"]')) return;
      if (e.key === "/") {
        e.preventDefault();
        searchBox.current?.focus();
      } else if (e.key === "c") {
        e.preventDefault();
        setAddSignal((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toast = useToast();
  // Deleted tasks hide at once and are deleted for good a few seconds
  // later, unless Undo is pressed (or straight away if the page closes).
  const [hidden, setHidden] = useState<string[]>([]);
  const pending = useRef(new Map<string, { task: Task; timer: ReturnType<typeof setTimeout> }>());
  const finishDelete = useCallback(
    (id: string) => {
      const p = pending.current.get(id);
      if (!p) return;
      clearTimeout(p.timer);
      pending.current.delete(id);
      act(() => deleteTask(db, p.task)).then(reload);
    },
    [db, act, reload],
  );
  useEffect(() => () => [...pending.current.keys()].forEach(finishDelete), [finishDelete]);
  const removeTask = (t: Task) => {
    setOpenTask(null);
    setHidden((h) => [...h, t.id]);
    pending.current.set(t.id, { task: t, timer: setTimeout(() => finishDelete(t.id), 6000) });
    toast({
      message: `Deleted #${t.number} ${t.title}`,
      action: {
        label: "Undo",
        run: () => {
          const p = pending.current.get(t.id);
          if (p) clearTimeout(p.timer);
          pending.current.delete(t.id);
          setHidden((h) => h.filter((x) => x !== t.id));
        },
      },
    });
  };

  // On a phone, a finger that moves after press-and-hold would otherwise be
  // taken by the browser as scrolling, which cancels the drag. While a drag
  // is on, moves are the drag's. (The listener can only stop scrolling if
  // it's there, not passive, before the finger goes down.)
  const dragOn = useRef(false);
  useEffect(() => {
    const hold = (e: TouchEvent) => {
      if (dragOn.current && e.cancelable) e.preventDefault();
    };
    window.addEventListener("touchmove", hold, { passive: false });
    return () => window.removeEventListener("touchmove", hold);
  }, []);
  // A link to a task that isn't there (deleted, or a wrong number): say so
  // and drop it from the address.
  const missing = loaded && openTask !== null && !loaded.tasks.some((t) => t.number === openTask);
  useEffect(() => {
    if (!missing) return;
    toast({ message: `There's no task #${openTask} in this Project (it may have been deleted).` });
    setTaskInAddress(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);
  if (project === undefined) return <BoardSkeleton />;
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

  // Tasks waiting to be deleted (Undo) aren't shown.
  if (hidden.length > 0) project = { ...project, tasks: project.tasks.filter((t) => !hidden.includes(t.id)) };
  const filtering = query.trim() !== "" || filters.mine || filters.review || filters.due || filters.label !== null;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const soon = Date.now() + 7 * 86400000;
  const matches = (t: Task) =>
    words.every((w) => `#${t.number} ${t.title} ${t.notes}`.toLowerCase().includes(w)) &&
    (!filters.mine || t.assignee_person_id === me.personId) &&
    (!filters.review || t.needs_review) &&
    (!filters.due || (t.due_on !== null && new Date(t.due_on).getTime() <= soon)) &&
    (filters.label === null || t.labelIds.includes(filters.label));
  // Found by number, so the dialog follows the task as it reloads.
  const task = project.tasks.find((t) => t.number === openTask) ?? null;

  const onDragStart = (e: DragStartEvent) => {
    dragOn.current = true;
    setDragging(project.tasks.find((t) => t.id === e.active.id) ?? null);
  };
  // Dropped: work out the column (a status, and a topic in topic rows) and
  // the place in it, show it at once, then save.
  const onDragEnd = (e: DragEndEvent) => {
    dragOn.current = false;
    setDragging(null);
    const moved = project.tasks.find((t) => t.id === e.active.id);
    if (!moved || !e.over) return;
    const overTask = project.tasks.find((t) => t.id === e.over!.id);
    const col = parseColumn(overTask ? String(e.over.data.current?.column) : String(e.over.id));
    if (!col) return;
    const inColumn = (t: Task) => t.status_id === col.statusId && (col.topicId === undefined || t.topic_id === col.topicId);
    const others = project.tasks.filter((t) => inColumn(t) && t.id !== moved.id).sort((a, b) => a.position - b.position);
    let at = overTask ? others.findIndex((t) => t.id === overTask.id) : others.length;
    // Dragging down within the same column lands after the card it's over.
    if (overTask && inColumn(moved) && moved.position < overTask.position) at += 1;
    if (at < 0) at = others.length;
    const position = positionBetween(others[at - 1]?.position, others[at]?.position);
    if (inColumn(moved) && (others[at - 1]?.position ?? -Infinity) < moved.position && moved.position < (others[at]?.position ?? Infinity)) {
      return; // Already there.
    }
    const topicId = col.topicId === undefined ? moved.topic_id : col.topicId;
    setProject({
      ...project,
      tasks: project.tasks.map((t) => (t.id === moved.id ? { ...t, status_id: col.statusId, topic_id: topicId, position } : t)),
    });
    act(() => moveTask(db, moved, { statusId: col.statusId, topicId: col.topicId, position })).then(reload);
  };
  // Added with Shift+Enter: open it, straight into its notes (#72).
  const added = (number?: number, open?: boolean) => {
    if (!open || number === undefined) return reload();
    // Opened once it's loaded (an open task the page doesn't have is dropped).
    act(async () => {
      setProject(withSaving(await loadProject(db, id)));
      setNotesFor(number);
      setOpenTask(number);
    });
  };
  const nav = (
    <NavBar
      title={project.name}
      left={
        <Button variant="ghost" className="gap-0.5 px-2 [&_svg]:size-5" aria-label="Back to Projects" onClick={() => go("/")}>
          <ChevronLeft /> Projects
        </Button>
      }
      right={
        <>
          {dev && (
            <div role="radiogroup" aria-label="View" className="mr-1 flex rounded-lg bg-muted p-0.5 text-sm">
              {(
                [
                  ["tasks", "Tasks"],
                  ["dev", "Dev"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={view === v}
                  className={cn("rounded-md px-2.5 py-1", view === v ? "bg-background font-medium shadow-sm" : "text-foreground/75")}
                  onClick={() => setViewInAddress(v === "dev" ? "dev" : null)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <GateButton />
          <Button variant="ghost" size="icon" aria-label="Project settings" onClick={() => setSettingsOpen(true)}>
            <Settings />
          </Button>
        </>
      }
    />
  );
  if (view === "dev" && dev) {
    return (
      <main className="flex h-dvh min-h-0 flex-col">
        {nav}
        <RunBar project={project} onChanged={reload} />
        <DevView project={project} dev={dev} onChanged={reload} />
      </main>
    );
  }
  return (
    // By status, the board fills the screen and each column scrolls on its
    // own; by topic, the page scrolls through the rows.
    <main className={cn("flex min-h-0 flex-col", groupBy === "status" ? "h-dvh flex-none" : "flex-1")}>
      {nav}
      <Sessions project={project} onChanged={reload} />
      <RunBar project={project} onChanged={reload} />
      <div className="flex flex-wrap items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pb-2">
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={searchBox}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
            className="h-9 pl-8"
          />
        </div>
        <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ["mine", "Mine"],
              ["review", "Needs review"],
              ["due", "Due soon"],
            ] as const
          ).map(([k, label]) => (
            <Button
              key={k}
              variant={filters[k] ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={filters[k]}
              className={cn("h-8 rounded-full border", filters[k] && "border-transparent")}
              onClick={() => setFilters({ ...filters, [k]: !filters[k] })}
            >
              {label}
            </Button>
          ))}
          {project.labels.length > 0 && (
            <Select value={filters.label ?? "any"} onValueChange={(v) => setFilters({ ...filters, label: v === "any" ? null : v })}>
              <SelectTrigger aria-label="Filter by label" className={cn("h-8 w-auto gap-1 rounded-full px-3 text-sm", filters.label && "bg-secondary")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any label</SelectItem>
                {project.labels.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {filtering && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-link"
              onClick={() => {
                setQuery("");
                setFilters({ mine: false, review: false, due: false, label: null });
              }}
            >
              Clear
            </Button>
          )}
        </div>
        <span className="hidden flex-1 sm:block" />
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
                groupBy === g ? "bg-background font-medium shadow-sm" : "text-foreground/75 hover:text-foreground",
              )}
            >
              {g === "status" ? "Status" : "Status and topic"}
            </button>
          ))}
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          dragOn.current = false;
          setDragging(null);
        }}
        accessibility={{
          screenReaderInstructions: {
            draggable: "To move this task, press Space. Use the arrow keys to move it, Space again to drop it, or Escape to cancel. Enter opens it.",
          },
        }}
      >
      {groupBy === "status" ? (
        <div className={cn(boardRow, "min-h-0")}>
          {project.statuses.map((s, i) => (
            <Column
              key={s.id}
              addSignal={i === 0 ? addSignal : 0}
              project={project}
              status={s}
              topicId={null}
              grouped={false}
              label={s.name}
              tasks={project.tasks.filter((t) => t.status_id === s.id && matches(t))}
              onOpen={(t) => setOpenTask(t.number)}
              onAdded={added}
            />
          ))}
        </div>
      ) : (
        <Lanes
          project={project}
          matches={matches}
          addSignal={addSignal}
          collapsed={collapsed}
          onToggle={(key) => setCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key])}
          onOpen={(t) => setOpenTask(t.number)}
          onAdded={added}
          onSettings={() => setSettingsOpen(true)}
        />
      )}
        <DragOverlay>
          {dragging && (
            <div className="rotate-1 cursor-grabbing shadow-xl">
              <TaskCard project={project} task={dragging} onOpen={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      <TaskDialog
        project={project}
        task={task}
        focusNotes={task !== null && task.number === notesFor}
        onClose={() => {
          // Back to the task's card (the board may have redrawn it while the
          // sheet was open, so the browser can't find it by itself).
          const number = openTask;
          setOpenTask(null);
          setTimeout(() => {
            const card = number === null ? null : document.querySelector<HTMLElement>(`[aria-label^="#${number} "]`);
            // Without scrolling: a task just moved (to the bottom of Done,
            // say) mustn't drag the board away from where you were (#56).
            card?.focus({ preventScroll: true });
          }, 0);
        }}
        onChanged={reload}
        onDelete={removeTask}
        onPatch={(taskId, change) => {
          const now = saving.current.get(taskId);
          saving.current.set(taskId, { change: { ...now?.change, ...change }, count: (now?.count ?? 0) + 1 });
          setProject((p) => (p ? { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, ...change } : t)) } : p));
          // Called when the save is done (saved or not): stop holding it.
          return () => {
            const held = saving.current.get(taskId);
            if (held && --held.count <= 0) saving.current.delete(taskId);
          };
        }}
      />
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
  matches,
  addSignal,
  collapsed,
  onToggle,
  onOpen,
  onAdded,
  onSettings,
}: {
  project: ProjectData;
  /** Search and filters: which tasks show. */
  matches: (t: Task) => boolean;
  addSignal: number;
  collapsed: string[];
  onToggle: (key: string) => void;
  onOpen: (t: Task) => void;
  onAdded: (number?: number, open?: boolean) => void;
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
        const tasks = project.tasks.filter((t) => t.topic_id === lane.topicId && matches(t));
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
                {project.statuses.map((s, i) => (
                  <Column
                    addSignal={i === 0 && lane === lanes[0] ? addSignal : 0}
                    key={s.id}
                    project={project}
                    status={s}
                    topicId={lane.topicId}
                    grouped
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
  grouped,
  addSignal,
  label,
  tasks,
  onOpen,
  onAdded,
}: {
  project: ProjectData;
  status: Status;
  topicId: string | null;
  /** In topic rows: dropping here also sets the topic. */
  grouped: boolean;
  /** Bumped to open "Add a task" here. */
  addSignal: number;
  /** What the column is called to screen readers (and tests). */
  label: string;
  tasks: Task[];
  onOpen: (t: Task) => void;
  /** A task was added: its number, and whether to open it (Shift+Enter). */
  onAdded: (number?: number, open?: boolean) => void;
}) {
  const { db, act } = useApp();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  // The box grows with what's typed, and shrinks back once it's added.
  const titleBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleBox.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title, adding]);
  const column = columnId(status.id, topicId, grouped);
  useEffect(() => {
    if (addSignal > 0) setAdding(true);
  }, [addSignal]);
  const { setNodeRef, isOver } = useDroppable({ id: column });

  // One add at a time: while it's on its way (it may wait for the
  // connection), pressing Add again mustn't add it twice.
  const [saving, setSaving] = useState(false);
  const add = async (e: React.FormEvent, open = false) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || saving) return;
    setSaving(true);
    let number: number | undefined;
    const ok = await act(async () => {
      number = await addTask(db, project, status.id, t, topicId);
    });
    setSaving(false);
    if (ok) {
      // Only if it's still what was sent (more may have been typed since).
      setTitle((now) => (now.trim() === t ? "" : now));
      onAdded(number, open);
    }
  };

  return (
    <section
      aria-label={label}
      className="flex min-h-0 w-[86vw] shrink-0 snap-start flex-col rounded-xl bg-muted/60 p-2 sm:w-72"
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={cn("size-11 shrink-0 text-muted-foreground sm:size-7", !status.is_done && "ml-auto")} aria-label="More for this column">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowUpDown /> Organize
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(
                  [
                    ["number", "By number"],
                    ["name", "By name"],
                    ["assignee", "By who it's given to"],
                  ] as const
                ).map(([by, text]) => (
                  <DropdownMenuItem key={by} disabled={tasks.length < 2} onSelect={() => act(async () => (await organize(db, project, tasks, by), onAdded()))}>
                    {text}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </h2>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          // Scrolls on its own when the column is taller than the screen.
          className={cn("-m-0.5 flex min-h-2 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg p-0.5 transition-colors", isOver && "bg-accent/60")}
        >
          {tasks.map((t) => (
            <SortableTask key={t.id} project={project} task={t} column={column} onOpen={() => onOpen(t)} />
          ))}
        </ul>
      </SortableContext>
      {adding ? (
        <form onSubmit={add} className="mt-2 flex flex-col gap-2">
          <Textarea
            autoFocus
            rows={1}
            value={title}
            // A title is one line: what's typed wraps, and a pasted line
            // break becomes a space.
            ref={titleBox}
            onChange={(e) => setTitle(e.target.value.replace(/[\r\n]+/g, " "))}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAdding(false);
              // Enter adds it and keeps going; Shift+Enter adds it and opens it.
              if (e.key === "Enter" && !e.nativeEvent.isComposing) add(e, e.shiftKey);
            }}
            placeholder="What needs doing?"
            aria-label={`New task in ${label}`}
            className="min-h-9 w-full resize-none overflow-hidden bg-background py-2 [field-sizing:content] [overflow-wrap:anywhere]"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!title.trim() || saving} aria-label="Add task">
              {saving ? "Adding…" : "Add task"}
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

/** A column's id: its status, and in topic rows its topic ("none" for no topic). */
function columnId(statusId: string, topicId: string | null, grouped: boolean): string {
  return grouped ? `col|${statusId}|${topicId ?? "none"}` : `col|${statusId}`;
}

function parseColumn(id: string): { statusId: string; topicId?: string | null } | null {
  const [kind, statusId, topic] = id.split("|");
  if (kind !== "col" || !statusId) return null;
  return topic === undefined ? { statusId } : { statusId, topicId: topic === "none" ? null : topic };
}

/** A card that can be dragged to another place or column. */
function SortableTask({ project, task, column, onOpen }: { project: ProjectData; task: Task; column: string; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { column } });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation", isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
      // The card inside is the button; this is just its place in the list.
      role="listitem"
      tabIndex={-1}
    >
      <TaskCard project={project} task={task} onOpen={onOpen} />
    </li>
  );
}
