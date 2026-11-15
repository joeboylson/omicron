import { CopyButton } from "@/components/CopyButton";
import { useState } from "react";
import { Confirm } from "@/components/base/confirm";
import { Folder as FolderIcon, LogOut, Plus, Terminal as TerminalIcon, Undo2, X } from "lucide-react";
import { useApp } from "@/lib/app";
import { devAction, type Dev } from "@/lib/dev";
import type { Folder, ProjectData, Task } from "@/lib/data";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/base/dropdown-menu";
import { Terminal } from "@/components/Terminal";
import { ComputerPanel } from "@/components/ComputerPanel";
import { cn, radioArrows } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/base/popover";

const TASK = "application/x-omicron-task";

/**
 * A Project's Dev view, for the owner of the computer serving the page
 * (ref/BRAINSTORM.md, "Two views of a Project"). Left: its folders and
 * sessions on this computer; right: sessions as terminal tabs. On a phone,
 * one at a time (#250). Tasks are handed over from the Tasks tab (a task's
 * Given to), or dragged onto a session from another window.
 */
export function DevView({
  project,
  dev,
  onChanged,
}: {
  project: ProjectData;
  dev: Dev;
  onChanged: () => void;
}) {
  const { db, act } = useApp();
  // A task being dragged: sessions here show they'll take it.
  const carrying = false;
  const here = project.sessions.filter((s) => s.machine_id === dev.machine_id).sort((a, b) => a.name.localeCompare(b.name));
  const folders = project.folders.filter((f) => f.machine_id === dev.machine_id);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // On a phone, one pane at a time: the list, the terminal, or the tasks.
  const [pane, setPane] = useState<"sessions" | "terminal">("sessions");
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
    <div role="radiogroup" aria-label="Show" className="mx-[max(1rem,env(safe-area-inset-left))] mb-2 grid grid-cols-2 rounded-lg bg-muted p-0.5 lg:hidden">
      {(
        [
          ["sessions", "Sessions"],
          ["terminal", "Terminal"],
        ] as const
      ).map(([p, label]) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={pane === p}
          tabIndex={pane === p ? 0 : -1}
          onKeyDown={radioArrows}
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
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-px border-t bg-border lg:grid-cols-[17rem_minmax(0,1fr)] lg:grid-rows-1">
      <aside aria-label="Folders and sessions" className={cn("flex flex-col overflow-y-auto bg-background p-3 text-sm", pane !== "sessions" && "max-lg:hidden")}>
        {/* This computer first: the folders below are on it (#232). */}
        <div className="-mt-2 mb-2 border-b pb-2">
          <ComputerPanel project={project} dev={dev} onChanged={onChanged} />
        </div>
        <h2 className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Folders
        </h2>
        {folders.length === 0 ? (
          <p className="px-1 pb-1 text-muted-foreground">No folders yet.</p>
        ) : (
          <ul className="pb-3">
            {folders.map((f) => (
              <li key={f.id} className="group flex items-center gap-2 rounded px-1 py-1" title={f.path}>
                <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {/* Its name first; the rest of the path dimmed, cut from the start (like VS Code's Recent). */}
                <span className="flex min-w-0 flex-1 items-baseline gap-1.5" title={f.path}>
                  {/* The name, whole; where it is shows on hover (#233). */}
                  <span className="min-w-0 break-all font-medium">{folderParts(f.path).name}</span>
                </span>
                <button
                  type="button"
                  // An icon, so the folder's name has the room (#233).
                  className="flex size-11 shrink-0 items-center justify-center rounded text-link hover:bg-muted lg:size-7"
                  aria-label={`Open a new session in ${f.path}`}
                  title="New session here"
                  onClick={() => openIn(f.id)}
                >
                  <Plus className="h-4 w-4" aria-hidden />
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
                // Only when it's really left the row, not passed over a child (no flicker).
                onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOver(null)}
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
                    <span className="text-xs text-muted-foreground" data-testid={`doing-${s.name}`}>
                      {sessionDoing(project, s, done)}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-xs text-muted-foreground">
                    {project.tasks.filter((t) => t.assignee_session_id === s.id && !done.has(t.status_id)).length || ""}
                  </span>
                </button>
                <Notes notes={project.handoffs.filter((h) => h.session_id === s.id)} />
              </li>
            ))}
          </ul>
        )}
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
                <span className="tabular-nums">#{n.number}</span> {new Date(n.written_at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} · {n.state.replace("_", " ")}
              </summary>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-sans text-xs text-foreground">{n.body}</pre>
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
  const what = on ? `working on #${on.number}` : mine.length ? `${mine.length} ${mine.length === 1 ? "task" : "tasks"} to start` : "not working on anything";
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
  const command = "omicron folders add";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="mb-3 flex items-center gap-1 rounded px-1 py-1 text-xs text-link hover:bg-muted">
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add Folder
        </button>
      </PopoverTrigger>
      <PopoverContent title="Add a folder" align="start" className="grid w-72 gap-2 text-sm">
        <p>In the folder, on this computer, run:</p>
        <div className="flex items-center gap-2 rounded-md bg-muted py-1 pl-3 pr-1">
          <code className="flex-1 font-mono text-xs">{command}</code>
          <CopyButton text={command} className="h-8 px-2 text-xs" />
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

