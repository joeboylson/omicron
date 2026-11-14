import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ChevronDown, User } from "lucide-react";
import { ArrowUpDown, X, Check, CheckCircle2, ChevronLeft, TerminalSquare, MoreHorizontal, Plus, Search, Settings, SlidersHorizontal, Pencil, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/base/select";
import { useApp, go, useAddressValue } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { addStatus, addTopic, deleteStatus, deleteTopic, renameStatus, renameTopic, updateTask, addTask, deleteTask, loadProject, moveTask, putTaskBack, organize, renumberTasks, type ProjectData, type Status, type Task, type Who } from "@/lib/data";
import { usePendingChanges, useUndoableDelete } from "@/lib/pending";
import { dropPlace, inOrder, matches as shows, parseColumn, type ColumnKind } from "@/lib/board-rules";
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
  type DragOverEvent,
  type Announcements,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { Button } from "@/components/base/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { Input } from "@/components/base/input";
import { TaskRow } from "@/components/TaskRow";
import { TaskCard } from "@/components/TaskCard";
import { DateField, TaskDialog } from "@/components/TaskDialog";
import { ProjectSettings, usesClaude } from "@/components/ProjectSettings";
import { Sessions } from "@/components/Sessions";
import { NavBar } from "@/components/NavBar";
import { TopBar } from "@/components/TopBar";
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
import { UndoSteps, type Step } from "@/lib/undo";
import { openCommands, rememberTask } from "@/lib/recent";
import { ShareButton, ShareSheet } from "@/components/ShareSheet";
import { DevView } from "@/components/DevView";
import { RunBar } from "@/components/RunBar";
import { useDev } from "@/lib/dev";
import { ColorDot } from "@/components/ColorDot";
import { statusColor } from "@/lib/colors";
import { BoardSkeleton, LoadFailed } from "@/components/Skeleton";
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
  const [shareOpen, setShareOpen] = useState(false);
  // On a phone: the Project's Claude sessions, in a sheet.
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [notesFor, setNotesFor] = useState<number | null>(null);
  // The Dev view, for the owner of the computer serving the page (?view=dev).
  const [dev] = useDev(db);
  const [viewInAddress, setViewInAddress] = useAddressValue("view");
  const view = dev && viewInAddress === "dev" ? "dev" : "tasks";
  const [groupBy, setGroupBy] = useStored<"status" | "topic" | "person">(`omicron.groupBy.${id}`, "status");
  const [layout, setLayout] = useStored<"board" | "list">(`omicron.layout.${id}`, "board");
  const [dragging, setDragging] = useState<Task | null>(null);
  const [dropHint, setDropHint] = useState<{ column: string; before: string | null } | null>(null);
  const searchBox = useRef<HTMLInputElement>(null);
  // Bumped to open "Add a task" in the first column (c, or the menu).
  const [addSignal, setAddSignal] = useState(0);
  const board = useRef<HTMLDivElement>(null);
  // The task whose sheet just closed, to give its card focus back.
  const closedTask = useRef<number | null>(null);
  // A new task is typed into the board's first column; from the list, the
  // board comes back first. (A ref, so the key handler always has the latest.)
  const newTask = useRef(() => {});
  // Which column "c" adds in: the one focus is in, or the first.
  const [addIn, setAddIn] = useState<string | null>(null);
  newTask.current = () => {
    setLayout("board");
    const here = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("section[data-group]")?.dataset.group ?? null;
    setAddIn(here);
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
    // Half a second's press and hold picks a card up (about a phone's own
    // long press), so a quick touch or a swipe never does (#191).
    useSensor(TouchSensor, { activationConstraint: { delay: 500, tolerance: 8 } }),
    // Space picks a card up (Enter opens it), arrows move it, Space drops it.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  // Changes made on this page that are still being saved: kept applied on
  // top of whatever a reload brings, so the board never jumps back to how
  // things were before the save lands.
  const saving = usePendingChanges();
  const withSaving = (p: ProjectData | null) => saving.over(p);
  // The first load failed: say so in place of the placeholder (#198).
  const [loadFailed, setLoadFailed] = useState(false);
  const reload = useCallback(() => {
    act(async () => setProject(withSaving(await loadProject(db, id)))).then((ok) => setLoadFailed(!ok));
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
          { id: "share", label: "Share", group: ready.name, keywords: "members people add invite link", run: () => setShareOpen(true) },
          { id: "group-status", label: "Columns by status", group: ready.name, keywords: "group", run: () => setGroupBy("status") },
          { id: "group-topic", label: "Columns by topic", group: ready.name, keywords: "group", run: () => setGroupBy("topic") },
          { id: "group-person", label: "Columns by person", group: ready.name, keywords: "group given to who", run: () => setGroupBy("person") },
          { id: "show-board", label: "Show as a board", group: ready.name, keywords: "view columns", run: () => setLayout("board") },
          { id: "show-list", label: "Show as a list", group: ready.name, keywords: "view rows", run: () => setLayout("list") },
          // With a task open: move it to any status from here too.
          ...(() => {
            const open = ready.tasks.find((t) => t.number === openTask);
            if (!open) return [];
            return ready.statuses
              .filter((st) => st.id !== open.status_id)
              .map((st) => ({
                id: `move-${st.id}`,
                label: `Move #${open.number} to ${st.name}`,
                group: `#${open.number} ${open.title}`,
                keywords: "status column",
                run: () =>
                  act(() => updateTask(db, ready, open, { status_id: st.id })).then((ok) => {
                    if (ok) movedTaskRef.current(open, { status_id: st.id });
                    reload();
                  }),
              }));
          })(),
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
  // Changes that can be undone, newest last: each toast's Undo, and Cmd+Z
  // back through several (#210).
  const steps = useRef(new UndoSteps()).current;
  // Set once the Project is loaded: what records a move (for the commands above it).
  const movedTaskRef = useRef<(before: Task, change: Partial<Task>) => void>(() => {});
  // After an Undo: say what came back and show its card.
  const undone = (s: Step | null) => {
    if (!s) return false;
    toast({ message: s.undone, seconds: 4 });
    if (s.task !== undefined) {
      setTimeout(() => document.querySelector<HTMLElement>(`[aria-label^="#${s.task} "]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }), 300);
    }
    return true;
  };
  const remember = (step: Step, onGone?: () => void) => {
    const id = steps.push(step);
    toast({ message: step.label, action: { label: "Undo", keys: "Meta+Z Control+Z", run: () => undone(steps.undo(id)) }, onGone });
  };
  // Deleted tasks hide at once. They're deleted for good 10 seconds after
  // their message goes (closed, or another change's message took its
  // place: Cmd+Z still reaches it meanwhile), or when the page is closed or
  // hidden.
  const { hidden, deletes } = useUndoableDelete<Task>((t) => act(() => deleteTask(db, t)).then(reload));
  const removeTask = (t: Task) => {
    // Focus goes to the card after it in its column (or before it), not
    // to the page, once the sheet has closed.
    const group = groups.find((g) => g.tasks.some((x) => x.id === t.id));
    const i = group ? group.tasks.findIndex((x) => x.id === t.id) : -1;
    closedTask.current = (group?.tasks[i + 1] ?? group?.tasks[i - 1])?.number ?? null;
    setOpenTask(null);
    deletes.delete(t);
    remember({ label: `Deleted #${t.number} ${t.title}`, undone: `Brought back #${t.number} ${t.title}`, task: t.number, undo: () => deletes.undo(t.id) }, () =>
      setTimeout(() => deletes.finish(t.id), 10_000),
    );
  };
  useEffect(() => {
    const away = () => document.visibilityState === "hidden" && deletes.finishAll();
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, [deletes]);
  // Cmd/Ctrl+Z, when not typing: undoes the last change.
  const undoKey = useRef<() => boolean>(() => false);
  undoKey.current = () => undone(steps.undo());
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
  // Opened: remembered, for ⌘K's Recently opened (#234).
  const opened = loaded && openTask !== null ? loaded.tasks.find((t) => t.number === openTask) : undefined;
  useEffect(() => {
    if (loaded && opened) rememberTask({ projectId: loaded.id, project: loaded.name, number: opened.number, title: opened.title });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened?.id]);
  useEffect(() => {
    if (!missing) return;
    toast({ message: `There's no task #${openTask} in this Project (it may have been deleted).` });
    setTaskInAddress(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing]);
  if (project === undefined) {
    return loadFailed ? (
      <main>
        <TopBar here="/" title="Couldn't load this Project" />
        <LoadFailed what="this Project" onRetry={reload} titled />
      </main>
    ) : (
      <BoardSkeleton />
    );
  }
  if (project === null) {
    return (
      <>
        <TopBar here="/" title="Can't open this Project" />
        <main className="mx-auto grid w-full max-w-5xl justify-items-start gap-4 px-[max(1rem,env(safe-area-inset-left))]">
          <p className="max-w-md text-muted-foreground">
            It may have been deleted, or you haven't been added to it. Ask whoever sent you the link to add you.
          </p>
          <Button onClick={() => go("/")}>Back to Projects</Button>
        </main>
      </>
    );
  }

  // Tasks waiting to be deleted (Undo) aren't shown.
  if (hidden.length > 0) project = { ...project, tasks: project.tasks.filter((t) => !hidden.includes(t.id)) };
  // A task moved (to another status, topic or person): say so, with Undo.
  const cur = project;
  const movedTask = (before: Task, change: Partial<Task>) => {
    const name = (id: string | null | undefined) => cur.statuses.find((x) => x.id === id)?.name ?? "";
    const n = before.number;
    let label: string;
    let undoneLabel: string;
    if (change.status_id && change.status_id !== before.status_id) {
      label = `Moved #${n} to ${name(change.status_id)}`;
      undoneLabel = `Moved #${n} back to ${name(before.status_id)}`;
    } else if (change.assignee_session_id && change.assignee_session_id !== before.assignee_session_id) {
      label = `Gave #${n} to ${cur.sessions.find((x) => x.id === change.assignee_session_id)?.name ?? "a session"}`;
      undoneLabel = `Took #${n} back`;
    } else if (change.topic_id !== undefined && change.topic_id !== before.topic_id) {
      label = `Moved #${n} to ${cur.topics.find((x) => x.id === change.topic_id)?.name ?? "No topic"}`;
      undoneLabel = `Moved #${n} back`;
    } else if (change.position !== undefined && change.position !== before.position && (change.status_id ?? before.status_id) === before.status_id) {
      label = `Moved #${n} in ${name(before.status_id)}`;
      undoneLabel = `Moved #${n} back`;
    } else return;
    const back: Partial<Task> = {
      status_id: before.status_id,
      topic_id: before.topic_id,
      position: before.position,
      assignee_person_id: before.assignee_person_id,
      assignee_session_id: before.assignee_session_id,
    };
    remember({
      label,
      undone: undoneLabel,
      task: n,
      undo: () => {
        const done = saving.hold(before.id, back);
        setProject((p) => (p ? { ...p, tasks: p.tasks.map((t) => (t.id === before.id ? { ...t, ...back } : t)) } : p));
        act(() => putTaskBack(db, before.id, back))
          .finally(done)
          .then(reload);
        return true;
      },
    });
  };  movedTaskRef.current = movedTask;

  const filtering = query.trim() !== "" || filters.mine || filters.review || filters.due || filters.label !== null;
  // The filters that are on, by name, each with a way to take it off.
  const onFilters: { key: string; label: string; off: () => void }[] = [
    ...(filters.mine ? [{ key: "mine", label: "Mine", off: () => setFilters({ ...filters, mine: false }) }] : []),
    ...(filters.review ? [{ key: "review", label: "Needs review", off: () => setFilters({ ...filters, review: false }) }] : []),
    ...(filters.due ? [{ key: "due", label: "Due in 7 days", off: () => setFilters({ ...filters, due: false }) }] : []),
    ...(filters.label
      ? [{ key: "label", label: project.labels.find((l) => l.id === filters.label)?.name ?? "A label", off: () => setFilters({ ...filters, label: null }) }]
      : []),
  ];
  const clearFilters = () => {
    setQuery("");
    setFilters({ mine: false, review: false, due: false, label: null });
  };
  const now = Date.now();
  const matches = (t: Task) => shows(t, query, filters, me.personId, now);
  // The board's columns, and the list's groups: statuses or topics.
  const groups: Group[] =
    groupBy === "status"
      ? project.statuses.map((s) => ({
          key: s.id,
          kind: "s" as const,
          ref: s.id,
          name: s.name,
          status: s,
          topicId: null,
          tasks: inOrder(project.tasks.filter((t) => t.status_id === s.id && matches(t))),
        }))
      : groupBy === "topic"
        ? topicColumns(project).map((c) => ({
            key: c.key,
            kind: "t" as const,
            ref: c.topicId,
            name: c.name,
            status: null,
            topicId: c.topicId,
            tasks: byStatus(project, project.tasks.filter((t) => t.topic_id === c.topicId && matches(t))),
          }))
        : personColumns(project, me.personId).map((c) => ({
            key: c.key,
            kind: c.kind,
            ref: c.ref,
            name: c.name,
            status: null,
            topicId: null,
            tasks: byStatus(project, project.tasks.filter((t) => c.has(t) && matches(t))),
          }));
  // Found by number, so the dialog follows the task as it reloads.
  const task = project.tasks.find((t) => t.number === openTask) ?? null;

  // Arrow keys (or j/k/h/l) move between cards on the board: up and down a
  // column, across to the next column. Not while a card is picked up.
  const moveFocus = (e: React.KeyboardEvent) => {
    const step = ({ ArrowDown: [0, 1], j: [0, 1], ArrowUp: [0, -1], k: [0, -1], ArrowRight: [1, 0], l: [1, 0], ArrowLeft: [-1, 0], h: [-1, 0] } as Record<string, [number, number]>)[e.key];
    if (!step || dragOn.current || e.metaKey || e.ctrlKey || e.altKey) return;
    const card = (e.target as HTMLElement).closest<HTMLElement>('[role="button"][aria-label^="#"]');
    const col = card?.closest("section");
    if (!card || !col || !board.current) return;
    const cols = [...board.current.querySelectorAll<HTMLElement>(":scope > section")];
    const cardsIn = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[role="button"][aria-label^="#"]')];
    const here = cardsIn(col);
    const at = here.indexOf(card);
    let to: HTMLElement | undefined;
    if (step[1]) to = here[at + step[1]];
    else {
      // The next column that has cards, at about the same height.
      for (let i = cols.indexOf(col) + step[0]; i >= 0 && i < cols.length && !to; i += step[0]) {
        const there = cardsIn(cols[i]);
        to = there[Math.min(at, there.length - 1)];
      }
    }
    if (!to) return;
    e.preventDefault();
    to.focus();
    to.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const onDragStart = (e: DragStartEvent) => {
    dragOn.current = true;
    setDragging(project.tasks.find((t) => t.id === e.active.id) ?? null);
  };
  // Over another column: where it would land, unless a drop there does
  // nothing. (In its own column the cards make room themselves.)
  const onDragOver = (e: DragOverEvent) => {
    const moved = project.tasks.find((t) => t.id === e.active.id);
    const overTask = e.over ? project.tasks.find((t) => t.id === e.over!.id) : undefined;
    const columnId = e.over ? (overTask ? String(e.over.data.current?.column) : String(e.over.id)) : "";
    const col = parseColumn(columnId);
    const own = moved && e.active.data.current?.column === columnId;
    if (!moved || !col || own || !dropPlace(project.tasks, moved, overTask, col)) return setDropHint(null);
    setDropHint({ column: columnId, before: overTask?.id ?? null });
  };
  // Dropped: work out the column (a status or a topic) and
  // the place in it, show it at once, then save.
  const onDragEnd = (e: DragEndEvent) => {
    dragOn.current = false;
    setDragging(null);
    const moved = project.tasks.find((t) => t.id === e.active.id);
    if (!moved || !e.over) return;
    const overTask = project.tasks.find((t) => t.id === e.over!.id);
    const col = parseColumn(overTask ? String(e.over.data.current?.column) : String(e.over.id));
    if (!col) return;
    const drop = dropPlace(project.tasks, moved, overTask, col);
    if (!drop) return;
    const { statusId, topicId, who, position, renumber } = drop;
    // Held over reloads until saved, so the card can't jump back meanwhile.
    const done = [
      saving.hold(moved.id, { status_id: statusId, topic_id: topicId, position, ...(who && { assignee_person_id: who.person, assignee_session_id: who.session }) }),
      ...renumber.map((r) => saving.hold(r.id, { position: r.position })),
    ];
    setProject(saving.over(project));
    act(async () => {
      if (renumber.length) await renumberTasks(db, renumber);
      await moveTask(db, moved, { statusId, topicId, position, who });
    })
      .finally(() => done.forEach((d) => d()))
      .then(reload);
    // Where it went, in view and focused.
    setTimeout(() => {
      const card = document.querySelector<HTMLElement>(`[aria-label^="#${moved.number} "]`);
      card?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      card?.focus({ preventScroll: true });
    }, 50);
    movedTask(moved, { status_id: statusId, topic_id: topicId, position, ...(who && { assignee_person_id: who.person, assignee_session_id: who.session }) });
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
          {/* ⌘K on a phone: find a task in any Project (#234). */}
          <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Search everything" onClick={openCommands}>
            <Search />
          </Button>
          {view !== "dev" && project.sessions.length > 0 && (
            <Button variant="ghost" size="sm" className="gap-1 px-2 text-muted-foreground sm:hidden" aria-label={`Claude sessions: ${project.sessions.length}`} onClick={() => setSessionsOpen(true)}>
              <TerminalSquare className="h-5 w-5" aria-hidden />
              <span className="tabular-nums">{project.sessions.length}</span>
            </Button>
          )}
          {view !== "dev" && (
            <Button size="sm" className="hidden gap-1 sm:inline-flex" onClick={() => newTask.current()}>
              <Plus className="h-4 w-4" aria-hidden /> New Task
            </Button>
          )}
          <ShareButton project={project} onClick={() => setShareOpen(true)} />
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
        <RunBar project={project} onChanged={reload} machineId={dev.machine_id} />
        <DevView
          project={project}
          dev={dev}
          onChanged={reload}
          onOpenTask={(n) => {
            // Opened on the Tasks view, where its sheet is.
            setViewInAddress(null);
            setOpenTask(n);
          }}
        />
      </main>
    );
  }
  return (
    // The board fills the screen and each column scrolls on its own.
    <main className="flex h-dvh min-h-0 flex-none flex-col">
      {nav}
      {/* Runs live on the Dev side (#192). On a phone, sessions are behind a button in the bar above. */}
      <div className="max-sm:hidden">
        <Sessions project={project} onChanged={reload} onOpenTask={(n) => setOpenTask(n)} />
      </div>
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
            className="h-11 pl-8 sm:h-9"
          />
        </div>
        {/* Filters as chips on a wide screen; below that they fold into the View menu (#229). */}
        <div
          role="group"
          aria-label="Filters"
          className="flex flex-wrap items-center gap-1.5 max-lg:hidden"
        >
          {(
            [
              ["mine", "Mine"],
              ["review", "Needs review"],
              ["due", "Due in 7 days"],
            ] as const
          )
            // Needs review is a Claude session's mark: only where it can be.
            .filter(([k]) => k !== "review" || filters.review || usesClaude(project) || project.tasks.some((t) => t.needs_review))
            .map(([k, label]) => (
            <Button
              key={k}
              variant="ghost"
              size="sm"
              aria-pressed={filters[k]}
              // On: filled, plainly different from off (like iOS filter chips).
              className={cn("h-8 rounded-full border", filters[k] && "border-transparent bg-foreground text-background hover:bg-foreground/90 hover:text-background")}
              onClick={() => setFilters({ ...filters, [k]: !filters[k] })}
            >
              {label}
            </Button>
          ))}
          {project.labels.length > 0 && (
            <Select value={filters.label ?? "any"} onValueChange={(v) => setFilters({ ...filters, label: v === "any" ? null : v })}>
              <SelectTrigger aria-label="Filter by label" className={cn("h-8 w-auto gap-1 rounded-full px-3 text-sm", filters.label && "border-transparent bg-foreground text-background")}>
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
          {/* Not when nothing matches: the message below has its own. */}
          {filtering && (project.tasks.length === 0 || project.tasks.some(matches)) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-link"
              onClick={clearFilters}
            >
              Clear
            </Button>
          )}
        </div>
        <span className="hidden flex-1 sm:block" />
        {/* One View menu: Board or List, and the columns; below a wide screen, the filters too. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="relative size-11 shrink-0 gap-2 p-0 sm:h-9 sm:w-auto sm:px-3" aria-label={filtering ? "View and filters (filtering)" : "View and filters"}>
              <SlidersHorizontal />
              <span className="hidden sm:inline">View</span>
              {filtering && <span aria-hidden className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--sys-blue)] lg:hidden" />}
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
            <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => setGroupBy(v as "status" | "topic" | "person")}>
              <DropdownMenuRadioItem value="status">Status</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="topic">Topic</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="person">Person</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator className="lg:hidden" />
            <div className="px-2 py-1.5 text-xs text-muted-foreground lg:hidden">Filter</div>
            {(
              [
                ["mine", "Mine"],
                ["review", "Needs review"],
                ["due", "Due in 7 days"],
              ] as const
            )
              .filter(([k]) => k !== "review" || filters.review || usesClaude(project) || project.tasks.some((t) => t.needs_review))
              .map(([k, label]) => (
                <DropdownMenuItem
                  key={k}
                  className="lg:hidden"
                  role="menuitemcheckbox"
                  aria-checked={filters[k]}
                  // Stays open, to pick more than one.
                  onSelect={(e) => {
                    e.preventDefault();
                    setFilters({ ...filters, [k]: !filters[k] });
                  }}
                >
                  <span className="flex-1">{label}</span>
                  {filters[k] && <Check className="h-4 w-4" aria-hidden />}
                </DropdownMenuItem>
              ))}
            {project.labels.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="lg:hidden">{filters.label ? `Label: ${project.labels.find((l) => l.id === filters.label)?.name ?? ""}` : "Any label"}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={filters.label ?? "any"} onValueChange={(v) => setFilters({ ...filters, label: v === "any" ? null : v })}>
                    <DropdownMenuRadioItem value="any">Any label</DropdownMenuRadioItem>
                    {project.labels.map((l) => (
                      <DropdownMenuRadioItem key={l.id} value={l.id}>
                        {l.name}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {filtering && (
              <DropdownMenuItem className="text-link lg:hidden" onSelect={clearFilters}>
                Clear filters
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {groupBy === "topic" && project.topics.length === 0 && (
        <p className="px-[max(1rem,env(safe-area-inset-left))] pb-2 text-sm text-muted-foreground">
          No topics yet. Topics are another way to sort tasks, like “Joe's to-do”.{" "}
          <Button variant="link" className="h-auto p-0 text-sm" onClick={() => setSettingsOpen(true)}>
            Add topics in Project settings
          </Button>
        </p>
      )}
      {/* On a phone the filter chips live in the View and filters menu: the
          ones that are on show here, each taken off with its x (#206). */}
      {onFilters.length > 0 && (
        <div role="group" aria-label="Filters on" className="flex flex-wrap gap-1.5 px-[max(1rem,env(safe-area-inset-left))] pb-2 lg:hidden">
          {onFilters.map((f) => (
            <Button
              key={f.key}
              variant="ghost"
              size="sm"
              className="h-11 gap-1 rounded-full bg-foreground px-3 text-background hover:bg-foreground/90 hover:text-background"
              aria-label={`Stop filtering by ${f.label}`}
              onClick={f.off}
            >
              {f.label} <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ))}
        </div>
      )}
      {/* Searched or filtered to nothing: say so, once, with the way back. */}
      {filtering && project.tasks.length > 0 && !project.tasks.some(matches) && (
        <div role="status" className="flex items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pb-2 text-sm">
          <span className="text-muted-foreground">
            {query.trim()
              ? `No tasks match “${query.trim()}”${onFilters.length ? ` (${onFilters.map((f) => f.label).join(", ")})` : ""}.`
              : `No tasks match these filters (${onFilters.map((f) => f.label).join(", ")}).`}
          </span>
          <Button variant="link" className="h-auto p-0 text-sm" onClick={clearFilters}>
            {query.trim() && onFilters.length ? "Clear search and filters" : query.trim() ? "Clear search" : "Clear filters"}
          </Button>
        </div>
      )}
      {layout === "list" ? (
        <TaskList
          project={project}
          groups={groups}
          showStatus={groupBy !== "status"}
          filtering={filtering}
          onOpen={(t) => setOpenTask(t.number)}
        />
      ) : (
      <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={(e) => {
          setDropHint(null);
          onDragEnd(e);
        }}
        onDragCancel={() => {
          dragOn.current = false;
          setDragging(null);
          setDropHint(null);
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
        <DropHint.Provider value={dropHint}>
        <div ref={board} className={cn(boardRow, "min-h-0", dragging && "snap-none")} onKeyDown={moveFocus}>
          {groups.map((g, i) => (
            <Column
              key={g.key}
              groupKey={g.key}
              addSignal={(addIn ? g.key === addIn : i === 0) ? addSignal : 0}
              onAddShown={() => setAddSignal(0)}
              project={project}
              kind={g.kind}
              refId={g.ref}
              status={g.status}
              topicId={g.topicId}
              label={g.name}
              tasks={g.tasks}
              onOpen={(t) => setOpenTask(t.number)}
              onAdded={added}
            />
          ))}
          {(groupBy === "status" || groupBy === "topic") && <NewColumn project={project} topic={groupBy === "topic"} onAdded={reload} />}
        </div>
        </DropHint.Provider>
        <MoreToTheRight board={board} />
      </div>
        <DragOverlay>
          {dragging && (
            <div className="rotate-1 cursor-grabbing opacity-90 shadow-xl">
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
          const before = project.tasks.find((t) => t.id === taskId);
          if (before) movedTask(before, change);
          const done = saving.hold(taskId, change);
          setProject((p) => (p ? { ...p, tasks: p.tasks.map((t) => (t.id === taskId ? { ...t, ...change } : t)) } : p));
          // Called when the save is done (saved or not): stop holding it.
          return done;
        }}
      />
      <ProjectSettings project={project} open={settingsOpen} onOpenChange={setSettingsOpen} onChanged={reload} />
      <ShareSheet project={project} open={shareOpen} onOpenChange={setShareOpen} onChanged={reload} />
      <Dialog open={sessionsOpen} onOpenChange={setSessionsOpen}>
        <DialogContent className="max-h-[92dvh] gap-4 overflow-y-auto" onOpenAutoFocus={focusSheet}>
          <DialogHeader className="text-left">
            <DialogTitle>Claude sessions</DialogTitle>
            <DialogDescription className="sr-only">This Project's Claude sessions.</DialogDescription>
          </DialogHeader>
          <Sessions project={project} onChanged={reload} onOpenTask={(n) => (setSessionsOpen(false), setOpenTask(n))} inSheet />
        </DialogContent>
      </Dialog>
    </main>
  );
}

/** While a card is dragged over another column: that column, and the card
 *  it would go before (null: at the end), to draw where it lands. */
const DropHint = createContext<{ column: string; before: string | null } | null>(null);

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
  groupKey,
  kind,
  refId,
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
  /** Its group's key ("c" adds in the column focus is in). */
  groupKey: string;
  /** What the column groups by, and which one (see Group). */
  kind: Group["kind"];
  refId: string | null;
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
  const toast = useToast();
  const addFromMenu = useRef(false);
  const [adding, setAdding] = useState(false);
  // Closed (Escape, Cancel): focus goes back to its Add a task, not the page.
  const addButton = useRef<HTMLButtonElement>(null);
  const wasAdding = useRef(false);
  useEffect(() => {
    if (wasAdding.current && !adding && !document.querySelector('[role="dialog"]')) addButton.current?.focus();
    wasAdding.current = adding;
  }, [adding]);
  // Who it's for and when, picked in the add form; and what was just added.
  const [forWho, setForWho] = useState<Who | undefined>(undefined);
  const [due, setDue] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  // The box grows with what's typed, and shrinks back once it's added.
  const titleBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = titleBox.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title, adding]);
  const column = `col|${kind}|${refId ?? "none"}`;
  // New tasks go into this status; in a topic column, the first status.
  const addTo = status ?? project.statuses[0];
  useEffect(() => {
    if (addSignal > 0) {
      setAdding(true);
      onAddShown();
    }
  }, [addSignal]);
  const { setNodeRef } = useDroppable({ id: column });
  // A topic column's topic (renamed or deleted from its menu).
  const topic = kind === "t" && refId ? (project.topics.find((t) => t.id === refId) ?? null) : null;
  // Every task in it, not only the ones a search or filter shows: only an
  // empty column can be deleted.
  const inColumn = project.tasks.filter((t) => (status ? t.status_id === status.id : topic ? t.topic_id === topic.id : false)).length;
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const rename = () => {
    const n = newName.trim();
    setRenaming(false);
    if (!n || n === (status ? status.name : topic?.name)) return;
    act(() => (status ? renameStatus(db, status, n) : renameTopic(db, topic!, n))).then(() => onAdded());
  };
  const hint = useContext(DropHint);
  const landing = hint?.column === column ? hint : null;
  // Whether the list has more below what's shown.
  const list = useRef<HTMLUListElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const seen = new ResizeObserver(check);
    seen.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      seen.disconnect();
    };
  }, [tasks.length]);

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
      // Given to whoever was picked; in a person's or session's column, them.
      const who = forWho ?? (kind === "p" ? { person: refId, session: null } : kind === "c" ? { person: null, session: refId } : undefined);
      number = await addTask(db, project, addTo.id, t, topicId, who, due);
    });
    setSaving(false);
    if (ok) {
      // Only if it's still what was sent (more may have been typed since).
      setTitle((now) => (now.trim() === t ? "" : now));
      setForWho(undefined);
      setDue(null);
      // Said, and shown: the new card scrolls into view once it's there.
      setJustAdded(number ?? null);
      onAdded(number, open);
      if (!open && number !== undefined) {
        setTimeout(() => document.querySelector<HTMLElement>(`[aria-label^="#${number} "]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 400);
      }
    }
  };

  return (
    <section
      // The whole column takes a drop, header to Add a task (the list itself
      // is only as tall as its cards).
      ref={setNodeRef}
      aria-label={label}
      data-group={groupKey}
      className={cn("flex min-h-0 w-[86vw] shrink-0 snap-start flex-col rounded-xl bg-muted/60 p-2 transition-colors sm:w-72", landing && "bg-accent/80")}
    >
      <h2 className="relative flex min-h-9 items-center gap-2 px-2 pb-1 text-[0.9375rem] font-semibold sm:text-sm">
        {/* On a phone the strip above names the column: here, only for
            screen readers, with its ⋯ (#231). */}
        <span className={cn("flex min-w-0 items-center gap-2", !renaming && "max-sm:sr-only")}>
        {status && <ColorDot color={statusColor(status)} />}
        {renaming ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              rename();
            }}
          >
            <Input
              autoFocus
              aria-label="Column name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setRenaming(false);
                }
              }}
              className="h-8"
            />
          </form>
        ) : (
          (status ? status.name : label)
        )}
        {!renaming && <span className="font-normal tabular-nums text-muted-foreground">{tasks.length}</span>}
        </span>
        {status?.is_done && (
          <span className="relative ml-auto text-[var(--sys-green)]" title="Tasks here count as done">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            <span className="sr-only">Tasks here count as done</span>
          </span>
        )}
        {(status || topic) && !renaming && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className={cn("size-11 shrink-0 text-muted-foreground sm:size-8", !status?.is_done && "ml-auto")} aria-label="More for this column">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            // Adding from here: focus goes to the new task's box, not back to ⋯.
            onCloseAutoFocus={(e) => {
              if (addFromMenu.current) {
                e.preventDefault();
                titleBox.current?.focus();
              }
              addFromMenu.current = false;
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                addFromMenu.current = true;
                setAdding(true);
              }}
            >
              <Plus /> Add a task here
            </DropdownMenuItem>
            {status && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={tasks.length < 2}>
                <ArrowUpDown /> Sort by
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(
                  [
                    ["number", "Number"],
                    ["name", "Name"],
                    ["due", "Date"],
                    ["assignee", "Who it's given to"],
                  ] as const
                ).map(([by, text]) => (
                  <DropdownMenuItem
                    key={by}
                    onSelect={() =>
                      // The whole status, hidden cards too: numbering only the
                      // ones showing would tie them with the rest (#118).
                      // It reorders the column for good, so it can be undone.
                      act(async () => {
                        const before = await organize(db, project, project.tasks.filter((t) => t.status_id === status.id), by);
                        onAdded();
                        toast({
                          message: `${status.name} sorted by ${text.toLowerCase()}`,
                          seconds: 8,
                          action: { label: "Undo", run: () => void act(() => renumberTasks(db, before)).then(() => onAdded()) },
                        });
                      })
                    }
                  >
                    {text}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            )}
            {/* The column itself, changed where it is (HIG settings #7). */}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setNewName(status ? status.name : (topic?.name ?? ""));
                setRenaming(true);
              }}
            >
              <Pencil /> Rename Column
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={inColumn > 0 || !!status?.is_done}
              onSelect={() => act(() => (status ? deleteStatus(db, status) : deleteTopic(db, topic!))).then(() => onAdded())}
            >
              <Trash2 /> Delete Column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        )}
      </h2>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul
          ref={list}
          // As tall as its cards, so Add a task follows the last one; when
          // the column is taller than the screen it scrolls up and down on
          // its own, with a fade at the bottom while there's more (#205).
          // Only up and down is kept in: a sideways swipe over the cards
          // passes to the board, to move between columns (#190).
          className={cn(
            "-m-0.5 flex min-h-2 flex-initial flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-y-contain rounded-lg p-0.5",
            more && "[mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]",
          )}
        >
          {tasks.map((t) => (
            <Fragment key={t.id}>
              {landing?.before === t.id && <DropLine />}
              <SortableTask project={project} task={t} column={column} showStatus={!status} onOpen={() => onOpen(t)} />
            </Fragment>
          ))}
          {landing && landing.before === null && <DropLine />}
        </ul>
      </SortableContext>
      {adding ? (
        <form onSubmit={add} className="mt-2 flex flex-col gap-2">
          <span role="status" className="sr-only">
            {justAdded !== null && `Added #${justAdded}.`}
          </span>
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
          {/* Who and when, set as it's added (or later, in the task). */}
          <div className="flex flex-wrap gap-1.5">
            <WhoChip project={project} value={forWho} onChange={setForWho} />
            <DateField
              value={due}
              onChange={setDue}
              none="No date"
              className="h-11 gap-1 rounded-full border bg-background px-3 text-xs font-normal text-muted-foreground sm:h-8"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!title.trim() || saving} aria-label="Add task">
              {saving ? "Adding…" : "Add task"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!title.trim() || saving} onClick={(e) => add(e, true)}>
              Add and open
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button ref={addButton} variant="ghost" size="sm" className="mt-2 justify-start text-muted-foreground" onClick={() => setAdding(true)}>
          <Plus /> Add a task
        </Button>
      )}
    </section>
  );
}

/** A card that can be dragged to another place or column. */
/** At the end of the board: a new column (a status, or a topic when the
 *  board is by topic), named in place. */
function NewColumn({ project, topic, onAdded }: { project: ProjectData; topic: boolean; onAdded: () => void }) {
  const { db, act } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const add = async () => {
    const n = name.trim();
    if (!n) return setOpen(false);
    if (await act(() => (topic ? addTopic(db, project, n) : addStatus(db, project, n)))) {
      setName("");
      setOpen(false);
      onAdded();
    }
  };
  return (
    <div className="w-[86vw] shrink-0 snap-start sm:w-72">
      {open ? (
        <form
          className="rounded-xl bg-muted/60 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input
            autoFocus
            aria-label={topic ? "New topic" : "New column"}
            placeholder={topic ? "Topic name" : "Column name"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setOpen(false))}
          />
          <div className="mt-2 flex gap-2">
            <Button type="submit" size="sm" disabled={!name.trim()}>
              Add
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" className="w-full justify-start gap-2 text-muted-foreground" onClick={() => setOpen(true)}>
          <Plus /> {topic ? "New Topic" : "New Column"}
        </Button>
      )}
    </div>
  );
}

/** Where a dragged card will land in another column. */
function DropLine() {
  return <li aria-hidden className="mx-1 h-1 rounded-full bg-primary" />;
}

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
  // A finger held on the card: it starts to lift (cleared when the finger
  // lifts or moves, as a scroll does) (#204). Its own listeners, so the
  // drag's aren't disturbed.
  const [pressing, setPressing] = useState(false);
  const item = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    const el = item.current;
    if (!el) return;
    let from: { x: number; y: number } | null = null;
    const start = (e: TouchEvent) => {
      from = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setPressing(true);
    };
    const move = (e: TouchEvent) => {
      if (from && Math.hypot(e.touches[0].clientX - from.x, e.touches[0].clientY - from.y) > 8) stop();
    };
    const stop = () => {
      from = null;
      setPressing(false);
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", stop);
    el.addEventListener("touchcancel", stop);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", stop);
      el.removeEventListener("touchcancel", stop);
    };
  }, []);
  return (
    <li
      ref={(el) => {
        setNodeRef(el);
        item.current = el;
      }}
      data-pressing={pressing && !isDragging ? "" : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // No text selection or iPhone callout on a long press (it picks the
      // card up instead), and while held the card starts to lift, so it's
      // clear holding on does something (#204).
      className={cn(
        "touch-manipulation select-none [-webkit-touch-callout:none] [&>*]:transition-[transform,box-shadow] [&>*]:duration-500 [&>*]:ease-out [&[data-pressing]>*]:scale-[1.03] [&[data-pressing]>*]:shadow-lg motion-reduce:[&>*]:transition-none",
        isDragging && "opacity-40",
      )}
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
        !filtering && <p className="py-8 text-center text-sm text-muted-foreground">No tasks yet.</p>
      )}
      <div className="flex max-w-4xl flex-col gap-4">
        {shown.map((g) => (
          <section key={g.key} aria-label={g.name}>
            <h2 className="sticky top-0 z-10 flex min-h-9 items-center gap-2 bg-background px-3 text-[0.9375rem] font-semibold sm:text-sm">
              {g.status && <ColorDot color={statusColor(g.status)} />}
              {g.name}
              <span className="font-normal tabular-nums text-muted-foreground">{g.tasks.length}</span>
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
/** A board column or list group: a status (s), topic (t), person (p) or
 *  Claude session (c); `ref` is its id (null: none of them). */
type Group = { key: string; kind: ColumnKind; ref: string | null; name: string; status: Status | null; topicId: string | null; tasks: Task[] };

/** Columns by who it's given to: you first, the other members, Claude
 *  sessions that have tasks, then Nobody. */
function personColumns(project: ProjectData, me: string) {
  const people = [...project.members].sort((a, b) => Number(b.id === me) - Number(a.id === me) || a.display_name.localeCompare(b.display_name));
  return [
    ...people.map((m) => ({ key: `p${m.id}`, kind: "p" as const, ref: m.id as string | null, name: m.display_name, has: (t: Task) => t.assignee_person_id === m.id })),
    ...project.sessions
      .filter((s) => project.tasks.some((t) => t.assignee_session_id === s.id))
      .map((s) => ({ key: `c${s.id}`, kind: "c" as const, ref: s.id as string | null, name: s.name, has: (t: Task) => t.assignee_session_id === s.id })),
    { key: "nobody", kind: "p" as const, ref: null, name: "Nobody", has: (t: Task) => !t.assignee_person_id && !t.assignee_session_id },
  ];
}

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
            "flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.9375rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            i === first ? "bg-secondary font-medium" : "text-foreground/75",
          )}
        >
          {g.status && <ColorDot color={statusColor(g.status)} />}
          {g.name}
          <span className="tabular-nums text-muted-foreground">{g.tasks.length}</span>
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
    const group = groups.find((g) => g.kind === col.kind && g.ref === col.ref);
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

/** Who a new task is for: a member, or anyone (not given to anyone yet). */
function WhoChip({ project, value, onChange }: { project: ProjectData; value: Who | undefined; onChange: (w: Who | undefined) => void }) {
  const { me } = useApp();
  const people = [...project.members].sort((a, b) => Number(b.id === me.personId) - Number(a.id === me.personId) || a.display_name.localeCompare(b.display_name));
  const name = value?.person ? (project.members.find((m) => m.id === value.person)?.display_name ?? "Someone") : "Anyone";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="h-11 gap-1 rounded-full border bg-background px-3 text-xs font-normal text-muted-foreground sm:h-8" aria-label={`For: ${name}`}>
          <User className="h-3.5 w-3.5" aria-hidden /> {name}
          <ChevronDown className="h-4 w-4 opacity-50" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={value?.person ?? ""} onValueChange={(v) => onChange(v ? { person: v, session: null } : undefined)}>
          <DropdownMenuRadioItem value="">Anyone</DropdownMenuRadioItem>
          {people.map((m) => (
            <DropdownMenuRadioItem key={m.id} value={m.id}>
              {m.display_name}
              {m.id === me.personId && <span className="text-muted-foreground"> (you)</span>}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
