// A Project's Loops tab (#253). A loop is one thing, of two kinds: a
// command typed into a session again and again, or a set of tasks a
// session works down one at a time (a run). Loops can be drafted first
// (tasks gathered over time, from the Tasks page too) and kept as
// templates to start new ones from.
import { useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { useApp } from "@/lib/app";
import { devAction, type Dev } from "@/lib/dev";
import {
  addPlan,
  changePlan,
  deletePlan,
  sayEvery,
  setRunState,
  startLoop,
  stopLoop,
  type ClaudeSession,
  type LoopPlan,
  type ProjectData,
  type Run,
  type SessionLoop,
} from "@/lib/data";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/base/dropdown-menu";
import { DataTable, SortHeader, type ColumnDef } from "@/components/DataTable";
import { Confirm } from "@/components/base/confirm";
import { RunSheet } from "@/components/RunBar";
import { cn, radioArrows } from "@/lib/utils";

type State = "Draft" | "Running" | "Pausing" | "Stopped" | "Finished";
type Row = {
  key: string;
  kind: "command" | "tasks";
  what: string;
  session: string | null;
  state: State;
  progress: string;
  when: string;
  plan?: LoopPlan;
  run?: Run;
  loop?: SessionLoop;
};

const EVERY: [number, string][] = [
  [300, "5 minutes"],
  [600, "10 minutes"],
  [900, "15 minutes"],
  [1800, "30 minutes"],
  [3600, "hour"],
];

/** What a loop does, in a few words: its command, or how many tasks. */
function describe(kind: "command" | "tasks", prompt: string, taskCount: number | null): string {
  if (kind === "command") return prompt.trim() || "(no command yet)";
  if (taskCount === null) return "The top status's tasks";
  return `${taskCount} ${taskCount === 1 ? "task" : "tasks"}`;
}

export function LoopsTab({ project, dev, onChanged }: { project: ProjectData; dev: Dev | null; onChanged: () => void }) {
  const { db, act } = useApp();
  const [pane, setPane] = useState<"loops" | "templates">("loops");
  // The New Loop sheet: fresh, from a draft, or from a template.
  const [wizard, setWizard] = useState<{ from?: LoopPlan } | null>(null);
  const [openRun, setOpenRun] = useState<Run | null>(null);
  const [naming, setNaming] = useState<{ kind: "command" | "tasks"; prompt: string; every_seconds: number | null; times: number | null; name: string } | null>(null);
  const [deleting, setDeleting] = useState<LoopPlan | null>(null);
  const change = async (work: () => Promise<unknown>) => {
    if (await act(work)) onChanged();
  };
  const sessionName = (id: string | null) => project.sessions.find((s) => s.id === id)?.name ?? null;
  const drafts = project.plans.filter((p) => !p.template);
  const templates = project.plans.filter((p) => p.template);
  const rows: Row[] = [
    ...drafts.map((p) => ({
      key: `p${p.id}`,
      kind: p.kind,
      what: p.name || describe(p.kind, p.prompt, p.task_ids.length),
      session: sessionName(p.session_id),
      state: "Draft" as State,
      progress: p.kind === "tasks" ? describe("tasks", "", p.task_ids.length) : p.every_seconds ? `every ${sayEvery(p.every_seconds)}` : "",
      when: p.created_at,
      plan: p,
    })),
    ...project.runs.map((r) => ({
      key: `r${r.id}`,
      kind: "tasks" as const,
      what: describe("tasks", "", r.task_ids ? r.task_ids.length : null),
      session: sessionName(r.session_id),
      state: ({ running: "Running", pausing: "Pausing", stopped: "Stopped", finished: "Finished" } as const)[r.state],
      progress: r.task_ids ? `${r.done} of ${r.task_ids.length} done` : `${r.done} done`,
      when: r.started_at,
      run: r,
    })),
    ...[...project.loops, ...project.pastLoops].map((l) => ({
      key: `l${l.id}`,
      kind: "command" as const,
      what: l.prompt,
      session: sessionName(l.session_id),
      state: (l.state === "finished" ? "Finished" : l.state === "stopped" ? "Stopped" : "Running") as State,
      progress: `${l.times ? `${l.runs} of ${l.times}` : `${l.runs}`} runs, every ${sayEvery(l.every_seconds)}`,
      when: l.started_at ?? l.next_run_at,
      loop: l,
    })),
  ];
  const asTemplate = (r: Row) => {
    const prompt = r.plan?.prompt ?? r.loop?.prompt ?? "";
    setNaming({
      kind: r.kind,
      prompt,
      every_seconds: r.plan?.every_seconds ?? r.loop?.every_seconds ?? null,
      times: r.plan?.times ?? r.loop?.times ?? null,
      name: r.kind === "command" ? prompt.slice(0, 40) : "Work through tasks",
    });
  };
  const columns: ColumnDef<Row, any>[] = [
    {
      id: "what",
      accessorFn: (r) => r.what,
      header: ({ column }) => <SortHeader column={column} label="Loop" />,
      cell: ({ row: { original: r } }) => (
        <button
          type="button"
          className="grid min-w-0 text-left"
          onClick={() => (r.plan ? setWizard({ from: r.plan }) : r.run ? setOpenRun(r.run) : undefined)}
        >
          <span className="line-clamp-2 font-medium">{r.what}</span>
          <span className="text-xs text-muted-foreground">{r.kind === "command" ? "A command, repeated" : "Tasks, one at a time"}</span>
        </button>
      ),
      meta: { phone: "main" },
    },
    {
      id: "session",
      accessorFn: (r) => r.session ?? "",
      header: ({ column }) => <SortHeader column={column} label="Session" />,
      cell: ({ getValue }) => <span className={getValue() ? "" : "text-muted-foreground"}>{getValue() || "None yet"}</span>,
      meta: { className: "hidden sm:table-cell", phone: "below" },
    },
    {
      id: "state",
      accessorFn: (r) => r.state,
      header: ({ column }) => <SortHeader column={column} label="State" />,
      cell: ({ row: { original: r } }) => (
        <span className={cn(r.state === "Running" && "text-[var(--sys-green)]", r.state === "Draft" && "text-muted-foreground")}>
          {r.state}
          {r.progress && <span className="block text-xs text-muted-foreground">{r.progress}</span>}
        </span>
      ),
      meta: { phone: "below" },
    },
    {
      id: "more",
      header: () => <span className="sr-only">More</span>,
      enableSorting: false,
      cell: ({ row: { original: r } }) => (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={`More for ${r.what}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {r.plan && <DropdownMenuItem onSelect={() => setWizard({ from: r.plan })}>Start…</DropdownMenuItem>}
              {r.run && r.run.state === "running" && (
                <DropdownMenuItem onSelect={() => change(() => setRunState(db, r.run!, "pausing"))}>Pause After This Task</DropdownMenuItem>
              )}
              {r.run && (r.run.state === "running" || r.run.state === "pausing") && (
                <DropdownMenuItem onSelect={() => change(() => setRunState(db, r.run!, "stopped"))}>Stop Now</DropdownMenuItem>
              )}
              {r.loop && r.state === "Running" && <DropdownMenuItem onSelect={() => change(() => stopLoop(db, r.loop!))}>Stop</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => asTemplate(r)}>Make Template…</DropdownMenuItem>
              {r.plan && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(r.plan!)}>
                    Delete Draft
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
      meta: { className: "w-0", phone: "end" },
    },
  ];
  const templateColumns: ColumnDef<LoopPlan, any>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <SortHeader column={column} label="Template" />,
      cell: ({ row: { original: t } }) => (
        <span className="grid min-w-0">
          <span className="font-medium">{t.name || describe(t.kind, t.prompt, null)}</span>
          <span className="line-clamp-2 text-xs text-muted-foreground">
            {t.kind === "command" ? `${t.prompt}${t.every_seconds ? ` · every ${sayEvery(t.every_seconds)}` : ""}` : "Tasks, chosen when it's used"}
          </span>
        </span>
      ),
      meta: { phone: "main" },
    },
    {
      id: "use",
      header: () => <span className="sr-only">Use</span>,
      enableSorting: false,
      cell: ({ row: { original: t } }) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" className="text-link" onClick={() => setWizard({ from: t })}>
            Use
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleting(t)}>
            Delete
          </Button>
        </div>
      ),
      meta: { className: "w-0 whitespace-nowrap", phone: "end" },
    },
  ];

  return (
    <section aria-label="Loops" className="mx-auto grid w-full max-w-4xl content-start gap-3 px-[max(1rem,env(safe-area-inset-left))] pb-4">
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label="Show" className="grid grid-cols-2 rounded-lg bg-muted p-0.5 max-sm:flex-1 sm:w-64">
          {(
            [
              ["loops", "Loops"],
              ["templates", "Templates"],
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
              className={cn("min-h-9 rounded-md text-sm transition-colors", pane === p ? "bg-background font-medium shadow-sm" : "text-foreground/75")}
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" className="ml-auto gap-1" onClick={() => setWizard({})}>
          <Plus className="h-4 w-4" aria-hidden /> New Loop
        </Button>
      </div>
      {pane === "loops" ? (
        <DataTable
          label="Loops"
          columns={columns}
          data={rows}
          initialSort={[]}
          rowLabel={(r) => r.what}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">No loops yet.</p>}
        />
      ) : (
        <DataTable
          label="Templates"
          columns={templateColumns}
          data={templates}
          rowLabel={(t) => t.name}
          empty={<p className="py-6 text-center text-sm text-muted-foreground">No templates. Any loop can be made into one from its ⋯ menu.</p>}
        />
      )}
      {wizard && <NewLoop project={project} dev={dev} from={wizard.from} onClose={() => setWizard(null)} onChanged={onChanged} />}
      <Dialog open={openRun !== null} onOpenChange={(o) => !o && setOpenRun(null)}>
        <DialogContent className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:bg-background" onOpenAutoFocus={focusSheet}>
          {openRun && <RunSheet project={project} run={openRun} />}
        </DialogContent>
      </Dialog>
      <Dialog open={naming !== null} onOpenChange={(o) => !o && setNaming(null)}>
        <DialogContent noClose className="gap-4 sm:max-w-md">
          <DialogHeader className="text-left">
            <DialogTitle>Make Template</DialogTitle>
            <DialogDescription className="sr-only">A name for the template.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!naming) return;
              const { name, ...rest } = naming;
              change(() => addPlan(db, project, { ...rest, name: name.trim(), template: true })).then(() => (setNaming(null), setPane("templates")));
            }}
          >
            <div className="grid gap-1.5">
              <label htmlFor="template-name" className="text-sm font-medium">
                Name
              </label>
              <Input id="template-name" autoFocus value={naming?.name ?? ""} onChange={(e) => naming && setNaming({ ...naming, name: e.target.value })} />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="ghost" onClick={() => setNaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!naming?.name.trim()}>
                Make Template
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Confirm
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={deleting?.template ? `Delete the template “${deleting.name}”?` : "Delete this draft?"}
        action={deleting?.template ? "Delete Template" : "Delete Draft"}
        onConfirm={() => deleting && change(() => deletePlan(db, deleting)).then(() => setDeleting(null))}
      />
    </section>
  );
}

type Step = "kind" | "template" | "command" | "tasks" | "session";

/**
 * New Loop, step by step: what kind (a command, a set of tasks, or a
 * template), then the command or the tasks, then the session; started at
 * once or saved as a draft. Opened on a draft, it picks up where the draft
 * is; on a template, it starts from it (a template's tasks and session are
 * always chosen fresh).
 */
function NewLoop({
  project,
  dev,
  from,
  onClose,
  onChanged,
}: {
  project: ProjectData;
  dev: Dev | null;
  from?: LoopPlan;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { db, act } = useApp();
  const draft = from && !from.template ? from : undefined;
  const [kind, setKind] = useState<"command" | "tasks">(from?.kind ?? "command");
  const [prompt, setPrompt] = useState(from?.prompt ?? "");
  const [every, setEvery] = useState(from?.every_seconds ?? 600);
  const [times, setTimes] = useState<number | null>(from?.times ?? null);
  const [picked, setPicked] = useState<string[]>(draft?.task_ids ?? []);
  const [sessionId, setSessionId] = useState<string | null>(draft?.session_id ?? null);
  const [query, setQuery] = useState("");
  const [step, setStep] = useState<Step>(from ? (from.kind === "tasks" && picked.length === 0 ? "tasks" : draft ? "session" : from.kind) : "kind");
  const [back, setBack] = useState<Step[]>([]);
  const go = (s: Step) => (setBack((b) => [...b, step]), setStep(s));
  const templates = project.plans.filter((p) => p.template);
  const done = new Set(project.statuses.filter((s) => s.is_done).map((s) => s.id));
  const open = project.tasks.filter((t) => !done.has(t.status_id));
  const shown = open.filter((t) => !query.trim() || `#${t.number} ${t.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  // Sessions a loop can run in: this computer's when it serves the page, else any.
  const sessions: ClaudeSession[] = project.sessions.filter((s) => !dev || s.machine_id === dev.machine_id);
  // A session holds one loop at a time, so one already on a loop can't take another.
  const busy = new Set([
    ...project.runs.filter((r) => r.state === "running" || r.state === "pausing").map((r) => r.session_id),
    ...project.loops.map((l) => l.session_id),
  ]);
  const session = sessions.find((s) => s.id === sessionId && !busy.has(s.id)) ?? null;
  const fields = () => ({
    kind,
    prompt: kind === "command" ? prompt.trim() : "",
    every_seconds: kind === "command" ? every : null,
    times: kind === "command" ? times : null,
    task_ids: kind === "tasks" ? picked : [],
    session_id: sessionId,
  });
  const saveDraft = () =>
    act(async () => {
      if (draft) await changePlan(db, draft, fields());
      else await addPlan(db, project, fields());
      onChanged();
      onClose();
    });
  const start = () =>
    act(async () => {
      if (!session) return;
      if (dev && session.machine_id === dev.machine_id) {
        // On its own computer: started by the computer itself, so remote
        // control being off doesn't hold it (#152).
        const numbers = picked.map((id) => project.tasks.find((t) => t.id === id)?.number).filter(Boolean);
        await devAction(
          db,
          "/run",
          kind === "command"
            ? { action: "loops-start", session: session.name, project: project.name, prompt: prompt.trim(), every: sayEvery(every), times: times ? String(times) : "" }
            : { action: "runs-start", session: session.name, project: project.name, tasks: numbers.join(",") },
        );
      } else {
        await startLoop(db, session, kind === "command" ? { kind, prompt: prompt.trim(), every_seconds: every, times } : { kind, task_ids: picked });
      }
      if (draft) await deletePlan(db, draft);
      onChanged();
      onClose();
    });
  const title = { kind: "New Loop", template: "From a Template", command: "The Command", tasks: "The Tasks", session: "The Session" }[step];
  const canNext = step === "command" ? prompt.trim() !== "" : step === "tasks" ? picked.length > 0 : true;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent noClose className="max-h-[92dvh] gap-4 overflow-y-auto sm:max-w-lg" onOpenAutoFocus={focusSheet}>
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">Setting up a loop, step by step.</DialogDescription>
        </DialogHeader>

        {step === "kind" && (
          <div className="grid gap-2" role="group" aria-label="What kind of loop">
            {(
              [
                ["command", "Repeat a Command", "One message typed into a session, every so often."],
                ["tasks", "Work Through Tasks", "A session takes chosen tasks one at a time."],
                ...(templates.length ? ([["template", "Use a Template", "Start from one you've kept."]] as const) : []),
              ] as const
            ).map(([k, label, line]) => (
              <button
                key={k}
                type="button"
                className="grid rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  if (k === "template") go("template");
                  else (setKind(k), go(k));
                }}
              >
                <span className="font-medium">{label}</span>
                <span className="text-sm text-muted-foreground">{line}</span>
              </button>
            ))}
          </div>
        )}

        {step === "template" && (
          <ul aria-label="Templates" className="grid gap-2">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className="grid w-full rounded-lg border px-4 py-3 text-left hover:bg-accent"
                  onClick={() => {
                    setKind(t.kind);
                    setPrompt(t.prompt);
                    setEvery(t.every_seconds ?? 600);
                    setTimes(t.times);
                    go(t.kind);
                  }}
                >
                  <span className="font-medium">{t.name || describe(t.kind, t.prompt, null)}</span>
                  <span className="line-clamp-2 text-sm text-muted-foreground">{t.kind === "command" ? t.prompt : "Tasks, chosen next"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {step === "command" && (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <label htmlFor="loop-command" className="text-sm font-medium">
                Message
              </label>
              <Textarea id="loop-command" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Keep going with the next task" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1.5 text-sm font-medium">
                Every
                <select value={every} onChange={(e) => setEvery(Number(e.target.value))} className="h-10 rounded-md border bg-background px-2 font-normal">
                  {EVERY.map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                How many times
                <select
                  value={times ?? ""}
                  onChange={(e) => setTimes(e.target.value ? Number(e.target.value) : null)}
                  className="h-10 rounded-md border bg-background px-2 font-normal"
                >
                  <option value="">Until stopped</option>
                  {[3, 5, 10, 20, 50].map((n) => (
                    <option key={n} value={n}>
                      {n} times
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {step === "tasks" && (
          <div className="grid gap-2">
            <Input type="search" aria-label="Filter tasks" placeholder="Filter tasks" value={query} onChange={(e) => setQuery(e.target.value)} />
            <ul aria-label="Tasks to work through" className="max-h-[45dvh] divide-y overflow-y-auto rounded-lg border">
              {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted-foreground">Nothing matches.</li>}
              {shown.map((t) => {
                const on = picked.includes(t.id);
                return (
                  <li key={t.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-1.5 text-sm">
                      <Checkbox checked={on} onCheckedChange={(v) => setPicked((p) => (v ? [...p, t.id] : p.filter((x) => x !== t.id)))} />
                      <span className="tabular-nums text-muted-foreground">#{t.number}</span>
                      <span className="min-w-0 flex-1">{t.title}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <span className="text-sm text-muted-foreground" aria-live="polite">
              {picked.length} {picked.length === 1 ? "task" : "tasks"} chosen, worked in the order chosen
            </span>
          </div>
        )}

        {step === "session" && (
          <div role="radiogroup" aria-label="Session" className="grid gap-2">
            {sessions.length === 0 && <p className="text-sm text-muted-foreground">No Claude sessions to run it in yet. Save it as a draft for now.</p>}
            {sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={sessionId === s.id && !busy.has(s.id)}
                disabled={busy.has(s.id)}
                onKeyDown={radioArrows}
                onClick={() => setSessionId(s.id)}
                className={cn(
                  "grid rounded-lg border px-4 py-2.5 text-left disabled:opacity-50",
                  sessionId === s.id && !busy.has(s.id) ? "border-[var(--sys-blue)] ring-1 ring-[var(--sys-blue)]" : "enabled:hover:bg-accent",
                )}
              >
                <span className="font-medium">{s.name}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {busy.has(s.id) ? "On a loop" : `${s.folder ?? "No folder"} · ${s.machine}`}
                </span>
              </button>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="ghost" onClick={() => (back.length ? (setStep(back[back.length - 1]), setBack((b) => b.slice(0, -1))) : onClose())}>
            {back.length ? "Back" : "Cancel"}
          </Button>
          {(step === "command" || step === "tasks") && (
            <Button type="button" disabled={!canNext} onClick={() => go("session")}>
              Next
            </Button>
          )}
          {step === "session" && (
            <>
              <Button type="button" variant="outline" onClick={saveDraft}>
                Save as Draft
              </Button>
              <Button type="button" disabled={!session} onClick={start}>
                Start
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
