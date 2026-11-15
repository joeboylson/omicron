import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/base/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Plus, X } from "lucide-react";
import { useApp } from "@/lib/app";
import { addLabel, setLabel } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Group, Row } from "@/components/Grouped";
import { type Color } from "@/lib/colors";
import { LabelBadge } from "@/components/TaskCard";
import { type SectionProps } from "@/components/task/save";

/** + Add label: search the Project's other labels, or make a new one from what's typed. */
export function AddLabel({
  labels,
  onPick,
  onCreate,
}: {
  labels: { id: string; name: string; color: string | null }[];
  onPick: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const name = typed.trim();
  const exists = labels.some((l) => l.name.toLowerCase() === name.toLowerCase());
  const done = () => {
    setOpen(false);
    setTyped("");
  };
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o || setTyped(""))}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-11 gap-1 px-2 text-link sm:h-9">
          <Plus /> Add Label
        </Button>
      </PopoverTrigger>
      <PopoverContent title="Labels" align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Label" value={typed} onValueChange={setTyped} />
          <CommandList>
            {!name && labels.length === 0 && <CommandEmpty>Type a name for a new label.</CommandEmpty>}
            <CommandGroup>
              {labels.map((l) => (
                <CommandItem key={l.id} value={`${l.name} ${l.id}`} onSelect={() => (onPick(l.id), done())}>
                  <LabelBadge name={l.name} color={l.color as Color | null} />
                </CommandItem>
              ))}
              {name && !exists && (
                <CommandItem value={`new ${name}`} onSelect={() => (onCreate(name), done())}>
                  <Plus className="h-4 w-4" aria-hidden /> New label “{name}”
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** The task's own labels, each with ×, and Add label. */
export function TaskLabels({ project, task, change }: SectionProps) {
  const { db } = useApp();
  return (
    <Group title="Labels">
      <Row className="flex-wrap gap-1.5 py-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Labels">
          {/* Only the task's own labels, each with ×; the rest are in Add label (like Trello). */}
          {project.labels
            .filter((l) => task.labelIds.includes(l.id))
            .map((l) => (
              <span key={l.id} className="flex min-h-9 items-center gap-0.5">
                <LabelBadge name={l.name} color={l.color as Color | null} />
                <button
                  type="button"
                  aria-label={`Take off ${l.name}`}
                  className="relative flex h-7 w-7 items-center justify-center rounded-full after:absolute after:-inset-2 after:content-[''] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => change(() => setLabel(db, task, l.id, false))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          <AddLabel
            labels={project.labels.filter((l) => !task.labelIds.includes(l.id))}
            onPick={(id) => change(() => setLabel(db, task, id, true))}
            onCreate={(name) => {
              const existing = project.labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
              change(async () => setLabel(db, task, existing?.id ?? (await addLabel(db, project.id, name)), true));
            }}
          />
        </div>
      </Row>
    </Group>
  );
}
