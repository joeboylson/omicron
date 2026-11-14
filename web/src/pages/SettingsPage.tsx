// Your settings. First: appearance (Light, Dark, or match the system),
// saved with you so it follows you between devices.

import { useEffect, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { go, useApp } from "@/lib/app";
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from "@/lib/theme";
import { TopBar } from "@/components/TopBar";
import { Group } from "@/components/Grouped";
import { cn } from "@/lib/utils";

const CHOICES: { value: Appearance; label: string }[] = [
  { value: "system", label: "Match the system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export function SettingsPage() {
  const { db, act, me } = useApp();
  const [appearance, setAppearance] = useState<Appearance | null>(null);
  useEffect(() => {
    act(async () => setAppearance(await loadAppearance(db, me.personId)));
  }, [db, act, me.personId]);

  const choose = (a: Appearance) => {
    // Shows at once; saved in the background.
    setAppearance(a);
    applyAppearance(a);
    act(() => saveAppearance(db, me.personId, a));
  };

  return (
    <>
      <TopBar here="/settings" title="Settings" />
      <main className="mx-auto grid w-full max-w-3xl gap-6 px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
        <Group title="Signed in as">
          <div className="grid gap-0.5 px-4 py-3">
            <span className="text-[15px] font-medium sm:text-sm">{me.displayName}</span>
            <span className="font-mono text-xs text-muted-foreground">{me.login}</span>
          </div>
        </Group>
        <Group title="Machines">
          <button
            type="button"
            onClick={() => go("/machines")}
            className="flex min-h-11 w-full items-center px-4 text-left text-[15px] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:text-sm"
          >
            <span className="flex-1">Machines and their keys</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>
        </Group>
        <Group title="Appearance">
          <div role="radiogroup" aria-label="Appearance" className="divide-y">
            {CHOICES.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={appearance === c.value}
                disabled={appearance === null}
                onClick={() => choose(c.value)}
                className={cn(
                  "flex min-h-11 w-full items-center px-4 text-left text-[15px] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:text-sm",
                )}
              >
                <span className="flex-1">{c.label}</span>
                {appearance === c.value && <Check className="h-4 w-4 text-[var(--sys-blue)]" aria-hidden />}
              </button>
            ))}
          </div>
        </Group>
        <Group title="Keyboard">
          <dl className="divide-y text-[15px] sm:text-sm">
            {[
              ["⌘K or Ctrl-K", "Commands: go anywhere, open a task, change the theme"],
              ["c", "New task (on a Project)"],
              ["/", "Search tasks (on a Project)"],
              ["Arrows, or j k h l", "Go from task to task on the board"],
              ["Space, then arrows", "Move a task on the board; Space drops it"],
              ["Enter", "Open the task that has focus"],
            ].map(([k, what]) => (
              <div key={k} className="flex min-h-11 items-center gap-3 px-4">
                <dt className="w-36 shrink-0">
                  <kbd className="rounded border px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
                </dt>
                <dd className="text-muted-foreground">{what}</dd>
              </div>
            ))}
          </dl>
        </Group>
      </main>
    </>
  );
}
