// Every keyboard shortcut, in one list: shown in Settings, and in a sheet
// anywhere with "?".
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { useCommands } from "@/lib/commands";

export const SHORTCUTS: [string, string][] = [
  ["⌘K or Ctrl-K", "Commands: go anywhere, open or move a task, change the theme"],
  ["?", "These shortcuts"],
  ["c", "New task, in the column you're in"],
  ["/", "Search tasks"],
  ["Arrows, or j k h l", "Go from task to task on the board"],
  ["Space, then arrows", "Move a task on the board; Space drops it, Escape puts it back"],
  ["Enter", "Open the task that has focus"],
  ["Enter (adding a task)", "Add it and start the next"],
  ["Shift+Enter (adding a task)", "Add it and open it"],
  ["Enter (a task's title)", "Save the title"],
  ["⌘Z or Ctrl-Z", "Bring back the task just deleted"],
  ["Arrows (in a menu)", "Go up and down it; Enter picks"],
  ["Escape", "Close what's open, or stop adding"],
];

export function ShortcutList() {
  return (
    <dl className="divide-y text-[15px] sm:text-sm">
      {SHORTCUTS.map(([k, what]) => (
        <div key={k} className="flex min-h-11 items-center gap-3 px-4 py-1.5">
          <dt className="w-44 shrink-0">
            <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
          </dt>
          <dd className="text-muted-foreground">{what}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "?" (when not typing) opens the shortcuts; so does the command menu. */
export function ShortcutsSheet() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest(".xterm"));
      if (e.key !== "?" || typing || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useCommands("shortcuts", [{ id: "shortcuts", label: "Keyboard shortcuts", group: "Help", shortcut: "?", keywords: "keys help", run: () => setOpen(true) }]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92dvh] gap-4 overflow-y-auto sm:max-w-xl" onOpenAutoFocus={focusSheet}>
        <DialogHeader className="text-left">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription className="sr-only">Every keyboard shortcut.</DialogDescription>
        </DialogHeader>
        <ShortcutList />
      </DialogContent>
    </Dialog>
  );
}
