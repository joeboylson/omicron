import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/base/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/base/popover";
import { cn } from "@/lib/utils";

export type Choice = { id: string; name: string; mono?: boolean };

/** What's chosen, in one line: names, or how many past a couple. */
export function chosenText(choices: Choice[], picked: Set<string>, none: string): string {
  const names = choices.filter((c) => picked.has(c.id)).map((c) => c.name);
  if (names.length === 0) return none;
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
}

/**
 * A dropdown to pick any number of things (shadcn's Popover and Command):
 * a button saying what's chosen, opening a list that ticks and unticks,
 * with a search box when it's long.
 */
export function MultiSelect({
  label,
  choices,
  picked,
  toggle,
  none = "None",
  nothing = "Nothing matches.",
}: {
  /** Said when nothing matches what's typed. */
  nothing?: string;
  /** What it picks, for screen readers (and tests). */
  label: string;
  choices: Choice[];
  picked: Set<string>;
  toggle: (id: string, on: boolean) => void;
  none?: string;
}) {
  return (
    // Modal: it scrolls even inside a dialog, which holds scrolling to itself.
    <Popover modal>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-label={label} className="w-full justify-between font-normal">
          <span className={cn("truncate", picked.size === 0 && "text-muted-foreground")}>{chosenText(choices, picked, none)}</span>
          <ChevronsUpDown className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent title={label} align="start" className="w-[--radix-popover-trigger-width] p-0">
        <Command>
          {choices.length > 6 && <CommandInput placeholder="Search" aria-label={`Search ${label.toLowerCase()}`} />}
          <CommandList>
            <CommandEmpty>{nothing}</CommandEmpty>
            <CommandGroup>
              {choices.map((c) => {
                const on = picked.has(c.id);
                return (
                  <CommandItem key={c.id} value={`${c.name} ${c.id}`} data-checked={on} onSelect={() => toggle(c.id, !on)}>
                    <Check className={cn(on ? "opacity-100" : "opacity-0")} aria-hidden />
                    <span className={cn("truncate", c.mono && "tabular-nums")}>{c.name}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
