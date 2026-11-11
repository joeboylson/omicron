import { useCallback, useEffect, useState } from "react";
import { Plus, Users } from "lucide-react";
import { useApp, go } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { listMachineAccounts, listProjects, startProject, type MachineSummary, type ProjectSummary } from "@/lib/data";
import { Machines } from "@/components/Machines";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NavBar } from "@/components/NavBar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ProjectsPage() {
  const { db, act, me } = useApp();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [machines, setMachines] = useState<MachineSummary[]>([]);
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);

  const reload = useCallback(() => {
    act(async () => {
      const [p, m] = await Promise.all([listProjects(db), listMachineAccounts(db)]);
      setProjects(p);
      setMachines(m);
    });
  }, [db, act]);
  useEffect(reload, [reload]);
  useChanges(db, null, reload);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    let id = "";
    if (await act(async () => (id = await startProject(db, n)))) {
      setName("");
      setStarting(false);
      go(`/p/${id}`);
    }
  };

  return (
    <>
    <NavBar
      title="Projects"
      titleClassName="mx-auto w-full max-w-3xl"
      right={
        <>
        <Button variant="ghost" size="icon" aria-label="New Project" title="New Project" onClick={() => setStarting(true)}>
          <Plus />
        </Button>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => go("/people")}>
          <Users className="h-4 w-4" aria-hidden /> People
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="max-w-40 truncate text-muted-foreground"
          data-testid="me"
          data-person-id={me.personId}
          data-via={me.via}
          title={me.login}
          aria-label={`${me.displayName}: Settings`}
          onClick={() => go("/settings")}
        >
          {me.displayName}
        </Button>
        </>
      }
    />
    <main className="mx-auto w-full max-w-3xl px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
      {projects === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <div className="grid justify-items-start gap-3 py-6">
          <p className="text-muted-foreground">No Projects yet. Start one, or ask someone to add you to theirs.</p>
          <Button onClick={() => setStarting(true)}>
            <Plus /> New Project
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Projects">
          {projects.map((p) => (
            <li key={p.id}>
              <a
                href={`/p/${p.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(`/p/${p.id}`);
                }}
              >
                <Card className="transition-colors hover:bg-accent active:bg-accent">
                  <CardHeader className="p-4">
                    <CardTitle className="text-[17px] font-semibold tracking-normal sm:text-lg">{p.name}</CardTitle>
                    <CardDescription>
                      <span className="font-mono">{p.taskCount}</span> {p.taskCount === 1 ? "task" : "tasks"}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </a>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={starting} onOpenChange={setStarting}>
        <DialogContent className="gap-4 sm:max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle>New Project</DialogTitle>
            <DialogDescription>It starts with To do and Done. You can add statuses, labels and people after.</DialogDescription>
          </DialogHeader>
          <form onSubmit={start} className="grid gap-4">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name, like Kitchen remodel"
              aria-label="New Project name"
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="ghost" onClick={() => setStarting(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                Start Project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <div className="mt-8">
        <Machines machines={machines} />
      </div>
    </main>
    </>
  );
}
