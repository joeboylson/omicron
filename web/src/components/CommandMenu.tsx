// The ⌘K menu: type to find a command (go to a Project, add a task, open
// settings, switch the theme…), arrows to choose, Enter to run.

import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useAllCommands, type Command } from "@/lib/commands";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const commands = useAllCommands();
  const list = useRef<HTMLUListElement>(null);

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

  let lastGroup = "";
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
        <ul id="command-list" ref={list} role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto p-2">
          {shown.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">No commands match.</li>}
          {shown.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id} role="presentation">
                {header && <div className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{header}</div>}
                <div
                  id={`command-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === at}
                  onMouseMove={() => setAt(i)}
                  onClick={() => choose(c)}
                  className={cn("flex min-h-10 cursor-pointer items-center rounded-md px-2 text-[15px] sm:text-sm", i === at && "bg-accent")}
                >
                  <span className="flex-1">{c.label}</span>
                  {c.shortcut && <kbd className="rounded border px-1.5 font-mono text-[11px] text-muted-foreground">{c.shortcut}</kbd>}
                </div>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
