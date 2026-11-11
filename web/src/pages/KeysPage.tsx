// API keys: each machine has its own (keys are never for people). Making
// one registers a new machine in Projects you're in and shows its key once.
// Lists the machines you share a Project with, and switches them off or
// removes them. The web version of `omicron machines register --print`.

import { useCallback, useEffect, useState } from "react";
import { Check, ChevronLeft, Copy, KeyRound, Plus } from "lucide-react";
import { go, useApp } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { useAwakeMachines } from "@/lib/awake";
import {
  createMachineKey,
  listMachines,
  listProjects,
  removeMachine,
  switchMachine,
  type MachineRow,
  type ProjectSummary,
} from "@/lib/data";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Group } from "@/components/Grouped";
import { ListSkeleton } from "@/components/Skeleton";
import { cn } from "@/lib/utils";

function seen(iso: string | null): string {
  if (!iso) return "never seen";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 2) return "seen just now";
  if (minutes < 60) return `seen ${minutes} min ago`;
  if (minutes < 60 * 24) return `seen ${Math.round(minutes / 60)} h ago`;
  return `seen ${new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export function KeysPage() {
  const { db, act } = useApp();
  const awake = useAwakeMachines(db);
  const [machines, setMachines] = useState<MachineRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [making, setMaking] = useState(false);
  // Removing can't be undone, so it asks first, in place.
  const [removing, setRemoving] = useState<string | null>(null);

  const reload = useCallback(() => {
    act(async () => {
      const [m, p] = await Promise.all([listMachines(db), listProjects(db)]);
      setMachines(m);
      setProjects(p);
    });
  }, [db, act]);
  useEffect(reload, [reload]);
  useChanges(db, null, reload);

  const mine = (m: MachineRow) => m.projectIds.some((id) => projects.some((p) => p.id === id));
  const shown = (machines ?? []).filter(mine);
  const name = (id: string) => projects.find((p) => p.id === id)?.name;
  const change = (work: () => Promise<unknown>) => act(work).then((ok) => ok && reload());

  return (
    <>
      <NavBar
        title="API keys"
        titleClassName="mx-auto w-full max-w-3xl"
        left={
          <Button variant="ghost" className="gap-0.5 px-2 [&_svg]:size-5" aria-label="Back to Settings" onClick={() => go("/settings")}>
            <ChevronLeft /> Settings
          </Button>
        }
        right={
          <Button variant="ghost" size="icon" aria-label="New key" title="New key" onClick={() => setMaking(true)}>
            <Plus />
          </Button>
        }
      />
      <main className="mx-auto grid w-full max-w-3xl gap-6 px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <Group
          title="Machines"
          note="Each machine has its own key, used by its daemon and its Claude sessions. People never use keys; they sign in with Tailscale. Switched off, a machine's key stops working until it's switched on again."
        >
          {machines === null ? (
            <ListSkeleton rows={2} />
          ) : shown.length === 0 ? (
            <div className="grid justify-items-start gap-3 px-4 py-4">
              <p className="text-sm text-muted-foreground">No machines in your Projects yet.</p>
              <Button onClick={() => setMaking(true)}>
                <KeyRound /> New key
              </Button>
            </div>
          ) : (
            <ul aria-label="Machines" className="divide-y">
              {shown.map((m) => {
                const up = awake?.has(m.id) ?? false;
                return (
                  <li key={m.id} aria-label={m.name} className="grid gap-1.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        aria-hidden
                        className={cn("h-2 w-2 rounded-full", !up && "border border-muted-foreground")}
                        style={up ? { background: "var(--sys-green)" } : undefined}
                      />
                      <span className="font-mono text-[15px] font-medium sm:text-sm">{m.name}</span>
                      <span className="text-sm text-muted-foreground">
                        {!m.active ? "switched off" : up ? "awake" : `asleep · ${seen(m.last_seen)}`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {m.all_projects ? (
                        <Badge variant="secondary" className="font-normal">
                          Every Project
                        </Badge>
                      ) : (
                        m.projectIds.filter(name).map((id) => (
                          <Badge key={id} variant="secondary" className="font-normal">
                            {name(id)}
                          </Badge>
                        ))
                      )}
                    </div>
                    {removing === m.id ? (
                      <div role="alert" className="grid gap-2 rounded-lg bg-muted p-3 text-sm">
                        <p>Remove {m.name}? Its key stops working for good and its Claude sessions are removed. This can't be undone.</p>
                        <div className="flex gap-2">
                          <Button size="sm" variant="destructive" onClick={() => change(() => removeMachine(db, m.id)).then(() => setRemoving(null))}>
                            Remove {m.name}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="-ml-3 flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => change(() => switchMachine(db, m.id, !m.active))}>
                          {m.active ? "Switch off" : "Switch on"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Remove ${m.name}…`}
                          onClick={() => setRemoving(m.id)}
                        >
                          Remove…
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Group>
      </main>
      <NewKey open={making} onOpenChange={setMaking} projects={projects} onMade={reload} />
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
  useEffect(() => {
    if (open) {
      setName("");
      setPicked(projects.length === 1 ? [projects[0]!.id] : []);
      setKey(null);
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
      <DialogContent className="gap-4 sm:max-w-md" onOpenAutoFocus={(e) => key && e.preventDefault()}>
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
              <DialogDescription>A key registers a new machine, in the Projects you pick.</DialogDescription>
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
                      onCheckedChange={(on) => setPicked((all) => (on ? [...all, p.id] : all.filter((x) => x !== p.id)))}
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
