// Your settings. First: appearance (Light, Dark, or match the system),
// saved with you so it follows you between devices.

import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { go, useApp } from "@/lib/app";
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from "@/lib/theme";
import { NavBar } from "@/components/NavBar";
import { Button } from "@/components/ui/button";
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
      <NavBar
        title="Settings"
        titleClassName="mx-auto w-full max-w-3xl"
        left={
          <Button variant="ghost" className="gap-0.5 px-2 [&_svg]:size-5" aria-label="Back to Projects" onClick={() => go("/")}>
            <ChevronLeft /> Projects
          </Button>
        }
      />
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
            onClick={() => go("/keys")}
            className="flex min-h-11 w-full items-center px-4 text-left text-[15px] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:text-sm"
          >
            <span className="flex-1">API keys</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>
        </Group>
        <Group title="Appearance" note="Saved with you, so it's the same on all your devices.">
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
                  "flex min-h-11 w-full items-center px-4 text-left text-[15px] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:text-sm",
                )}
              >
                <span className="flex-1">{c.label}</span>
                {appearance === c.value && <Check className="h-4 w-4 text-[var(--sys-blue)]" aria-hidden />}
              </button>
            ))}
          </div>
        </Group>
      </main>
    </>
  );
}
