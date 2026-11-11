import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useApp, go } from "@/lib/app";
import { useChanges } from "@/lib/live";
import { listProjects, startProject, type ProjectSummary } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ProjectsPage() {
  const { db, act } = useApp();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [name, setName] = useState("");

  const reload = useCallback(() => {
    act(async () => setProjects(await listProjects(db)));
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
    <main className="mx-auto w-full max-w-3xl p-4">
      <h1 className="mb-4 text-2xl font-semibold">Projects</h1>
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
                <Card className="transition-colors hover:bg-accent">
                  <CardHeader className="p-4">
                    <CardTitle className="text-lg">{p.name}</CardTitle>
                    <CardDescription>
                      {p.taskCount} {p.taskCount === 1 ? "task" : "tasks"}
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
    </main>
  );
}
