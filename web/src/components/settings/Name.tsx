import { useEffect, useState } from "react";
import { useApp } from "@/lib/app";
import { renameProject } from "@/lib/data";
import { Input } from "@/components/base/input";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import type { SectionProps } from "@/components/settings/types";

export function NameSection({ project, change }: SectionProps) {
  const { db } = useApp();
  const [name, setName] = useState(project.name);
  useEffect(() => setName(project.name), [project.name]);
  return (
    <Group title={<label htmlFor="project-name">Name</label>}>
      <Row>
        <Input
          id="project-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const n = name.trim();
            if (!n) setName(project.name);
            else if (n !== project.name) change(() => renameProject(db, project.id, n));
          }}
          className={cn(bare, "px-0")}
        />
      </Row>
    </Group>
  );
}
