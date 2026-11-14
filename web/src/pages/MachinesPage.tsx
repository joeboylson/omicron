// Machines: the ones you share a Project with (and any on every Project),
// whether they're awake, the Projects each can use, and their Claude
// accounts. Each has its own API key (keys are never for people): New key
// registers a machine and shows its key once. Machines are switched off or
// removed here. The web version of `omicron machines`.

import { useCallback, useRef, useEffect, useState } from "react";
import { Check, Copy, KeyRound, MoreHorizontal, Power, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useApp } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { useAwakeMachines } from "@/lib/awake";
import {
  addProjectMachine,
  createMachineKey,
  listMachineAccounts,
  listMachines,
  listProjects,
  removeMachine,
  removeProjectMachine,
  switchMachine,
  type MachineRow,
  type MachineSummary,
  type ProjectSummary,
} from "@/lib/data";
import { TopBar } from "@/components/TopBar";
import { DataTable, SortHeader, type ColumnDef } from "@/components/DataTable";
import { MultiSelect } from "@/components/MultiSelect";
import { Machines as ClaudeAccounts } from "@/components/Machines";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { ListSkeleton } from "@/components/Skeleton";
import { cn } from "@/lib/utils";

function seen(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 2) return "Last seen just now";
  if (minutes < 60) return `Last seen ${minutes} min ago`;
  if (minutes < 60 * 24) return `Last seen ${Math.round(minutes / 60)} h ago`;
  const days = Math.round(minutes / (60 * 24));
  if (days < 7) return `Last seen ${days} day${days === 1 ? "" : "s"} ago`;
  return `Last seen ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** A machine's state, in plain words: a new key that hasn't connected yet
 *  isn't the same as one that went quiet. */
export function machineStatus(m: MachineRow, up: boolean): string {
  if (!m.active) return "Switched off";
  if (up) return "Online";
  return m.last_seen ? seen(m.last_seen) : "Waiting to connect";
}

/** Online first, then the most recently seen, then new ones, then switched off. */
function statusOrder(m: MachineRow, up: boolean): number {
  if (!m.active) return 4e13;
  if (up) return 0;
  return m.last_seen ? 1e13 + (Date.now() - new Date(m.last_seen).getTime()) : 3e13;
}

export function MachinesPage() {
  const { db, act } = useApp();
  const awake = useAwakeMachines(db);
  const [machines, setMachines] = useState<MachineRow[] | null>(null);
  const [accounts, setAccounts] = useState<MachineSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [making, setMaking] = useState(false);
  // Removing can't be undone, so it asks first.
  const [removing, setRemoving] = useState<MachineRow | null>(null);

  const reload = useCallback(() => {
    act(async () => {
      const [m, p, a] = await Promise.all([listMachines(db), listProjects(db), listMachineAccounts(db)]);
      setMachines(m);
      setProjects(p);
      setAccounts(a);
    });
  }, [db, act]);
  useEffect(reload, [reload]);
  useChanges(db, null, reload);

  const yours = (m: MachineRow) => m.all_projects || m.projectIds.some((id) => projects.some((p) => p.id === id));
  // One taken out of its last Project stays until the page is left, so it can be given one again.
  const seen = useRef(new Set<string>());
  const up = (m: MachineRow) => awake?.has(m.id) ?? false;
  const shown = (machines ?? []).filter((m) => yours(m) || seen.current.has(m.id));
  for (const m of shown) seen.current.add(m.id);
  const change = (work: () => Promise<unknown>) => act(work).then((ok) => ok && reload());
  const choices = projects.map((p) => ({ id: p.id, name: p.name }));
  const columns: ColumnDef<MachineRow, any>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <SortHeader column={column} label="Name" />,
      cell: ({ row: { original: m } }) => (
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn("h-2 w-2 shrink-0 rounded-full", !up(m) && "border border-muted-foreground")}
            style={up(m) ? { background: "var(--sys-green)" } : undefined}
          />
          <span className="font-mono font-medium">{m.name}</span>
        </div>
      ),
      meta: { phone: "main" },
    },
    {
      id: "status",
      accessorFn: (m) => statusOrder(m, up(m)),
      header: ({ column }) => <SortHeader column={column} label="Status" />,
      cell: ({ row: { original: m } }) => <span className="text-muted-foreground">{machineStatus(m, up(m))}</span>,
      meta: { className: "hidden sm:table-cell" },
    },
    {
      id: "projects",
      accessorFn: (m) => (m.all_projects ? projects.length : m.projectIds.length),
      header: ({ column }) => <SortHeader column={column} label="Projects" />,
      cell: ({ row: { original: m } }) =>
        m.all_projects ? (
          <Badge variant="secondary" className="font-normal">
            Every Project
          </Badge>
        ) : (
          <MultiSelect
            label={`${m.name}'s Projects`}
            none="No Projects"
            choices={choices}
            picked={new Set(m.projectIds)}
            toggle={(id, on) => change(() => (on ? addProjectMachine(db, id, m.id) : removeProjectMachine(db, id, m.id)))}
          />
        ),
      meta: { className: "w-[40%]" },
    },
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row: { original: m } }) => (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={`More for ${m.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => change(() => switchMachine(db, m.id, !m.active))}>
                <Power className="h-4 w-4" aria-hidden /> {m.active ? "Switch Off" : "Switch On"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setRemoving(m)}>
                <Trash2 className="h-4 w-4" aria-hidden /> Remove {m.name}…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
      meta: { className: "py-0 text-right", phone: "end" },
    },
  ];

  return (
    <>
      <TopBar
        here="/machines"
        title="Machines"
        actions={
          <Button onClick={() => setMaking(true)}>
            <KeyRound /> New key
          </Button>
        }
      />
      <main className="mx-auto grid w-full max-w-5xl gap-3 px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))]">
        {machines === null ? (
          <ListSkeleton rows={2} />
        ) : (
          <DataTable
            label="Machines"
            columns={columns}
            data={shown}
            rowLabel={(m) => m.name}
            initialSort={[{ id: "name", desc: false }]}
            search={{ label: "Search machines", placeholder: "Search machines", text: (m) => m.name }}
            empty="No machines in your Projects yet. Make one with New key."
          />
        )}
        <div className="mt-4">
          <ClaudeAccounts machines={accounts} />
        </div>
      </main>
      <NewKey open={making} onOpenChange={setMaking} projects={projects} onMade={reload} />
      <Dialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent className="gap-4 sm:max-w-md">
          {removing && (
            <>
              <DialogHeader className="text-left">
                <DialogTitle>Remove {removing.name}?</DialogTitle>
                <DialogDescription>Its key stops working for good and its Claude sessions end. This can't be undone.</DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="ghost" onClick={() => setRemoving(null)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => change(() => removeMachine(db, removing.id)).then(() => setRemoving(null))}>
                  Remove {removing.name}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function NewKey({
  open,
  onOpenChange,
  projects,
  onMade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectSummary[];
  onMade: () => void;
}) {
  const { db, act } = useApp();
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [key, setKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Fresh each time it opens (not when the list reloads, which live
  // updates do while you're typing).
  // Whether the Projects were ticked or unticked by hand since it opened.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (open) {
      setName("");
      setPicked(projects.length === 1 ? [projects[0]!.id] : []);
      setTouched(false);
      setKey(null);
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // The list can arrive after it opens: one Project is still ticked for you.
  useEffect(() => {
    if (open && !touched && projects.length === 1 && picked.length === 0) setPicked([projects[0]!.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  const make = async (e: React.FormEvent) => {
    e.preventDefault();
    let made = "";
    if (await act(async () => (made = await createMachineKey(db, name.trim(), picked)))) {
      setKey(made);
      onMade();
    }
  };
  const command = key ? `omicron machines use-key ${key}` : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-4 sm:max-w-md" onOpenAutoFocus={(e) => key && focusSheet(e)}>
        {key ? (
          <>
            <DialogHeader className="text-left">
              <DialogTitle>{name.trim()}'s key</DialogTitle>
              <DialogDescription>Copy it now: it isn't shown again. On {name.trim()}, run this once:</DialogDescription>
            </DialogHeader>
            <code data-testid="new-key" className="break-all rounded-lg bg-muted p-3 font-mono text-xs">
              {command}
            </code>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard?.writeText(command).catch(() => {});
                  setCopied(true);
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="text-left">
              <DialogTitle>New key</DialogTitle>
              <DialogDescription className="sr-only">A key for a new computer.</DialogDescription>
            </DialogHeader>
            <form onSubmit={make} className="grid gap-4">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Machine name, like mac-mini" aria-label="Machine name" />
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm text-muted-foreground">Projects it can use</legend>
                {projects.map((p) => (
                  <div key={p.id} className="flex min-h-9 items-center gap-2">
                    <Checkbox
                      id={`key-p-${p.id}`}
                      checked={picked.includes(p.id)}
                      onCheckedChange={(on) => {
                        setTouched(true);
                        setPicked((all) => (on ? [...all, p.id] : all.filter((x) => x !== p.id)));
                      }}
                    />
                    <Label htmlFor={`key-p-${p.id}`} className="font-normal">
                      {p.name}
                    </Label>
                  </div>
                ))}
              </fieldset>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!name.trim() || picked.length === 0}>
                  Make key
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
