import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { go, useAddressValue, useApp } from "@/lib/app";
import { listMachines, type MachineRow, type ProjectData } from "@/lib/data";
import type { Dev } from "@/lib/dev";
import { Sharing } from "@/components/ShareSheet";
import { NameSection } from "@/components/settings/Name";
import { StatusesSection } from "@/components/settings/Statuses";
import { TopicsSection } from "@/components/settings/Topics";
import { LabelsSection } from "@/components/settings/Labels";
import { RunRulesSection } from "@/components/settings/RunRules";
import { MachinesSection } from "@/components/settings/Machines";
import { FoldersSection } from "@/components/settings/Folders";
import { DeleteSection } from "@/components/settings/Delete";
import { ThisComputer } from "@/components/ComputerPanel";
import { CopyButton } from "@/components/CopyButton";
import { Group, Row } from "@/components/Grouped";
import { Button } from "@/components/base/button";
import { cn } from "@/lib/utils";

/** One page of a Project's settings, named in the address (`?setting=`). */
export type SettingPage =
  | "name"
  | "people"
  | "statuses"
  | "topics"
  | "labels"
  | "run-rules"
  | "machines"
  | "folders"
  | "computer"
  | "information"
  | "delete";

const TITLES: Record<SettingPage, string> = {
  name: "Name",
  people: "People",
  statuses: "Statuses",
  topics: "Topics",
  labels: "Labels",
  "run-rules": "Run Rules",
  machines: "Machines",
  folders: "Folders",
  computer: "This Computer",
  information: "Information",
  delete: "Delete Project",
};

/**
 * A Project's settings, as its Settings tab: a list, like a phone's
 * Settings (#257), each row opening a page of its own. The page is in the
 * address, so Back returns to the list.
 */
export function ProjectSettings({ project, dev, onChanged }: { project: ProjectData; dev: Dev | null; onChanged: () => void }) {
  const { db, act } = useApp();
  const [inAddress, setInAddress] = useAddressValue("setting");
  const page = inAddress && inAddress in TITLES ? (inAddress as SettingPage) : null;
  const [machines, setMachines] = useState<MachineRow[]>([]);
  useEffect(() => {
    act(async () => {
      setMachines(await listMachines(db));
    });
  }, [db, act]);

  const change = async (work: () => Promise<unknown>) => {
    if (await act(work)) onChanged();
  };
  // Machines change here, and the list is read here: read it again after.
  const changeMachines = async (work: () => Promise<unknown>) => {
    if (await act(work)) {
      setMachines(await listMachines(db));
      onChanged();
    }
  };
  // Machines on every Project are always in it; the rest can be picked
  // (switched-off ones only while they're still in it).
  const pickable = machines.filter((m) => !m.all_projects && (m.active || m.projectIds.includes(project.id)));
  const inProject = machines.filter((m) => m.all_projects || m.projectIds.includes(project.id));
  const section = { project, change };
  // A page that can't show here (This Computer, away from it) is the list.
  const shown = page === "computer" && !dev ? null : page;

  if (shown) {
    return (
      // Named by its heading; its own sections are the regions inside.
      <div className="mx-auto grid w-full max-w-3xl content-start gap-5 px-[max(1rem,env(safe-area-inset-left))] pb-4">
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="-ml-3 h-11 gap-0.5 px-2 text-link sm:h-9" onClick={() => setInAddress(null)}>
            <ChevronLeft className="h-5 w-5" aria-hidden /> Settings
          </Button>
        </div>
        <h2 className="-mt-3 text-xl font-semibold">{TITLES[shown]}</h2>
        {shown === "name" && <NameSection {...section} />}
        {shown === "people" && <Sharing project={project} onChanged={onChanged} />}
        {shown === "statuses" && <StatusesSection {...section} />}
        {shown === "topics" && <TopicsSection {...section} />}
        {shown === "labels" && <LabelsSection {...section} />}
        {shown === "run-rules" && <RunRulesSection {...section} />}
        {shown === "machines" && <MachinesSection project={project} pickable={pickable} changeMachines={changeMachines} />}
        {shown === "folders" && <FoldersSection project={project} />}
        {shown === "computer" && dev && <ThisComputer project={project} dev={dev} onChanged={onChanged} />}
        {shown === "information" && <Information project={project} machines={inProject.length} />}
        {shown === "delete" && <DeleteSection project={project} onDeleted={() => go("/")} />}
      </div>
    );
  }

  const open = (p: SettingPage) => setInAddress(p, true);
  const count = (n: number) => (n === 0 ? "None" : String(n));
  return (
    <section aria-label="Project settings" className="mx-auto grid w-full max-w-3xl content-start gap-5 px-[max(1rem,env(safe-area-inset-left))] pb-4">
      <Group>
        <Link onClick={() => open("name")} label="Name" value={project.name} />
        <Link onClick={() => open("people")} label="People" value={count(project.members.length)} />
      </Group>
      <Group title="Board">
        <Link onClick={() => open("statuses")} label="Statuses" value={count(project.statuses.length)} />
        <Link onClick={() => open("topics")} label="Topics" value={count(project.topics.length)} />
        <Link onClick={() => open("labels")} label="Labels" value={count(project.labels.length)} />
      </Group>
      <Group title="Claude sessions">
        <Link onClick={() => open("run-rules")} label="Run Rules" value={project.run_rules.trim() ? "Set" : "None"} />
        <Link onClick={() => open("machines")} label="Machines" value={count(inProject.length)} />
        <Link onClick={() => open("folders")} label="Folders" value={count(project.folders.length)} />
        {dev && <Link onClick={() => open("computer")} label="This Computer" value={dev.machine} />}
      </Group>
      <Group>
        <Link onClick={() => open("information")} label="Information" />
      </Group>
      <Group>
        <Link onClick={() => open("delete")} label="Delete Project" destructive />
      </Group>
    </section>
  );
}

/** A row that opens a page: its name, what's set now, and a chevron. */
function Link({ label, value, destructive, onClick }: { label: string; value?: ReactNode; destructive?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent"
    >
      <span className={cn("flex-1", destructive && "text-destructive")}>{label}</span>
      {value !== undefined && <span className="max-w-[50%] truncate text-muted-foreground">{value}</span>}
      {!destructive && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
    </button>
  );
}

/** What there is in the Project, in numbers, and its ID for the command line. */
function Information({ project, machines }: { project: ProjectData; machines: number }) {
  const done = new Set(project.statuses.filter((s) => s.is_done).map((s) => s.id));
  const finished = project.tasks.filter((t) => done.has(t.status_id)).length;
  const rows: [string, ReactNode][] = [
    ["Tasks", project.tasks.length],
    ["Open", project.tasks.length - finished],
    ["Done", finished],
    ["People", project.members.length],
    ["Machines", machines],
    ["Claude sessions", project.sessions.length],
    ["Running loops", project.loops.length + project.runs.filter((r) => r.state === "running" || r.state === "pausing").length],
  ];
  return (
    <>
      <Group>
        {rows.map(([label, value]) => (
          <Row key={label}>
            <span className="flex-1">{label}</span>
            <span className="tabular-nums text-muted-foreground">{value}</span>
          </Row>
        ))}
      </Group>
      <Group>
        <Row className="py-2">
          <span className="flex-1">Project ID</span>
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{project.id}</span>
          <CopyButton text={project.id} label="Copy Project ID" />
        </Row>
      </Group>
    </>
  );
}

/** Whether a Project uses Claude sessions: it has sessions, folders, or run rules. */
export function usesClaude(project: ProjectData): boolean {
  return project.sessions.length > 0 || project.folders.length > 0 || project.run_rules.trim() !== "";
}
