import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useApp, go } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { listMachineAccounts, listProjects, startProject, type MachineSummary, type ProjectSummary } from "@/lib/data";
import { Machines } from "@/components/Machines";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NavBar } from "@/components/NavBar";

export function ProjectsPage() {
  const { db, act, me } = useApp();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [machines, setMachines] = useState<MachineSummary[]>([]);
  const [name, setName] = useState("");

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
      go(`/p/${id}`);
    }
  };

  return (
    <>
    <NavBar
      title="Projects"
      titleClassName="mx-auto w-full max-w-3xl"
      right={
        <span
          className="truncate px-2 text-sm text-muted-foreground"
          data-testid="me"
          data-person-id={me.personId}
          data-via={me.via}
          title={me.login}
        >
          {me.displayName}
        </span>
      }
    />
    <main className="mx-auto w-full max-w-3xl px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
      {projects === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : projects.length === 0 ? (
        <p className="text-muted-foreground">No Projects yet. Start one below, or ask someone to add you to theirs.</p>
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
      <form onSubmit={start} className="mt-6 flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New Project name" aria-label="New Project name" />
        <Button type="submit" disabled={!name.trim()}>
          <Plus /> Start Project
        </Button>
      </form>
      <div className="mt-8">
        <Machines machines={machines} />
      </div>
    </main>
    </>
  );
}
