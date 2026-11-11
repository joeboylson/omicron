// Commands for the ⌘K menu. Each page registers the ones that make sense
// there (useCommands); the menu shows them all, grouped.

import { useEffect, useState } from "react";

export type Command = {
  id: string;
  label: string;
  group: string;
  /** Extra words it can be found by. */
  keywords?: string;
  /** A key that does the same outside the menu, shown beside it. */
  shortcut?: string;
  run: () => void;
};

const sources = new Map<string, Command[]>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** Offer these commands while the calling component is shown. */
export function useCommands(source: string, commands: Command[]) {
  useEffect(() => {
    sources.set(source, commands);
    changed();
  });
  useEffect(
    () => () => {
      sources.delete(source);
      changed();
    },
    [source],
  );
}

export function useAllCommands(): Command[] {
  const [, setVersion] = useState(0);
  useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return [...sources.values()].flat();
}

/** True while someone is typing in a box (so single-key shortcuts stay out of the way). */
export function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.getAttribute("role") === "combobox");
}
