import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useApp } from "@/lib/app";
import { deleteLabel, renameLabel, setLabelColor, type Label } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { type Color } from "@/lib/colors";
import { ColorSelect } from "@/components/ColorDot";
import type { SectionProps } from "@/components/settings/types";

export function LabelsSection({ project, change }: SectionProps) {
  return (
    <>
      {project.labels.length > 0 && (
        <Group title="Labels">
          <ul className="divide-y" aria-label="Labels">
            {project.labels.map((l) => (
              <LabelRow key={l.id} label={l} count={project.tasks.filter((t) => t.labelIds.includes(l.id)).length} change={change} />
            ))}
          </ul>
        </Group>
      )}
    </>
  );
}

function LabelRow({
  label,
  count,
  change,
}: {
  label: Label;
  count: number;
  change: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const { db } = useApp();
  const [name, setName] = useState(label.name);
  useEffect(() => setName(label.name), [label.name]);
  return (
    <li>
      <Row>
        <ColorSelect
          value={(label.color as Color | null) ?? "gray"}
          label={`Color of label ${label.name}`}
          className="-ml-2"
          onChange={(c) => change(() => setLabelColor(db, label, c))}
        />
        <Input
          value={name}
          aria-label={`Label name: ${label.name}`}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={() => {
            const n = name.trim();
            if (!n) setName(label.name);
            else if (n !== label.name) change(() => renameLabel(db, label, n));
          }}
          className={cn(bare, "px-0")}
        />
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground" title={`On ${count} ${count === 1 ? "task" : "tasks"}`}>
          {count}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 shrink-0 text-destructive hover:text-destructive"
          aria-label={`Remove label ${label.name}`}
          onClick={() => change(() => deleteLabel(db, label))}
        >
          <Trash2 />
        </Button>
      </Row>
    </li>
  );
}
