import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useApp } from "@/lib/app";
import { addChecklistItem, deleteChecklistItem, tickChecklistItem } from "@/lib/data";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Group, Row, bare } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { type SectionProps } from "@/components/task/save";

/** The checklist: ticks show at once, before the save comes back. */
export function TaskChecklist({ task, change }: SectionProps) {
  const { db } = useApp();
  const [newItem, setNewItem] = useState("");
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  // Once a reload shows the saved value, stop showing our own. A reload
  // that lands before the save keeps it, so the box doesn't flicker back.
  useEffect(
    () =>
      setTicked((t) => {
        const left = Object.fromEntries(Object.entries(t).filter(([id, done]) => task.checklist.some((c) => c.id === id && c.done !== done)));
        return Object.keys(left).length === Object.keys(t).length ? t : left;
      }),
    [task.checklist],
  );
  return (
    <Group
      id="task-checklist"
      label="Checklist"
      title={
        <>
          Checklist
          {task.checklist.length > 0 && (
            <span className="ml-2 font-mono normal-case">
              {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
            </span>
          )}
        </>
      }
    >
      <ul aria-label="Checklist" className={cn("divide-y", task.checklist.length === 0 && "hidden")}>
        {task.checklist.map((item) => (
          <li key={item.id} className="group">
            <Row>
              <Checkbox
                id={`item-${item.id}`}
                className="h-5 w-5 rounded-full"
                checked={ticked[item.id] ?? item.done}
                onCheckedChange={(v) => {
                  setTicked((t) => ({ ...t, [item.id]: v === true }));
                  change(() => tickChecklistItem(db, item, v === true));
                }}
              />
              <label
                htmlFor={`item-${item.id}`}
                className={cn("flex-1 py-2 text-[15px] sm:text-sm", (ticked[item.id] ?? item.done) && "text-muted-foreground line-through")}
              >
                {item.text}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${item.text}`}
                // Quieter than the tickbox: faint on a phone, shown on hover with a mouse.
                className="-mr-2 text-muted-foreground/50 [&_svg]:size-4 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
                onClick={() => change(() => deleteChecklistItem(db, item))}
              >
                <X />
              </Button>
            </Row>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const text = newItem.trim();
          if (text) change(async () => (await addChecklistItem(db, task, text), setNewItem("")));
        }}
      >
        <Row>
          <Plus className="h-5 w-5 text-muted-foreground" aria-hidden />
          <Input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            placeholder="Add an item"
            aria-label="New checklist item"
            className={cn(bare, "px-0")}
          />
          <Button type="submit" variant="ghost" size="sm" aria-label="Add item" disabled={!newItem.trim()}>
            Add
          </Button>
        </Row>
      </form>
    </Group>
  );
}
