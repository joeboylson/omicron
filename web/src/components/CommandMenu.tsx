// The ⌘K menu: type to find a command (go to a Project, add a task, open
// settings, switch the theme…), arrows to choose, Enter to run.

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { useAllCommands, type Command } from "@/lib/commands";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/base/dialog";
import { cn } from "@/lib/utils";

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const commands = useAllCommands();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQuery("");
      setAt(0);
    }
  }, [open]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => {
      const text = `${c.label} ${c.group} ${c.keywords ?? ""}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
  }, [commands, query]);
  const choose = (c: Command | undefined) => {
    if (!c) return;
    setOpen(false);
    // After the menu has closed, so focus can land where the command puts it.
    setTimeout(c.run, 0);
  };
  useEffect(() => {
    list.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  // Next to each other with the same heading: one group.
  const groups: { name: string; items: { c: Command; i: number }[] }[] = [];
  shown.forEach((c, i) => {
    const last = groups[groups.length - 1];
    if (last && last.name === c.group) last.items.push({ c, i });
    else groups.push({ name: c.group, items: [{ c, i }] });
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="top-[20%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0 sm:top-[20%] sm:translate-y-0 [&>button]:hidden">
        <DialogTitle className="sr-only">Commands</DialogTitle>
        <DialogDescription className="sr-only">Type to find a command, arrows to choose, Enter to run it.</DialogDescription>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setAt((i) => Math.min(i + 1, shown.length - 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setAt((i) => Math.max(i - 1, 0)));
              else if (e.key === "Enter") (e.preventDefault(), choose(shown[at]));
            }}
            placeholder="Type a command or a Project…"
            aria-label="Command"
            role="combobox"
            aria-expanded
            aria-controls="command-list"
            aria-activedescendant={shown[at] ? `command-${at}` : undefined}
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground sm:text-sm"
          />
          <kbd className="hidden rounded border px-1.5 font-mono text-[11px] text-muted-foreground sm:block">esc</kbd>
        </div>
        <div id="command-list" ref={list} role="listbox" aria-label="Commands" className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
          {shown.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">No commands match.</p>}
          {/* Each heading names its group, as screen readers read it. */}
          {groups.map(({ name, items }, g) => (
            <div key={name + g} role="group" aria-labelledby={`command-group-${g}`}>
              <div id={`command-group-${g}`} className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                {name}
              </div>
              {items.map(({ c, i }) => {
                const on = c.checked?.();
                return (
                  <div
                    key={c.id}
                    id={`command-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === at}
                    onMouseMove={() => setAt(i)}
                    onClick={() => choose(c)}
                    className={cn("flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-[15px] sm:text-sm", i === at && "bg-primary text-primary-foreground")}
                  >
                    <span className="flex-1">
                      {c.label}
                      {on && <span className="sr-only"> (now)</span>}
                    </span>
                    {on && <Check className="h-4 w-4" aria-hidden />}
                    {c.shortcut && (
                      <kbd className={cn("rounded border px-1.5 font-mono text-[11px]", i === at ? "border-primary-foreground/50" : "text-muted-foreground")}>{c.shortcut}</kbd>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
