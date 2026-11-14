import { type ProjectData } from "@/lib/data";
import { Group, Row } from "@/components/Grouped";

export function FoldersSection({ project }: { project: ProjectData }) {
  return (
    <Group
      title="Folders"
      label="Folders"
    >
      {project.folders.length === 0 ? (
        <Row className="text-sm text-muted-foreground">No folders yet.</Row>
      ) : (
        project.folders.map((f) => (
          <Row key={f.id} className="py-2">
            <span className="min-w-0 flex-1 truncate font-mono text-sm" title={f.path}>
              {f.path}
            </span>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{f.machine}</span>
          </Row>
        ))
      )}
    </Group>
  );
}
