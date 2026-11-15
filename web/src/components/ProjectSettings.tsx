import { useEffect, useState } from "react";
import { go, useApp } from "@/lib/app";
import { listMachines, type MachineRow, type ProjectData } from "@/lib/data";
import { Sharing } from "@/components/ShareSheet";
import { NameSection } from "@/components/settings/Name";
import { StatusesSection } from "@/components/settings/Statuses";
import { TopicsSection } from "@/components/settings/Topics";
import { LabelsSection } from "@/components/settings/Labels";
import { RunRulesSection } from "@/components/settings/RunRules";
import { MachinesSection } from "@/components/settings/Machines";
import { FoldersSection } from "@/components/settings/Folders";
import { DeleteSection } from "@/components/settings/Delete";

/** A Project's settings, as its Settings tab (#248): who's in it, then its
 *  name, columns and labels, what Claude sessions use, and deleting it. */
export function ProjectSettings({ project, onChanged }: { project: ProjectData; onChanged: () => void }) {
  const { db, act } = useApp();
  // Open on a Project that uses Claude sessions; folded on one that doesn't.
  const [claudeOpen, setClaudeOpen] = useState(usesClaude(project));
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
  // A Project with a machine uses Claude sessions too: open, once they load.
  const hasMachine = machines.some((m) => !m.all_projects && m.projectIds.includes(project.id));
  useEffect(() => {
    if (hasMachine) setClaudeOpen(true);
  }, [hasMachine]);
  const section = { project, change };

  return (
    <section aria-label="Project settings" className="mx-auto grid w-full max-w-3xl gap-5 px-[max(1rem,env(safe-area-inset-left))] pb-4">
      <NameSection {...section} />
      <Sharing project={project} onChanged={onChanged} />
      <StatusesSection {...section} />
      <TopicsSection {...section} />
      <LabelsSection {...section} />

      {/* What only Claude sessions use, together and out of the way on a
          Project without any (a household board). */}
      <details open={claudeOpen} onToggle={(e) => setClaudeOpen((e.target as HTMLDetailsElement).open)} className="grid gap-5">
        <summary className="cursor-pointer select-none px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Claude sessions
        </summary>
        <div className="mt-5 grid gap-5">
          <RunRulesSection {...section} />
          <MachinesSection project={project} pickable={pickable} changeMachines={changeMachines} />
          <FoldersSection project={project} />
        </div>
      </details>

      <DeleteSection project={project} onDeleted={() => go("/")} />
    </section>
  );
}

/** Whether a Project uses Claude sessions: it has sessions, folders, or run rules. */
export function usesClaude(project: ProjectData): boolean {
  return project.sessions.length > 0 || project.folders.length > 0 || project.run_rules.trim() !== "";
}
