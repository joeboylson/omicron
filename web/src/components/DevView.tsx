import { CopyButton } from "@/components/CopyButton";
import { useEffect, useState } from "react";
import { Confirm } from "@/components/base/confirm";
import { Folder as FolderIcon, LogOut, PanelRight, Pin, PinOff, Plus, Terminal as TerminalIcon, Undo2, X } from "lucide-react";
import { Button } from "@/components/base/button";
import { DataTable, SortHeader, type ColumnDef } from "@/components/DataTable";
import { useApp } from "@/lib/app";
import { devAction, type Dev } from "@/lib/dev";
import type { ProjectData } from "@/lib/data";
import { Terminal } from "@/components/Terminal";
import { cn, radioArrows } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/base/popover";


/** What the Dev tab shows (#252): folders, sessions, or remote control keys. */
export type DevSection = "folders" | "sessions" | "keys";

/**
 * A Project's Dev tab, for the owner of the computer serving the page
 * (ref/BRAINSTORM.md, "Two views of a Project"). Three sections, each a
 * compact table: this computer's folders in the Project, its sessions, and
 * its remote control keys. A session opens as a page of its own
 * (`SessionPage`), or beside any tab on a wide screen; up to three sessions
 * can be pinned to the top bar (#252).
 */
export function DevView({
  project,
  dev,
  onChanged,
  section,
  onSection,
  pinned,
  onPin,
  onOpen,
  onBeside,
}: {
  project: ProjectData;
  dev: Dev;
  onChanged: () => void;
  section: DevSection;
  onSection: (s: DevSection) => void;
  pinned: string[];
  onPin: (name: string) => void;
  onOpen: (name: string) => void;
  /** Keep a session open beside every tab (wide screens). */
  onBeside: (name: string) => void;
}) {
  const { db, act } = useApp();
  const here = project.sessions.filter((s) => s.machine_id === dev.machine_id).sort((a, b) => a.name.localeCompare(b.name));
  const folders = project.folders.filter((f) => f.machine_id === dev.machine_id);
  const done = new Set(project.statuses.filter((s) => s.is_done).map((s) => s.id));
  const openIn = (folderId: string) =>
    act(async () => {
      const r = await devAction(db, "/open", { folder_id: folderId });
      onChanged();
      if (r?.session) onOpen(r.session);
    });
  type Session = (typeof here)[number];
  const sessionColumns: ColumnDef<Session, any>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <SortHeader column={column} label="Session" />,
      cell: ({ row: { original: s } }) => (
        <button type="button" className="grid min-w-0 text-left" onClick={() => onOpen(s.name)} title={`${s.folder}: open its terminal`}>
          <span className="flex items-center gap-2 font-medium">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--sys-green)" }} />
            {s.name}
          </span>
          <span className="pl-3.5 text-xs text-muted-foreground" data-testid={`doing-${s.name}`}>
            {sessionDoing(project, s, done)}
          </span>
        </button>
      ),
      meta: { phone: "main" },
    },
    {
      id: "tasks",
      accessorFn: (s) => project.tasks.filter((t) => t.assignee_session_id === s.id && !done.has(t.status_id)).length,
      header: ({ column }) => <SortHeader column={column} label="Tasks" />,
      cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{getValue() || "–"}</span>,
      meta: { className: "hidden sm:table-cell w-20", phone: "hide" },
    },
    {
      id: "pin",
      header: () => <span className="sr-only">Pin</span>,
      enableSorting: false,
      cell: ({ row: { original: s } }) => {
        const on = pinned.includes(s.name);
        return (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              aria-pressed={on}
              aria-label={on ? `Unpin ${s.name}` : `Pin ${s.name} to the top bar`}
              title={on ? "Unpin" : pinned.length >= 3 ? "Up to 3 can be pinned" : "Pin to the top bar"}
              disabled={!on && pinned.length >= 3}
              className={on ? "text-[var(--sys-blue)]" : "text-muted-foreground"}
              onClick={() => onPin(s.name)}
            >
              {on ? <PinOff /> : <Pin />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hidden text-muted-foreground lg:inline-flex"
              aria-label={`Open ${s.name} beside the page`}
              title="Open beside the page: it stays open on every tab"
              onClick={() => onBeside(s.name)}
            >
              <PanelRight />
            </Button>
          </div>
        );
      },
      meta: { className: "w-0", phone: "end" },
    },
  ];
  type F = (typeof folders)[number];
  const folderColumns: ColumnDef<F, any>[] = [
    {
      id: "name",
      accessorFn: (f) => folderParts(f.path).name,
      header: ({ column }) => <SortHeader column={column} label="Folder" />,
      cell: ({ row: { original: f } }) => (
        <span className="flex min-w-0 items-center gap-2" title={f.path}>
          <FolderIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 break-all font-medium">{folderParts(f.path).name}</span>
        </span>
      ),
      meta: { phone: "main" },
    },
    {
      id: "running",
      accessorFn: (f) => here.filter((s) => s.folder === f.path).length,
      header: ({ column }) => <SortHeader column={column} label="Sessions" />,
      cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{getValue() || "–"}</span>,
      meta: { className: "hidden sm:table-cell w-24", phone: "hide" },
    },
    {
      id: "new",
      header: () => <span className="sr-only">New session</span>,
      enableSorting: false,
      cell: ({ row: { original: f } }) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="gap-1 text-link" aria-label={`Open a new session in ${f.path}`} onClick={() => openIn(f.id)}>
            <Plus className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">New Session</span>
          </Button>
        </div>
      ),
      meta: { className: "w-0 whitespace-nowrap", phone: "end" },
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-[max(1rem,env(safe-area-inset-left))] pb-2">
        <div role="radiogroup" aria-label="Show" className="grid grid-cols-3 rounded-lg bg-muted p-0.5 max-sm:flex-1 sm:w-96">
          {(
            [
              ["folders", "Folders"],
              ["sessions", "Sessions"],
              ["keys", "Keys"],
            ] as const
          ).map(([p, label]) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={section === p}
              tabIndex={section === p ? 0 : -1}
              onKeyDown={radioArrows}
              onClick={() => onSection(p)}
              className={cn(
                "min-h-9 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                section === p ? "bg-background font-medium shadow-sm" : "text-foreground/75",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[max(1rem,env(safe-area-inset-left))]">
        {section === "folders" && (
          <div className="grid gap-2">
            <DataTable
              label="Folders"
              columns={folderColumns}
              data={folders}
              initialSort={[{ id: "name", desc: false }]}
              empty={<p className="py-6 text-center text-sm text-muted-foreground">No folders on this computer yet.</p>}
            />
            <AddFolder />
          </div>
        )}
        {section === "sessions" && (
          <DataTable
            label="Sessions"
            columns={sessionColumns}
            data={here}
            initialSort={[{ id: "name", desc: false }]}
            rowLabel={(s) => s.name}
            onRowTap={(s) => onOpen(s.name)}
            empty={<p className="py-6 text-center text-sm text-muted-foreground">No sessions running here. Open one from a folder.</p>}
          />
        )}
        {section === "keys" && <RemoteKeys local={dev.local} />}
      </div>
    </div>
  );
}

/** One session, as a page (#252): its terminal, Hand off and End. */
export function SessionPage({
  project,
  name,
  onChanged,
  onClose,
  onBeside,
  compact = false,
}: {
  project: ProjectData;
  name: string;
  onChanged: () => void;
  onClose: () => void;
  /** Move it beside the page instead (wide screens). */
  onBeside?: () => void;
  compact?: boolean;
}) {
  const { db, act } = useApp();
  const [said, setSaid] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const session = project.sessions.find((s) => s.name === name);
  const handOff = () =>
    act(async () => {
      const r = await devAction(db, "/handoff", { session: name });
      setSaid(r?.said ?? null);
    });
  const end = () =>
    act(async () => {
      setEnding(false);
      const r = await devAction(db, "/end", { session: name });
      // Stays, saying what happened; it shows the session has gone once it has.
      setSaid(r?.said ?? null);
      onChanged();
    });
  return (
    <section aria-label={`Session ${name}`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1 text-sm">
        <TerminalIcon className="ml-1 h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
        {session && (
          <>
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={handOff} title="Ask it for its handoff note, then clear: a fresh conversation picks up from the note">
              <Undo2 className="h-3.5 w-3.5" aria-hidden /> <span className={cn(compact && "sr-only")}>Hand Off</span>
            </Button>
            <Button variant="ghost" size="sm" className="gap-1 text-destructive hover:text-destructive" onClick={() => setEnding(true)} title="Quit Claude, which ends the session">
              <LogOut className="h-3.5 w-3.5" aria-hidden /> <span className={cn(compact && "sr-only")}>End</span>
            </Button>
          </>
        )}
        {onBeside && (
          <Button variant="ghost" size="icon" className="hidden text-muted-foreground lg:inline-flex" aria-label="Open beside the page" title="Open beside the page: it stays open on every tab" onClick={onBeside}>
            <PanelRight />
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label={compact ? `Close ${name} beside the page` : `Back to sessions`} title="Close (it keeps running)" onClick={onClose}>
          <X />
        </Button>
      </div>
      {said && (
        <p role="status" className="shrink-0 truncate border-b px-3 py-1 text-xs text-muted-foreground">
          {said}
        </p>
      )}
      {session && <Notes notes={project.handoffs.filter((h) => h.session_id === session.id)} />}
      {session ? (
        <Terminal key={name} session={name} active />
      ) : (
        <p className="m-auto p-6 text-center text-sm text-muted-foreground">{name} isn't running.</p>
      )}
      <Confirm
        open={ending}
        onOpenChange={setEnding}
        title={`End ${name}?`}
        sentence="Claude quits in it, which ends the session."
        action="End Session"
        onConfirm={end}
      />
    </section>
  );
}

/** A session's past handoff notes, folded: each opens to its text. */
function Notes({ notes }: { notes: ProjectData["handoffs"] }) {
  if (notes.length === 0) return null;
  return (
    <details className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer py-0.5">
        {notes.length} handoff {notes.length === 1 ? "note" : "notes"}
      </summary>
      <ul aria-label="Handoff notes" className="max-h-64 overflow-y-auto">
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

/** This computer's remote control keys: listed, taken back, or a new one made (on the computer itself). */
function RemoteKeys({ local }: { local: boolean }) {
  const { db, act } = useApp();
  type Key = { id: string; made: string; until: string; good: boolean };
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [taking, setTaking] = useState<Key | null>(null);
  const call = (body: Record<string, string>) =>
    act(async () => {
      const r = await devAction(db, "/keys", body);
      setKeys(r?.keys ?? []);
      if (r?.made) setMade(r.made);
    });
  useEffect(() => {
    call({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const columns: ColumnDef<Key, any>[] = [
    { accessorKey: "id", header: ({ column }) => <SortHeader column={column} label="Key" />, cell: ({ getValue }) => <span className="font-medium">{getValue()}</span>, meta: { phone: "main" } },
    { accessorKey: "made", header: ({ column }) => <SortHeader column={column} label="Made" />, cell: ({ getValue }) => <span className="text-muted-foreground">{when(getValue())}</span>, meta: { className: "hidden sm:table-cell", phone: "hide" } },
    {
      accessorKey: "until",
      header: ({ column }) => <SortHeader column={column} label="Works until" />,
      cell: ({ row: { original: k } }) => <span className={k.good ? "" : "text-muted-foreground"}>{k.good ? when(k.until) : "Ran out"}</span>,
      meta: { phone: "below" },
    },
    {
      id: "take",
      header: () => <span className="sr-only">Take back</span>,
      enableSorting: false,
      cell: ({ row: { original: k } }) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setTaking(k)}>
            Take Back
          </Button>
        </div>
      ),
      meta: { className: "w-0 whitespace-nowrap", phone: "end" },
    },
  ];
  return (
    <div className="grid gap-2">
      {made && (
        <div role="status" className="grid gap-1.5 rounded-lg border p-3 text-sm">
          <span>Copy it now: it isn't shown again. Paste it in Settings, in the browser that should control this computer.</span>
          <span className="flex items-center gap-2 rounded-md bg-muted py-1 pl-3 pr-1">
            <code className="min-w-0 flex-1 break-all font-mono text-xs">{made}</code>
            <CopyButton text={made} className="h-8" />
          </span>
        </div>
      )}
      {keys === null ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : (
        <DataTable
          label="Remote control keys"
          columns={columns}
          data={keys}
          initialSort={[{ id: "made", desc: true }]}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">No keys. A key lets another browser control this computer.</p>}
        />
      )}
      {local && (
        <div>
          <Button variant="ghost" size="sm" className="gap-1 text-link" onClick={() => call({ make: "8h" })}>
            <Plus className="h-4 w-4" aria-hidden /> New Key
          </Button>
        </div>
      )}
      <Confirm
        open={taking !== null}
        onOpenChange={(o) => !o && setTaking(null)}
        title={`Take back key ${taking?.id ?? ""}?`}
        sentence="A browser using it can't control this computer any more."
        action="Take Back"
        onConfirm={() => taking && (call({ revoke: taking.id }), setTaking(null))}
      />
    </div>
  );
}

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
