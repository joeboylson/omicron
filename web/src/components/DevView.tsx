import { useState } from "react";
import { Confirm } from "@/components/base/confirm";
import { Folder as FolderIcon, LogOut, Plus, Terminal as TerminalIcon, Undo2, X } from "lucide-react";
import { useApp } from "@/lib/app";
import { devAction, type Dev } from "@/lib/dev";
import type { Folder, ProjectData, Task } from "@/lib/data";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Terminal } from "@/components/Terminal";
import { ComputerPanel } from "@/components/ComputerPanel";
import { cn } from "@/lib/utils";
import { GripVertical } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate, initials, LabelBadge, NeedsReview } from "@/components/TaskCard";
import type { Color } from "@/lib/colors";

const TASK = "application/x-omicron-task";

/**
 * A Project's Dev view, for the owner of the computer serving the page
 * (ref/BRAINSTORM.md, "Two views of a Project"). Left: its folders and
 * sessions on this computer. Middle: sessions as terminal tabs. Right: the
 * board as a list, by column; drag a task onto a session to hand it over
 * here (or pick the session in the task's row).
 */
export function DevView({
  project,
  dev,
  onChanged,
  onOpenTask,
}: {
  project: ProjectData;
  dev: Dev;
  onChanged: () => void;
  onOpenTask?: (number: number) => void;
}) {
  const { db, act } = useApp();
  // A task being dragged: sessions here show they'll take it.
  const [carrying, setCarrying] = useState(false);
  const here = project.sessions.filter((s) => s.machine_id === dev.machine_id).sort((a, b) => a.name.localeCompare(b.name));
  const folders = project.folders.filter((f) => f.machine_id === dev.machine_id);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // On a phone, one pane at a time: the list, the terminal, or the tasks.
  const [pane, setPane] = useState<"sessions" | "terminal" | "tasks">("sessions");
  const open = (name: string) => {
    setTabs((t) => (t.includes(name) ? t : [...t, name]));
    setActive(name);
    setPane("terminal");
  };
  const close = (name: string) => {
    const rest = tabs.filter((t) => t !== name);
    setTabs(rest);
    if (active === name) setActive(rest[rest.length - 1] ?? null);
  };
  const give = (task: Task, sessionId: string) =>
    act(async () => {
      await devAction(db, "/give", { task_id: task.id, session_id: sessionId });
      onChanged();
    });
  const done = new Set(project.statuses.filter((s) => s.is_done).map((s) => s.id));
  const [said, setSaid] = useState<string | null>(null);
  const [ending, setEnding] = useState<string | null>(null);
  const openIn = (folderId: string) =>
    act(async () => {
      const r = await devAction(db, "/open", { folder_id: folderId });
      onChanged();
      if (r?.session) open(r.session);
    });
  const end = (name: string) =>
    act(async () => {
      setEnding(null);
      const r = await devAction(db, "/end", { session: name });
      setSaid(r?.said ?? null);
      close(name);
      onChanged();
    });
  const handOff = (name: string) =>
    act(async () => {
      const r = await devAction(db, "/handoff", { session: name });
      setSaid(r?.said ?? null);
    });

  return (
    <>
    <div role="radiogroup" aria-label="Show" className="mx-[max(1rem,env(safe-area-inset-left))] mb-2 grid grid-cols-3 rounded-lg bg-muted p-0.5 lg:hidden">
      {(
        [
          ["sessions", "Sessions"],
          ["terminal", "Terminal"],
          ["tasks", "Tasks"],
        ] as const
      ).map(([p, label]) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={pane === p}
          onClick={() => setPane(p)}
          className={cn(
            "min-h-9 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            pane === p ? "bg-background font-medium shadow-sm" : "text-foreground/75",
          )}
        >
          {label}
          {p === "terminal" && tabs.length > 0 && <span className="ml-1 tabular-nums text-muted-foreground">{tabs.length}</span>}
        </button>
      ))}
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-px border-t bg-border lg:grid-cols-[15rem_minmax(0,1fr)_19rem] lg:grid-rows-1">
      <aside aria-label="Folders and sessions" className={cn("flex flex-col overflow-y-auto bg-background p-3 text-sm", pane !== "sessions" && "max-lg:hidden")}>
        <h2 className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Folders <span className="normal-case tracking-normal">on {dev.machine}</span>
        </h2>
        {folders.length === 0 ? (
          <p className="px-1 pb-1 text-muted-foreground">No folders yet.</p>
        ) : (
          <ul className="pb-3">
            {folders.map((f) => (
              <li key={f.id} className="group flex items-center gap-2 rounded px-1 py-1" title={f.path}>
                <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {/* Its name first; the rest of the path dimmed, cut from the start (like VS Code's Recent). */}
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
                  <span className="min-w-0 shrink truncate font-medium">{folderParts(f.path).name}</span>
                  <span className="min-w-0 shrink-[999] truncate text-xs text-muted-foreground [direction:rtl]">
                    <bdi>{folderParts(f.path).parent}</bdi>
                  </span>
                </span>
                <button
                  type="button"
                  className="flex min-h-11 shrink-0 items-center gap-1 rounded px-1.5 py-1 text-xs text-link hover:bg-muted lg:min-h-0"
                  aria-label={`Open a new session in ${f.path}`}
                  onClick={() => openIn(f.id)}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden /> New session
                </button>
              </li>
            ))}
          </ul>
        )}
        <AddFolder />
        <h2 className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sessions</h2>
        {here.length === 0 ? (
          <p className="px-1 text-muted-foreground">No sessions running here.</p>
        ) : (
          <ul aria-label="Sessions">
            {here.map((s) => (
              <li
                key={s.id}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(TASK)) {
                    e.preventDefault();
                    setOver(s.id);
                  }
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => {
                  setOver(null);
                  const task = project.tasks.find((t) => t.id === e.dataTransfer.getData(TASK));
                  if (task) give(task, s.id);
                }}
              >
                <button
                  type="button"
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted lg:min-h-9",
                    active === s.name && "bg-secondary",
                    over === s.id && "ring-2 ring-[var(--sys-blue)]",
                    carrying && over !== s.id && "ring-1 ring-dashed ring-[var(--sys-blue)]",
                  )}
                  onClick={() => open(s.name)}
                  title={`${s.folder}: open its terminal`}
                >
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--sys-green)" }} />
                  {/* Its name, then where and what it's doing. */}
                  <span className="grid min-w-0">
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground" data-testid={`doing-${s.name}`}>
                      {sessionDoing(project, s, done)}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                    {project.tasks.filter((t) => t.assignee_session_id === s.id && !done.has(t.status_id)).length || ""}
                  </span>
                </button>
                <Notes notes={project.handoffs.filter((h) => h.session_id === s.id)} />
              </li>
            ))}
          </ul>
        )}
        {/* This computer is the machine itself, not a session: set apart at the bottom. */}
        <div className="mt-auto border-t pt-2">
          <ComputerPanel project={project} dev={dev} onChanged={onChanged} />
        </div>
      </aside>

      <section aria-label="Terminals" className={cn("flex min-h-0 min-w-0 flex-col bg-background", pane !== "terminal" && "max-lg:hidden")}>
        <div role="tablist" aria-label="Open sessions" className="flex shrink-0 overflow-x-auto border-b bg-muted">
          {tabs.map((name) => (
            <div key={name} className={cn("flex items-center", active === name ? "bg-background text-foreground" : "text-muted-foreground")}>
              <button role="tab" type="button" aria-selected={active === name} className="flex h-9 items-center gap-1.5 pl-3 pr-1 text-sm" onClick={() => setActive(name)}>
                <TerminalIcon className="h-3.5 w-3.5" aria-hidden />
                {name}
              </button>
              <button type="button" className="relative mr-1 rounded p-1 hover:bg-accent after:absolute after:-inset-2.5 after:content-[''] lg:after:inset-0" aria-label={`Close ${name}'s tab (it keeps running)`} onClick={() => close(name)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <NewTab
            sessions={here.map((s) => s.name).filter((n) => !tabs.includes(n))}
            folders={folders}
            onOpen={open}
            onNew={openIn}
          />
        </div>
        {active && (
          <div className="flex shrink-0 items-center gap-1 border-b bg-background px-2 py-1 text-xs text-muted-foreground">
            <button
              type="button"
              className="flex min-h-11 items-center gap-1 rounded px-3 py-1 hover:bg-accent hover:text-foreground lg:min-h-0 lg:px-2"
              onClick={() => handOff(active)}
              title="Ask it for its handoff note, then clear: a fresh conversation picks up from the note"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden /> Hand off
            </button>
            <button
              type="button"
              className="ml-4 flex min-h-11 items-center gap-1 rounded px-3 py-1 text-destructive hover:bg-destructive/10 lg:ml-2 lg:min-h-0 lg:px-2"
              onClick={() => setEnding(active)}
              title="Quit Claude, which ends the session"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden /> End
            </button>
          </div>
        )}
        {said && (
          <p role="status" className="shrink-0 truncate border-b bg-background px-3 py-1 text-xs text-muted-foreground">
            {said}
          </p>
        )}
        {tabs.length === 0 && (
          <p className="m-auto max-w-xs p-6 text-center text-sm text-muted-foreground">Pick a session to open its terminal here. Closing a tab leaves it running.</p>
        )}
        {tabs.map((name) => (
          <Terminal key={name} session={name} active={active === name} />
        ))}
        <Confirm
          open={ending !== null}
          onOpenChange={(o) => !o && setEnding(null)}
          title={`End ${ending ?? ""}?`}
          sentence="Claude quits in it, which ends the session."
          action="End Session"
          onConfirm={() => ending && end(ending)}
        />
      </section>

      <aside aria-label="Tasks by column" className={cn("overflow-y-auto bg-background p-3 text-sm", pane !== "tasks" && "max-lg:hidden")}>
        {project.statuses.map((st) => {
          const tasks = project.tasks.filter((t) => t.status_id === st.id).sort((a, b) => a.position - b.position);
          return (
            <section key={st.id} aria-label={st.name} className="pb-3">
              <h2 className="flex items-center gap-2 px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {st.name} <span className="tabular-nums">{tasks.length}</span>
              </h2>
              <ul>
                {tasks.map((t) => {
                  const isDone = done.has(t.status_id);
                  const person = project.members.find((m) => m.id === t.assignee_person_id);
                  const session = project.sessions.find((x) => x.id === t.assignee_session_id);
                  const labels = project.labels.filter((l) => t.labelIds.includes(l.id));
                  return (
                    <li
                      key={t.id}
                      draggable={here.length > 0 && !isDone}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(TASK, t.id);
                        e.dataTransfer.effectAllowed = "link";
                        setCarrying(true);
                      }}
                      onDragEnd={() => setCarrying(false)}
                      className="group flex items-start gap-1.5 rounded px-1 py-1 hover:bg-muted"
                    >
                      {/* A grip: it can be dragged onto a session. */}
                      {here.length > 0 && !isDone ? (
                        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 cursor-grab text-muted-foreground/60" aria-hidden />
                      ) : (
                        <span className="w-4 shrink-0" />
                      )}
                      <button
                        type="button"
                        className="grid min-w-0 flex-1 gap-1 text-left"
                        onClick={() => onOpenTask?.(t.number)}
                        aria-label={`#${t.number} ${t.title}`}
                      >
                        <span className={cn("break-words", isDone && "text-muted-foreground line-through")}>
                          <span className="mr-1 font-mono text-[11px] text-muted-foreground">#{t.number}</span>
                          {t.title}
                        </span>
                        {(t.needs_review || labels.length > 0 || t.due_on) && (
                          <span className="flex flex-wrap items-center gap-1 text-[11px]">
                            {t.needs_review && <NeedsReview />}
                            {labels.map((l) => (
                              <LabelBadge key={l.id} name={l.name} color={l.color as Color | null} />
                            ))}
                            {t.due_on && <span className="text-muted-foreground">{formatDate(t.due_on)}</span>}
                          </span>
                        )}
                      </button>
                      {/* Who has it, as a chip; or, if nobody here, Hand to… (not on Done). */}
                      {session && here.some((h) => h.id === session.id) ? (
                        <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 font-mono text-[11px]">
                          <TerminalIcon className="h-3 w-3" aria-hidden /> {session.name}
                        </span>
                      ) : !isDone && here.length > 0 ? (
                        <select
                          aria-label={`Hand #${t.number} to a session here`}
                          className="mt-0.5 min-h-11 max-w-28 shrink-0 truncate rounded border-0 bg-transparent text-sm text-link lg:min-h-0 lg:text-[11px]"
                          value=""
                          onChange={(e) => e.target.value && give(t, e.target.value)}
                        >
                          <option value="">{session ? session.name : person ? person.display_name : "Hand to…"}</option>
                          {here.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      ) : person ? (
                        <span className="mt-0.5 shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px]" title={person.display_name}>
                          {initials(person.display_name)}
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </aside>
    </div>
    </>
  );
}

/** A session's past handoff notes, newest first, to read back. */
function Notes({ notes }: { notes: ProjectData["handoffs"] }) {
  if (notes.length === 0) return null;
  return (
    <details className="pb-1 pl-5 text-xs text-muted-foreground">
      <summary className="cursor-pointer py-0.5">
        {notes.length} handoff {notes.length === 1 ? "note" : "notes"}
      </summary>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>
            <details>
              <summary className="cursor-pointer py-0.5">
                <span className="font-mono">#{n.number}</span> {new Date(n.written_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} · {n.state.replace("_", " ")}
              </summary>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px] text-foreground">{n.body}</pre>
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** A session's folder (short name) and what it's on: "omicron · on #8". */
function sessionDoing(project: ProjectData, s: ProjectData["sessions"][number], done: Set<string>): string {
  const folder = s.folder ? s.folder.replace(/\/+$/, "").split("/").pop() : null;
  const mine = project.tasks.filter((t) => t.assignee_session_id === s.id && !done.has(t.status_id));
  const on = mine.find((t) => t.picked_up_at);
  const what = on ? `on #${on.number}` : mine.length ? `${mine.length} waiting` : "free";
  return folder ? `${folder} · ${what}` : what;
}

/** A folder's last part, and the path it's in. */
function folderParts(path: string): { name: string; parent: string } {
  const clean = path.replace(/\/+$/, "");
  const at = clean.lastIndexOf("/");
  return at < 0 ? { name: clean, parent: "" } : { name: clean.slice(at + 1), parent: clean.slice(0, at) || "/" };
}

/** Add a folder: done on this computer, in the folder, with a command to copy. */
function AddFolder() {
  const [copied, setCopied] = useState(false);
  const command = "omicron folders add";
  return (
    <Popover onOpenChange={() => setCopied(false)}>
      <PopoverTrigger asChild>
        <button type="button" className="mb-3 flex items-center gap-1 rounded px-1 py-1 text-xs text-link hover:bg-muted">
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add a folder
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-72 gap-2 text-sm">
        <p>In the folder, on this computer, run:</p>
        <div className="flex items-center gap-2 rounded-md bg-muted py-1 pl-3 pr-1">
          <code className="flex-1 font-mono text-xs">{command}</code>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs hover:bg-background"
            onClick={() => navigator.clipboard?.writeText(command).then(() => setCopied(true), () => {})}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="text-muted-foreground">Opening a Claude session in a folder adds it too.</p>
      </PopoverContent>
    </Popover>
  );
}

/** + at the end of the tabs: a session running here that isn't open yet, or a new one in a folder. */
function NewTab({ sessions, folders, onOpen, onNew }: { sessions: string[]; folders: Folder[]; onOpen: (name: string) => void; onNew: (folderId: string) => void }) {
  if (sessions.length === 0 && folders.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="mx-1 flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Open a terminal">
          <Plus className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {sessions.length > 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">Running here</div>}
        {sessions.map((n) => (
          <DropdownMenuItem key={n} onSelect={() => onOpen(n)}>
            <TerminalIcon /> {n}
          </DropdownMenuItem>
        ))}
        {sessions.length > 0 && folders.length > 0 && <DropdownMenuSeparator />}
        {folders.length > 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">New session in</div>}
        {folders.map((f) => (
          <DropdownMenuItem key={f.id} onSelect={() => onNew(f.id)}>
            <FolderIcon /> {folderParts(f.path).name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

