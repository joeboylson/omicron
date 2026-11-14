import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/base/popover";
import { initials } from "@/components/TaskCard";
import { useApp } from "@/lib/app";
import { addMember, removeMember, type Person } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Group, Row } from "@/components/Grouped";
import type { SectionProps } from "@/components/settings/types";

export function MembersSection({ project, change, people }: SectionProps & { people: Person[] }) {
  const { db, me } = useApp();
  return (
    <Group title="Members">
      <ul aria-label="Members" className="divide-y">
        {[...project.members]
          .sort((a, b) => Number(b.id === me.personId) - Number(a.id === me.personId) || a.display_name.localeCompare(b.display_name))
          .map((m) => (
            <li key={m.id}>
              <Row>
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium">
                  {initials(m.display_name)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {m.display_name}
                  {m.id === me.personId && <span className="text-muted-foreground"> (you)</span>}
                </span>
                {m.id !== me.personId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    aria-label={`Take ${m.display_name} out of this Project`}
                    onClick={() => change(() => removeMember(db, project.id, m.id))}
                  >
                    <X />
                  </Button>
                )}
              </Row>
            </li>
          ))}
      </ul>
      <Row className="py-2">
        <AddMember
          people={people.filter((p) => !project.members.some((m) => m.id === p.id))}
          onAdd={(id) => change(() => addMember(db, project.id, id))}
        />
      </Row>
    </Group>
  );
}

/** Add member: pick from people not in the Project yet (Popover + Command). */
function AddMember({ people, onAdd }: { people: Person[]; onAdd: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="-mx-2 justify-start gap-2 px-2 text-link">
          <UserPlus /> Add member
        </Button>
      </PopoverTrigger>
      <PopoverContent title="Add member" align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search people" />
          <CommandList>
            <CommandEmpty>Not here yet? Send them the link: they show up once they’ve opened it.</CommandEmpty>
            <CommandGroup>
              {people.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.display_name} ${p.id}`}
                  onSelect={() => {
                    onAdd(p.id);
                    setOpen(false);
                  }}
                >
                  {p.display_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
