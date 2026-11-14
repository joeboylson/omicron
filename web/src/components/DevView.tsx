import { useState } from "react";
import { Folder as FolderIcon, LogOut, Plus, Terminal as TerminalIcon, Undo2, X } from "lucide-react";
import { useApp } from "@/lib/app";
import { devAction, type Dev } from "@/lib/dev";
import type { ProjectData, Task } from "@/lib/data";
import { Terminal } from "@/components/Terminal";
import { ComputerPanel } from "@/components/ComputerPanel";
import { cn } from "@/lib/utils";

const TASK = "application/x-omicron-task";

/**
 * A Project's Dev view, for the owner of the computer serving the page
 * (ref/BRAINSTORM.md, "Two views of a Project"). Left: its folders and
 * sessions on this computer. Middle: sessions as terminal tabs. Right: the
 * board as a list, by column; drag a task onto a session to hand it over
 * here (or pick the session in the task's row).
 */
export function DevView({ project, dev, onChanged }: { project: ProjectData; dev: Dev; onChanged: () => void }) {
  const { db, act } = useApp();
  const here = project.sessions.filter((s) => s.machine_id === dev.machine_id).sort((a, b) => a.name.localeCompare(b.name));
  const folders = project.folders.filter((f) => f.machine_id === dev.machine_id);
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const open = (name: string) => {
    setTabs((t) => (t.includes(name) ? t : [...t, name]));
    setActive(name);
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
  const sessionName = (id: string | null) => project.sessions.find((s) => s.id === id)?.name;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(20rem,1fr)_auto] gap-px border-t bg-border lg:grid-cols-[15rem_minmax(0,1fr)_19rem] lg:grid-rows-1">
      <aside aria-label="Folders and sessions" className="overflow-y-auto bg-background p-3 text-sm">
        <h2 className="px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Folders on {dev.machine}</h2>
        {folders.length === 0 ? (
          <p className="px-1 pb-3 text-muted-foreground">
            None yet: <code className="font-mono text-xs">omicron folders add</code> in one.
          </p>
        ) : (
          <ul className="pb-3">
            {folders.map((f) => (
              <li key={f.id} className="group flex items-center gap-2 rounded px-1 py-1" title={f.path}>
                <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Open a new session in ${f.path}`}
                  title="Open a new session here"
                  onClick={() => openIn(f.id)}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
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
                  )}
                  onClick={() => open(s.name)}
                  title={`${s.folder}: open its terminal`}
                >
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--sys-green)" }} />
                  <span className="truncate font-medium">{s.name}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
                    {project.tasks.filter((t) => t.assignee_session_id === s.id && !done.has(t.status_id)).length || ""}
                  </span>
                </button>
                <Notes notes={project.handoffs.filter((h) => h.session_id === s.id)} />
              </li>
            ))}
          </ul>
        )}
        <ComputerPanel project={project} dev={dev} onChanged={onChanged} />
      </aside>

      <section aria-label="Terminals" className="flex min-h-0 min-w-0 flex-col bg-background">
        <div role="tablist" aria-label="Open sessions" className="flex shrink-0 overflow-x-auto border-b bg-muted">
          {tabs.map((name) => (
            <div key={name} className={cn("flex items-center", active === name ? "bg-background text-foreground" : "text-muted-foreground")}>
              <button role="tab" type="button" aria-selected={active === name} className="flex h-9 items-center gap-1.5 pl-3 pr-1 text-sm" onClick={() => setActive(name)}>
                <TerminalIcon className="h-3.5 w-3.5" aria-hidden />
                {name}
              </button>
              <button type="button" className="mr-1 rounded p-1 hover:bg-accent" aria-label={`Close ${name}'s tab (it keeps running)`} onClick={() => close(name)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        {active && (
          <div className="flex shrink-0 items-center gap-1 border-b bg-background px-2 py-1 text-xs text-muted-foreground">
            <button
              type="button"
              className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent hover:text-foreground"
              onClick={() => handOff(active)}
              title="Ask it for its handoff note, then clear: a fresh conversation picks up from the note"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden /> Hand off
            </button>
            {ending === active ? (
              <button type="button" className="flex items-center gap-1 rounded bg-red-600/80 px-2 py-1 text-white" onClick={() => end(active)}>
                <LogOut className="h-3.5 w-3.5" aria-hidden /> End {active}: quit Claude
              </button>
            ) : (
              <button
                type="button"
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-accent hover:text-foreground"
                onClick={() => setEnding(active)}
                title="Quit Claude, which ends the session"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden /> End
              </button>
            )}
          </div>
        )}
        {said && (
          <p role="status" className="shrink-0 truncate border-b bg-background px-3 py-1 text-xs text-muted-foreground">
            {said}
          </p>
        )}
        {tabs.length === 0 && (
          <p className="m-auto max-w-xs p-6 text-center text-sm text-muted-foreground">Pick a session on the left to open its terminal here. Closing a tab leaves it running.</p>
        )}
        {tabs.map((name) => (
          <Terminal key={name} session={name} active={active === name} />
        ))}
      </section>

      <aside aria-label="Tasks by column" className="overflow-y-auto bg-background p-3 text-sm">
        {project.statuses.map((st) => {
          const tasks = project.tasks.filter((t) => t.status_id === st.id).sort((a, b) => a.position - b.position);
          return (
            <section key={st.id} aria-label={st.name} className="pb-3">
              <h2 className="flex items-center gap-2 px-1 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {st.name} <span className="font-mono">{tasks.length}</span>
              </h2>
              <ul>
                {tasks.map((t) => (
                  <li
                    key={t.id}
                    draggable={here.length > 0}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(TASK, t.id);
                      e.dataTransfer.effectAllowed = "link";
                    }}
                    className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                  >
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground">#{t.number}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {here.length > 0 && (
                      <select
                        aria-label={`Hand #${t.number} to a session here`}
                        className="max-w-24 shrink-0 truncate rounded border-0 bg-transparent text-[11px] text-muted-foreground"
                        value={here.some((s) => s.id === t.assignee_session_id) ? t.assignee_session_id! : ""}
                        onChange={(e) => {
                          const task = t;
                          if (e.target.value) give(task, e.target.value);
                        }}
                      >
                        <option value="">{sessionName(t.assignee_session_id) ?? "Hand to…"}</option>
                        {here.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </aside>
    </div>
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
