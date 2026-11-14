import { useEffect, useState } from "react";
import { go, useApp } from "@/lib/app";
import { listMachines, listPeople, type MachineRow, type Person, type ProjectData } from "@/lib/data";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { NameSection } from "@/components/settings/Name";
import { StatusesSection } from "@/components/settings/Statuses";
import { TopicsSection } from "@/components/settings/Topics";
import { LabelsSection } from "@/components/settings/Labels";
import { MembersSection } from "@/components/settings/Members";
import { RunRulesSection } from "@/components/settings/RunRules";
import { MachinesSection } from "@/components/settings/Machines";
import { FoldersSection } from "@/components/settings/Folders";
import { DeleteSection } from "@/components/settings/Delete";

export function ProjectSettings({
  project,
  open,
  onOpenChange,
  onChanged,
}: {
  project: ProjectData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { db, act } = useApp();
  // Open on a Project that uses Claude sessions; folded on one that doesn't.
  const [claudeOpen, setClaudeOpen] = useState(usesClaude(project));
  const [people, setPeople] = useState<Person[]>([]);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  useEffect(() => {
    if (open) {
      act(async () => {
        const [p, m] = await Promise.all([listPeople(db), listMachines(db)]);
        setPeople(p);
        setMachines(m);
      });
    }
  }, [open, db, act]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[92dvh] gap-5 overflow-y-auto bg-muted sm:bg-background"
        onOpenAutoFocus={focusSheet}
      >
        <DialogHeader className="text-left">
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>Changes save as you make them.</DialogDescription>
        </DialogHeader>

        <NameSection {...section} />
        <StatusesSection {...section} />
        <TopicsSection {...section} />
        <LabelsSection {...section} />
        <MembersSection {...section} people={people} />

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

        {/* Remounted each time the sheet opens, so the typed name starts empty. */}
        <DeleteSection
          key={String(open)}
          project={project}
          onDeleted={() => {
            onOpenChange(false);
            go("/");
          }}
        />
      </DialogContent>
    </Dialog>
  );
}





/** Whether a Project uses Claude sessions: it has sessions, folders, or run rules. */
export function usesClaude(project: ProjectData): boolean {
  return project.sessions.length > 0 || project.folders.length > 0 || project.run_rules.trim() !== "";
}
