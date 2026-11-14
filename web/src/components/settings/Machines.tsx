import { useApp } from "@/lib/app";
import { addProjectMachine, removeProjectMachine, type MachineRow, type ProjectData } from "@/lib/data";
import { Group, Row } from "@/components/Grouped";
import { MultiSelect } from "@/components/MultiSelect";

export function MachinesSection({ project, pickable, changeMachines }: {
  project: ProjectData;
  pickable: MachineRow[];
  changeMachines: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const { db } = useApp();
  return (
    <Group title="Machines">
      <Row className="py-2">
        <MultiSelect
          label="Machines"
          none="No machines"
          choices={pickable.map((m) => ({ id: m.id, name: m.name, mono: true }))}
          picked={new Set(pickable.filter((m) => m.projectIds.includes(project.id)).map((m) => m.id))}
          toggle={(id, on) => changeMachines(() => (on ? addProjectMachine(db, project.id, id) : removeProjectMachine(db, project.id, id)))}
        />
      </Row>
    </Group>
  );
}
