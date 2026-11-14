import { useEffect, useState } from "react";
import { Computer } from "lucide-react";
import { useApp } from "@/lib/app";
import { devAction, type Dev } from "@/lib/dev";
import { listProjectJobs, sayEvery, type JobLink, type ProjectData } from "@/lib/data";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Group, Row } from "@/components/Grouped";
import { cn } from "@/lib/utils";

type Info = { setup: string[]; accounts: string[]; teams: string[] };

/**
 * The rest of the Dev view (ref/BRAINSTORM.md, "The rest of the Dev
 * view"): this computer's setup checks, the Project's loops here, its
 * Claude accounts and its teams. Each change is something this computer
 * does, so it's only here, for its owner.
 */
export function ComputerPanel({ project, dev, onChanged }: { project: ProjectData; dev: Dev; onChanged: () => void }) {
  const { db, act } = useApp();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Info | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobLink[]>([]);
  const load = () =>
    act(async () => {
      const [i, j] = await Promise.all([devAction(db, "/computer", {}), listProjectJobs(db, project.id)]);
      setInfo(i);
      setJobs(j);
    });
  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const run = (body: Record<string, string>) =>
    act(async () => {
      const r = await devAction(db, "/run", body);
      setSaid(r?.said || "Done.");
      onChanged();
      load();
    });
  const here = project.sessions.filter((s) => s.machine_id === dev.machine_id);

  return (
    <>
      <Button variant="ghost" size="sm" className="mt-2 w-full justify-start gap-2 text-muted-foreground" onClick={() => setOpen(true)}>
        <Computer className="h-4 w-4" aria-hidden /> This computer
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:bg-background" onOpenAutoFocus={focusSheet}>
          <DialogHeader>
            <DialogTitle className="font-mono">{dev.machine}</DialogTitle>
            <DialogDescription>Setup, loops, Claude accounts and teams on this computer.</DialogDescription>
          </DialogHeader>
          {said && (
            <p role="status" className="rounded-md bg-secondary px-3 py-2 text-sm">
              {said}
            </p>
          )}

          <Group title="Setup checks">
            {(info?.setup ?? ["Checking…"]).map((l, i) => {
              const fix = l.startsWith("fix");
              return (
                <Row key={i} className={cn("py-2 text-sm", fix && "text-[var(--sys-orange)]")}>
                  {l.replace(/^(ok|fix|skip)\s+/, (m) => (m.trim() === "ok" ? "✓ " : m.trim() === "fix" ? "! " : "· "))}
                </Row>
              );
            })}
          </Group>

          <Group title="Loops here" label="Loops here">
            {here.length === 0 && <Row className="text-sm text-muted-foreground">No sessions running here.</Row>}
            {here.map((s) => {
              const loop = project.loops.find((l) => l.session_id === s.id);
              return loop ? (
                <Row key={s.id} className="py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{s.name}</span>: “{loop.prompt}” every {sayEvery(loop.every_seconds)}
                  </span>
                  <Button size="sm" variant="outline" onClick={() => run({ action: "loops-stop", session: s.name, project: project.name })}>
                    Stop
                  </Button>
                </Row>
              ) : (
                <LoopForm key={s.id} session={s.name} onStart={(prompt, every) => run({ action: "loops-start", session: s.name, project: project.name, prompt, every })} />
              );
            })}
          </Group>

          <Group title="Claude accounts" label="Claude accounts">
            {(info?.accounts ?? ["…"]).map((l, i) => {
              const [name, rest] = l.split("\t");
              const inUse = rest?.includes("(in use)");
              return (
                <Row key={i} className="py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {rest !== undefined ? (
                      <>
                        <span className="font-medium">{name}</span> <span className="text-muted-foreground">{rest.replace("(in use)", "")}</span>
                      </>
                    ) : (
                      l
                    )}
                  </span>
                  {rest !== undefined &&
                    (inUse ? (
                      <span className="text-xs text-muted-foreground">In use</span>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => run({ action: "accounts-use", name })}>
                        Use
                      </Button>
                    ))}
                </Row>
              );
            })}
          </Group>

          <Group title="Teams" label="Teams">
            {!info && <Row className="text-sm text-muted-foreground">Loading…</Row>}
            {info && info.teams.filter((l) => l.includes("\t")).length === 0 && <Row className="text-sm text-muted-foreground">No teams on this computer.</Row>}
            {info?.teams
              .filter((l) => l.includes("\t"))
              .map((l, i) => {
                const [name, state, , count, folder] = l.split("\t");
                // Its jobs in this Project that aren't finished, with where each is.
                const mine = jobs.filter((j) => j.team === name && j.state !== "done");
                const asks = project.tasks.filter((t) => t.question?.open && t.question.team === name);
                return (
                  <div key={i}>
                    <Row className="py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate" title={folder}>
                        <span className="font-medium">{name}</span> <span className="text-muted-foreground">{state}, {count}</span>
                      </span>
                      {state === "running" && (
                        <Button size="sm" variant="outline" onClick={() => run({ action: "teams-stop", team: name })}>
                          Stop
                        </Button>
                      )}
                    </Row>
                    {(mine.length > 0 || asks.length > 0) && (
                      <ul aria-label={`${name}'s jobs`} className="grid gap-1 px-4 pb-2 text-xs">
                        {mine.map((j) => (
                          <li key={j.id} className="flex gap-2">
                            <span className="font-mono text-muted-foreground">#{j.number}</span>
                            <span className="min-w-0 flex-1 truncate">{j.title}</span>
                            <span className={j.state === "blocked" ? "text-[var(--sys-orange)]" : "text-muted-foreground"}>
                              {j.state === "blocked" ? "waiting on an answer" : j.step ? `${j.state}, ${j.step}` : j.state}
                            </span>
                          </li>
                        ))}
                        {asks.map((t) => (
                          <li key={t.id} className="text-[var(--sys-blue)]">
                            {t.question!.worker} is waiting on you: #{t.number}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
          </Group>
          <p className="px-4 text-xs text-muted-foreground">
            A team starts in its folder: <code className="font-mono">omicron teams start</code> there.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LoopForm({ session, onStart }: { session: string; onStart: (prompt: string, every: string) => void }) {
  const [prompt, setPrompt] = useState("");
  const [every, setEvery] = useState("10m");
  return (
    <form
      className="flex flex-wrap items-center gap-2 px-4 py-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (prompt.trim()) onStart(prompt.trim(), every.trim());
      }}
    >
      <span className="font-medium">{session}</span>
      <Input aria-label={`Loop prompt for ${session}`} placeholder="Keep going with the next task" value={prompt} onChange={(e) => setPrompt(e.target.value)} className="h-9 min-w-40 flex-1" />
      <Input aria-label={`How often, for ${session}`} value={every} onChange={(e) => setEvery(e.target.value)} className="h-9 w-20 font-mono" />
      <Button type="submit" size="sm" disabled={!prompt.trim()}>
        Start loop
      </Button>
    </form>
  );
}
