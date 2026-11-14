import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpDown, ChevronLeft, MoreHorizontal, Plus, Search, Settings, SlidersHorizontal } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/base/select";
import { useApp, go, useAddressValue } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { addTask, deleteTask, loadProject, moveTask, organize, renumberTasks, type ProjectData, type Status, type Task } from "@/lib/data";
import { inOrder, placeAt } from "@/lib/board-rules";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Announcements,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Badge } from "@/components/ui/badge";
import { TaskRow } from "@/components/TaskRow";
import { TaskCard } from "@/components/TaskCard";
import { TaskDialog } from "@/components/TaskDialog";
import { ProjectSettings, usesClaude } from "@/components/ProjectSettings";
import { Sessions } from "@/components/Sessions";
import { NavBar } from "@/components/NavBar";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
  const [layout, setLayout] = useStored<"board" | "list">(`omicron.layout.${id}`, "board");
  const [dragging, setDragging] = useState<Task | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  // Bumped to open "Add a task" in the first column (c, or the menu).
  const [addSignal, setAddSignal] = useState(0);
  const board = useRef<HTMLDivElement>(null);
  // The task whose sheet just closed, to give its card focus back.
  const closedTask = useRef<number | null>(null);
  // A new task is typed into the board's first column; from the list, the
  // board comes back first. (A ref, so the key handler always has the latest.)
  const newTask = useRef(() => {});
  newTask.current = () => {
    setLayout("board");
    setAddSignal((n) => n + 1);
  };
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
    // With a mouse, a small move starts a drag, so a click still opens the
    // task. Mouse only: a finger moving over a card is scrolling (#141).
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // On a touch screen, press and hold, so swiping still scrolls.
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
          { id: "new-task", label: "New task", group: ready.name, shortcut: "c", keywords: "add", run: () => newTask.current() },
          { id: "search", label: "Search tasks", group: ready.name, shortcut: "/", keywords: "find filter", run: () => searchBox.current?.focus() },
          { id: "settings", label: "Project settings", group: ready.name, run: () => setSettingsOpen(true) },
          { id: "group-status", label: "Columns by status", group: ready.name, keywords: "group", run: () => setGroupBy("status") },
          { id: "group-topic", label: "Columns by topic", group: ready.name, keywords: "group", run: () => setGroupBy("topic") },
          { id: "show-board", label: "Show as a board", group: ready.name, keywords: "view columns", run: () => setLayout("board") },
          { id: "show-list", label: "Show as a list", group: ready.name, keywords: "view rows", run: () => setLayout("list") },
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
        newTask.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toast = useToast();
  // Deleted tasks hide at once and are deleted for good when their Undo
  // goes away (or straight away if the page closes).
  const [hidden, setHidden] = useState<string[]>([]);
  const pending = useRef(new Map<string, Task>());
  const finishDelete = useCallback(
    (id: string) => {
      const t = pending.current.get(id);
      if (!t) return;
      pending.current.delete(id);
      act(() => deleteTask(db, t)).then(reload);
    },
    [db, act, reload],
  );
  useEffect(() => () => [...pending.current.keys()].forEach(finishDelete), [finishDelete]);
  const undoDelete = (id: string) => {
    if (!pending.current.delete(id)) return false;
    setHidden((h) => h.filter((x) => x !== id));
    return true;
  };
  // The last deleted task, for Cmd/Ctrl+Z.
  const lastDeleted = useRef<string | null>(null);
  const removeTask = (t: Task) => {
    // Focus goes to the card after it in its column (or before it), not
    // to the page, once the sheet has closed.
    const group = groups.find((g) => g.tasks.some((x) => x.id === t.id));
    const i = group ? group.tasks.findIndex((x) => x.id === t.id) : -1;
    closedTask.current = (group?.tasks[i + 1] ?? group?.tasks[i - 1])?.number ?? null;
    setOpenTask(null);
    setHidden((h) => [...h, t.id]);
    pending.current.set(t.id, t);
    lastDeleted.current = t.id;
    toast({
      message: `Deleted #${t.number} ${t.title}`,
      seconds: 10,
      action: { label: "Undo", keys: "Meta+Z Control+Z", run: () => undoDelete(t.id) },
      onGone: () => finishDelete(t.id),
    });
  };
  // Cmd/Ctrl+Z, when not typing: brings back the task just deleted.
  const undoKey = useRef<() => boolean>(() => false);
  undoKey.current = () => {
    const id = lastDeleted.current;
    lastDeleted.current = null;
    if (!id || !undoDelete(id)) return false;
    toast({ message: "Task brought back", seconds: 3 });
    return true;
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "z" || !(e.metaKey || e.ctrlKey) || e.shiftKey || typing(e)) return;
      if (undoKey.current()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  // The board's columns, and the list's groups: statuses or topics.
  const groups: Group[] =
    groupBy === "status"
      ? project.statuses.map((s) => ({
          key: s.id,
          name: s.name,
          status: s,
          topicId: null,
          tasks: inOrder(project.tasks.filter((t) => t.status_id === s.id && matches(t))),
        }))
      : topicColumns(project).map((c) => ({
          key: c.key,
          name: c.name,
          status: null,
          topicId: c.topicId,
          tasks: byStatus(project, project.tasks.filter((t) => t.topic_id === c.topicId && matches(t))),
        }));
  // Found by number, so the dialog follows the task as it reloads.
  const task = project.tasks.find((t) => t.number === openTask) ?? null;

  const onDragStart = (e: DragStartEvent) => {
    dragOn.current = true;
    setDragging(project.tasks.find((t) => t.id === e.active.id) ?? null);
  };
  // Dropped: work out the column (a status or a topic) and
  // the place in it, show it at once, then save.
  const onDragEnd = (e: DragEndEvent) => {
    dragOn.current = false;
    setDragging(null);
    const moved = project.tasks.find((t) => t.id === e.active.id);
    if (!moved || !e.over) return;
    const overTask = project.tasks.find((t) => t.id === e.over!.id);
    // Let go over itself: it stays where it was.
    if (overTask?.id === moved.id) return;
    const col = parseColumn(overTask ? String(e.over.data.current?.column) : String(e.over.id));
    if (!col) return;
    // A status column sets the status; a topic column, the topic.
    const statusId = "statusId" in col ? col.statusId : moved.status_id;
    const topicId = "topicId" in col ? col.topicId : moved.topic_id;
    const sameColumn = "statusId" in col ? moved.status_id === statusId : moved.topic_id === topicId;
    // Places count within a status. In a topic column, a card lands next to
    // the one it's over only when that one has the same status.
    const anchor = overTask && overTask.status_id === statusId ? overTask : undefined;
    let position = moved.position;
    let renumber: { id: string; position: number }[] = [];
    if ("statusId" in col || anchor) {
      const inStatus = (t: Task) => t.status_id === statusId;
      const others = inOrder(project.tasks.filter((t) => inStatus(t) && t.id !== moved.id));
      const column = inOrder(project.tasks.filter(inStatus));
      let at = anchor ? others.findIndex((t) => t.id === anchor.id) : others.length;
      // Dragging down within the same column lands after the card it's over.
      if (anchor && inStatus(moved) && column.indexOf(moved) < column.indexOf(anchor)) at += 1;
      if (at < 0) at = others.length;
      // Dropped where it already is (by its place in the column, so ties count).
      if (sameColumn && inStatus(moved) && column.indexOf(moved) === at) return;
      ({ position, renumber } = placeAt(others, at));
    } else if (sameColumn) return;
    const moves = new Map(renumber.map((r) => [r.id, r.position]));
    setProject({
      ...project,
      tasks: project.tasks.map((t) =>
        t.id === moved.id ? { ...t, status_id: statusId, topic_id: topicId, position } : moves.has(t.id) ? { ...t, position: moves.get(t.id)! } : t,
      ),
    });
    act(async () => {
      if (renumber.length) await renumberTasks(db, renumber);
      await moveTask(db, moved, { statusId, topicId, position });
    }).then(reload);
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
      titleClassName="text-2xl sm:text-3xl"
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
    // The board fills the screen and each column scrolls on its own.
    <main className="flex h-dvh min-h-0 flex-none flex-col">
      {nav}
      <Sessions project={project} onChanged={reload} />
      <RunBar project={project} onChanged={reload} />
      <div className="flex flex-wrap items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pb-2">
        <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
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
        {/* On a phone, Show and Columns fold into one menu beside the search. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" className="size-9 shrink-0 sm:hidden" aria-label="View">
              <SlidersHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5 text-xs text-muted-foreground">Show</div>
            <DropdownMenuRadioGroup value={layout} onValueChange={(v) => setLayout(v as "board" | "list")}>
              <DropdownMenuRadioItem value="board">Board</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="list">List</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{layout === "board" ? "Columns" : "Group by"}</div>
            <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => setGroupBy(v as "status" | "topic")}>
              <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="topic">Topic</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {/* One row that scrolls sideways on a phone; wraps on wider screens. */}
        <div
          role="group"
          aria-label="Filters"
          className="-mx-[max(1rem,env(safe-area-inset-left))] flex w-[calc(100%_+_2*max(1rem,env(safe-area-inset-left)))] items-center gap-1.5 overflow-x-auto px-[max(1rem,env(safe-area-inset-left))] py-0.5 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:p-0 [&>*]:shrink-0"
        >
          {(
            [
              ["mine", "Mine"],
              ["review", "Needs review"],
              ["due", "Due soon"],
            ] as const
          )
            // Needs review is a Claude session's mark: only where it can be.
            .filter(([k]) => k !== "review" || filters.review || usesClaude(project) || project.tasks.some((t) => t.needs_review))
            .map(([k, label]) => (
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
        <Segmented
          className="hidden sm:inline-flex"
          label="Show"
          value={layout}
          options={[
            ["board", "Board"],
            ["list", "List"],
          ]}
          onChange={setLayout}
        />
        <Segmented
          className="hidden sm:inline-flex"
          label={layout === "board" ? "Columns" : "Group by"}
          value={groupBy}
          options={[
            ["status", "Status"],
            ["topic", "Topic"],
          ]}
          onChange={setGroupBy}
        />
      </div>
      {groupBy === "topic" && project.topics.length === 0 && (
        <p className="px-[max(1rem,env(safe-area-inset-left))] pb-2 text-sm text-muted-foreground">
          No topics yet. Topics are another way to sort tasks, like “Joe's to-do”.{" "}
          <Button variant="link" className="h-auto p-0 text-sm" onClick={() => setSettingsOpen(true)}>
            Add topics in Project settings
          </Button>
        </p>
      )}
      {layout === "list" ? (
        <TaskList
          project={project}
          groups={groups}
          showStatus={groupBy === "topic"}
          filtering={filtering}
          onOpen={(t) => setOpenTask(t.number)}
        />
      ) : (
      <>
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
          announcements: sayMoves(project, groups),
        }}
      >
      <ColumnJump groups={groups} board={board} />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={board} className={cn(boardRow, "min-h-0")}>
          {groups.map((g, i) => (
            <Column
              key={g.key}
              addSignal={i === 0 ? addSignal : 0}
              onAddShown={() => setAddSignal(0)}
              project={project}
              status={g.status}
              topicId={g.topicId}
              label={g.name}
              tasks={g.tasks}
              onOpen={(t) => setOpenTask(t.number)}
              onAdded={added}
            />
          ))}
        </div>
        <MoreToTheRight board={board} />
      </div>
        <DragOverlay>
          {dragging && (
            <div className="rotate-1 cursor-grabbing shadow-xl">
              <TaskCard project={project} task={dragging} onOpen={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      </>
      )}
      <TaskDialog
        project={project}
        task={task}
        focusNotes={task !== null && task.number === notesFor}
        onClose={() => {
          closedTask.current = openTask;
          setOpenTask(null);
        }}
        onClosed={() => {
          // Back to the task's card (the board may have redrawn it while the
          // sheet was open, so the browser can't find it by itself).
          const number = closedTask.current;
          const card = number === null ? null : document.querySelector<HTMLElement>(`[aria-label^="#${number} "]`);
          // Without scrolling: a task just moved (to the bottom of Done,
          // say) mustn't drag the board away from where you were (#56).
          card?.focus({ preventScroll: true });
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

/** Columns by topic: one per topic, and "No topic" when any task has none. */
function topicColumns(project: ProjectData): { key: string; topicId: string | null; name: string }[] {
  const cols = project.topics.map((t) => ({ key: t.id, topicId: t.id as string | null, name: t.name }));
  if (cols.length === 0 || project.tasks.some((t) => !t.topic_id)) cols.push({ key: "none", topicId: null, name: "No topic" });
  return cols;
}

/** A topic column's tasks: by their status's place, then their own. */
function byStatus(project: ProjectData, tasks: Task[]): Task[] {
  const at = new Map(project.statuses.map((s, i) => [s.id, i]));
  return [...tasks].sort((a, b) => (at.get(a.status_id) ?? 0) - (at.get(b.status_id) ?? 0) || a.position - b.position || a.number - b.number);
}

function Column({
  project,
  status,
  topicId,
  addSignal,
  onAddShown,
  label,
  tasks,
  onOpen,
  onAdded,
}: {
  project: ProjectData;
  /** A status column, or (null) a topic column, by `topicId`. */
  status: Status | null;
  topicId: string | null;
  /** Set to open "Add a task" here; `onAddShown` once it's open. */
  addSignal: number;
  onAddShown: () => void;
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
  const column = status ? `col|s|${status.id}` : `col|t|${topicId ?? "none"}`;
  // New tasks go into this status; in a topic column, the first status.
  const addTo = status ?? project.statuses[0];
  useEffect(() => {
    if (addSignal > 0) {
      setAdding(true);
      onAddShown();
    }
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
      number = await addTask(db, project, addTo.id, t, topicId);
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
        {status && <ColorDot color={statusColor(status)} />}
        {status ? status.name : label}
        <span className="font-mono font-normal text-muted-foreground">{tasks.length}</span>
        {status?.is_done && (
          <Badge variant="outline" className="ml-auto font-normal">
            Done
          </Badge>
        )}
        {status && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={cn("size-11 shrink-0 text-muted-foreground sm:size-8", !status.is_done && "ml-auto")} aria-label="More for this column">
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
                  <DropdownMenuItem key={by} disabled={tasks.length < 2} onSelect={() =>
                    // The whole status, hidden cards too: numbering only the
                    // ones showing would tie them with the rest (#118).
                    act(async () => (await organize(db, project, project.tasks.filter((t) => t.status_id === status.id), by), onAdded()))
                  }>
                    {text}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </h2>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={setNodeRef}
          // Scrolls on its own when the column is taller than the screen.
          className={cn("-m-0.5 flex min-h-2 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain rounded-lg p-0.5 transition-colors", isOver && "bg-accent/60")}
        >
          {tasks.map((t) => (
            <SortableTask key={t.id} project={project} task={t} column={column} showStatus={!status} onOpen={() => onOpen(t)} />
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

/** What a column id names: a status (`col|s|<id>`) or a topic (`col|t|<id or none>`). */
function parseColumn(id: string): { statusId: string } | { topicId: string | null } | null {
  const [kind, by, which] = id.split("|");
  if (kind !== "col" || !which) return null;
  if (by === "s") return { statusId: which };
  if (by === "t") return { topicId: which === "none" ? null : which };
  return null;
}

/** A card that can be dragged to another place or column. */
function SortableTask({
  project,
  task,
  column,
  showStatus,
  onOpen,
}: {
  project: ProjectData;
  task: Task;
  column: string;
  showStatus: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, data: { column } });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("touch-manipulation", isDragging && "opacity-40")}
      {...listeners}
      // The card inside is the button; this is just its place in the list.
      role="listitem"
      tabIndex={-1}
    >
      {/* How to move it is read with the card, which is what has focus. */}
      <TaskCard project={project} task={task} showStatus={showStatus} describedBy={attributes["aria-describedby"]} onOpen={onOpen} />
    </li>
  );
}

/** A small set of choices side by side, one picked (like iOS's segmented control). */
function Segmented<T extends string>({
  className,
  label,
  value,
  options,
  onChange,
}: {
  className?: string;
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  const labelId = `seg-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span id={labelId} className="text-sm text-muted-foreground">
        {label}
      </span>
      <span role="radiogroup" aria-labelledby={labelId} className="inline-flex rounded-lg bg-muted p-0.5">
        {options.map(([v, name]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "min-h-8 rounded-md px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === v ? "bg-background font-medium shadow-sm" : "text-foreground/75 hover:text-foreground",
            )}
          >
            {name}
          </button>
        ))}
      </span>
    </span>
  );
}

/** Every task in one scrolling list, in groups (statuses or topics). */
function TaskList({
  project,
  groups,
  showStatus,
  filtering,
  onOpen,
}: {
  project: ProjectData;
  groups: Group[];
  showStatus: boolean;
  filtering: boolean;
  onOpen: (t: Task) => void;
}) {
  const shown = groups.filter((g) => g.tasks.length > 0);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      {shown.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">{filtering ? "No tasks match." : "No tasks yet."}</p>
      )}
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {shown.map((g) => (
          <section key={g.key} aria-label={g.name}>
            <h2 className="sticky top-0 z-10 flex min-h-9 items-center gap-2 bg-background px-3 text-[15px] font-semibold sm:text-sm">
              {g.status && <ColorDot color={statusColor(g.status)} />}
              {g.name}
              <span className="font-mono font-normal text-muted-foreground">{g.tasks.length}</span>
            </h2>
            <ul aria-label={g.name} className="divide-y overflow-hidden rounded-xl border">
              {g.tasks.map((t) => (
                <li key={t.id}>
                  <TaskRow project={project} task={t} showStatus={showStatus} onOpen={() => onOpen(t)} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** A board column or list group: a status, or (status null) a topic. */
type Group = { key: string; name: string; status: Status | null; topicId: string | null; tasks: Task[] };

/** Which column is at the board's left edge, and whether more are off to the right. */
function useBoardScroll(board: React.RefObject<HTMLDivElement | null>) {
  const [at, setAt] = useState({ first: 0, more: false });
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const look = () => {
      const cols = [...el.children] as HTMLElement[];
      const left = el.scrollLeft + el.offsetLeft;
      let first = 0;
      cols.forEach((c, i) => {
        if (Math.abs(c.offsetLeft - left) < Math.abs((cols[first]?.offsetLeft ?? 0) - left)) first = i;
      });
      setAt({ first, more: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    };
    look();
    el.addEventListener("scroll", look, { passive: true });
    const seen = new ResizeObserver(look);
    seen.observe(el);
    return () => {
      el.removeEventListener("scroll", look);
      seen.disconnect();
    };
  }, [board]);
  return at;
}

/** On a phone: every column's name and count, tapped to go to it. */
function ColumnJump({ groups, board }: { groups: Group[]; board: React.RefObject<HTMLDivElement | null> }) {
  const { first } = useBoardScroll(board);
  return (
    <nav aria-label="Go to column" className="flex gap-1 overflow-x-auto px-[max(1rem,env(safe-area-inset-left))] pb-2 sm:hidden">
      {groups.map((g, i) => (
        <button
          key={g.key}
          type="button"
          aria-current={i === first ? "true" : undefined}
          onClick={() => (board.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}
          className={cn(
            "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            i === first ? "bg-secondary font-medium" : "text-foreground/75",
          )}
        >
          {g.status && <ColorDot color={statusColor(g.status)} />}
          {g.name}
          <span className="font-mono text-muted-foreground">{g.tasks.length}</span>
        </button>
      ))}
    </nav>
  );
}

/** A fade on the board's right edge while columns are hidden past it. */
function MoreToTheRight({ board }: { board: React.RefObject<HTMLDivElement | null> }) {
  const { more } = useBoardScroll(board);
  if (!more) return null;
  return <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" />;
}

/** What a screen reader hears while a task is moved: its number and title,
 *  the column it's over and its place there, never ids. */
function sayMoves(project: ProjectData, groups: Group[]): Announcements {
  const task = (id: UniqueIdentifier) => project.tasks.find((t) => t.id === id);
  const name = (id: UniqueIdentifier) => {
    const t = task(id);
    return t ? `#${t.number} ${t.title}` : "the task";
  };
  // The column something is over (a card in it, or the column itself), and the place there.
  const where = (over: { id: UniqueIdentifier; data: { current?: { column?: string } } } | null, moved: UniqueIdentifier) => {
    if (!over) return null;
    const col = parseColumn(String(over.data.current?.column ?? over.id));
    if (!col) return null;
    const group = groups.find((g) => ("statusId" in col ? g.status?.id === col.statusId : !g.status && g.topicId === col.topicId));
    if (!group) return null;
    const others = group.tasks.filter((t) => t.id !== moved);
    const at = others.findIndex((t) => t.id === over.id);
    const place = at < 0 ? others.length + 1 : at + 1;
    return `${group.name}, place ${place} of ${others.length + 1}`;
  };
  return {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
    onDragOver: ({ active, over }) => {
      const w = where(over, active.id);
      return w ? `${name(active.id)} is over ${w}.` : `${name(active.id)} is not over a column.`;
    },
    onDragEnd: ({ active, over }) => {
      const w = where(over, active.id);
      return w ? `Dropped ${name(active.id)} in ${w}.` : `${name(active.id)} was put back where it was.`;
    },
    onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled. It's back where it was.`,
  };
}
