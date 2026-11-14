import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useApp, go } from "@/lib/app";
import { useChanges } from "@/lib/live";
import {
  addMember,
  addProjectMachine,
  listMachines,
  listPeople,
  listProjects,
  startProject,
  type MachineRow,
  type Person,
  type ProjectSummary,
} from "@/lib/data";
import { MultiSelect } from "@/components/MultiSelect";
import { Button } from "@/components/base/button";
import { cn } from "@/lib/utils";
import { DataTable, SortHeader, type ColumnDef } from "@/components/DataTable";
import { TopBar } from "@/components/TopBar";
import { DeleteProject } from "@/components/DeleteProject";
import { Input } from "@/components/base/input";
import { ProjectsSkeleton } from "@/components/Skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/base/dialog";

export function ProjectsPage() {
  const { db, act, me } = useApp();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);
  const [name, setName] = useState("");
  const [starting, setStarting] = useState(false);
  // Who and what the new Project starts with: nobody ticked at first.
  const [people, setPeople] = useState<Person[]>([]);
  const [allMachines, setAllMachines] = useState<MachineRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!starting) return;
    setPicked(new Set());
    act(async () => {
      const [p, m] = await Promise.all([listPeople(db), listMachines(db)]);
      setPeople(p.filter((x) => x.id !== me.personId));
      // Machines on every Project already have it.
      setAllMachines(m.filter((x) => x.active && !x.all_projects));
    });
  }, [starting, db, act, me.personId]);
  const toggle = (id: string, on: boolean) =>
    setPicked((now) => {
      const next = new Set(now);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const reload = useCallback(() => {
    act(async () => {
      setProjects(await listProjects(db));
    });
  }, [db, act]);
  useEffect(reload, [reload]);
  useChanges(db, null, reload);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    let id = "";
    const started = await act(async () => {
      id = await startProject(db, n);
      await Promise.all([
        ...people.filter((p) => picked.has(p.id)).map((p) => addMember(db, id, p.id)),
        ...allMachines.filter((m) => picked.has(m.id)).map((m) => addProjectMachine(db, id, m.id)),
      ]);
    });
    if (started) {
      setName("");
      setStarting(false);
      go(`/p/${id}`);
    }
  };

  const count = (key: keyof ProjectSummary, label: string, className?: string, phone?: "end"): ColumnDef<ProjectSummary, number> => ({
    accessorKey: key,
    header: ({ column }) => <SortHeader column={column} label={label} />,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground sm:text-foreground">
        <span className="font-mono">{getValue()}</span>
        {/* On a phone there's no heading above it. */}
        <span className="sm:hidden"> {getValue() === 1 ? label.toLowerCase().replace(/s$/, "") : label.toLowerCase()}</span>
      </span>
    ),
    meta: { className: cn("text-right", className), phone: phone ?? "hide" },
  });
  const columns: ColumnDef<ProjectSummary, any>[] = [
    {
      accessorKey: "name",
      header: ({ column }) => <SortHeader column={column} label="Name" />,
      cell: ({ row }) => (
        <a
          href={`/p/${row.original.id}`}
          className="inline-flex min-h-8 items-center font-medium hover:underline"
          onClick={(e) => {
            e.preventDefault();
            go(`/p/${row.original.id}`);
          }}
        >
          {row.original.name}
        </a>
      ),
      meta: { phone: "main" },
    },
    count("taskCount", "Tasks", undefined, "end"),
    count("memberCount", "People", "hidden sm:table-cell"),
    count("machineCount", "Machines", "hidden sm:table-cell"),
    count("sessionCount", "Sessions", "hidden md:table-cell"),
    {
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          aria-label={`Delete ${row.original.name}…`}
          onClick={() => setDeleting(row.original)}
        >
          <Trash2 />
        </Button>
      ),
      meta: { className: "w-12 py-0 text-right", phone: "end" },
    },
  ];

  return (
    <>
    <TopBar
      here="/"
      title="Projects"
      actions={
        <Button onClick={() => setStarting(true)}>
          <Plus /> New Project
        </Button>
      }
    />
    <main className="mx-auto grid w-full max-w-5xl gap-3 px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      {projects === null ? (
        <ProjectsSkeleton />
      ) : projects.length === 0 ? (
        <p className="py-6 text-muted-foreground">No Projects yet. Start one, or ask someone to add you to theirs.</p>
      ) : (
        <DataTable
          label="Projects"
          columns={columns}
          data={projects}
          initialSort={[{ id: "name", desc: false }]}
          search={{ label: "Search Projects", placeholder: "Search Projects", text: (p) => p.name }}
        />
      )}
      <DeleteProject project={deleting} onOpenChange={(o) => !o && setDeleting(null)} onDeleted={reload} />
      <Dialog open={starting} onOpenChange={setStarting}>
        <DialogContent className="gap-4 sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader className="text-left">
            <DialogTitle>New Project</DialogTitle>
          </DialogHeader>
          <form onSubmit={start} className="grid gap-4">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name, like Kitchen remodel"
              aria-label="New Project name"
            />
            {people.length > 0 && (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">People</span>
                <MultiSelect label="People" none="Just you" choices={people.map((p) => ({ id: p.id, name: p.display_name }))} picked={picked} toggle={toggle} />
              </div>
            )}
            {allMachines.length > 0 && (
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">
                  Machines
                </span>
                <MultiSelect
                  label="Machines"
                  none="No machines"
                  choices={allMachines.map((m) => ({ id: m.id, name: m.name, mono: true }))}
                  picked={picked}
                  toggle={toggle}
                />
              </div>
            )}
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
    </main>
    </>
  );
}

