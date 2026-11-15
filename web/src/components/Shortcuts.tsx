// Every keyboard shortcut, in one list: shown in Settings, and in a sheet
// anywhere with "?".
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, focusSheet } from "@/components/base/dialog";
import { useCommands } from "@/lib/commands";
import { go } from "@/lib/app";

// Keys as the computer names them: ⌘ and ⇧ on a Mac, Ctrl+ and Shift+
// elsewhere, always in the same order (HIG keyboards #9).
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? "⌘" : "Ctrl+";
const SHIFT = MAC ? "⇧" : "Shift+";

export const SHORTCUTS: [string, string][] = [
  [`${MOD}K`, "Commands: find a task, go anywhere, change the theme"],
  ["?", "These shortcuts"],
  ["c", "New task, in the column you're in"],
  ["/", "Search tasks"],
  ["Arrows, or j k h l", "Go from task to task on the board"],
  ["Space, then arrows", "Move a task on the board; Space drops it, Escape puts it back"],
  ["Enter", "Open the task that has focus"],
  ["Enter (adding a task)", "Add it and start the next"],
  [`${SHIFT}Enter (adding a task)`, "Add it and open it"],
  ["Enter (a task's title)", "Save the title"],
  [`${MOD}Z`, "Undo the last change"],
  [`${MOD},`, "Settings"],
  ["Arrows (in a menu)", "Go up and down it; Enter picks"],
  ["Escape", "Close what's open, or stop adding"],
];

export function ShortcutList() {
  return (
    <dl className="divide-y text-[0.9375rem] sm:text-sm">
      {SHORTCUTS.map(([k, what]) => (
        <div key={k} className="flex min-h-11 items-center gap-3 px-4 py-1.5">
          <dt className="w-44 shrink-0">
            <span className="sr-only">{k}</span>
            <Keys keys={k} />
          </dt>
          <dd className="text-muted-foreground">{what}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A shortcut's keys, one box per key, with the joining words ("or",
 *  "then") and any "(when)" as plain text. */
export function keyParts(keys: string): { text: string; key: boolean }[] {
  const [main, when] = keys.split(/\s*(?=\()/);
  const parts = main
    .split(/\s+/)
    // "Arrows," is a word and its comma; "⌘," and "Ctrl-," are keys.
    .map((w) => (/^[A-Za-z]{2,},$/.test(w) ? w.slice(0, -1) : w))
    .filter(Boolean)
    .map((w) => ({ text: w, key: !/^(or|then|and)$/.test(w) }));
  return when ? [...parts, { text: when, key: false }] : parts;
}

function Keys({ keys }: { keys: string }) {
  return (
    <span aria-hidden className="flex flex-wrap items-center gap-1 text-xs">
      {keyParts(keys).map((p, i) =>
        p.key ? (
          <kbd key={i} className="whitespace-nowrap rounded border px-1.5 py-0.5">
            {p.text}
          </kbd>
        ) : (
          <span key={i} className="text-muted-foreground">
            {p.text}
          </span>
        ),
      )}
    </span>
  );
}

/** Open the shortcuts sheet from anywhere (Settings has a row for it). */
export function openShortcuts() {
  window.dispatchEvent(new Event("omicron:shortcuts"));
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
    const show = () => setOpen(true);
    // Cmd/Ctrl-, opens Settings, as on a Mac (HIG settings #6).
    const settings = (e: KeyboardEvent) => {
      if (e.key === "," && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        go("/settings");
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keydown", settings);
    window.addEventListener("omicron:shortcuts", show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", settings);
      window.removeEventListener("omicron:shortcuts", show);
    };
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
