// Your settings. First: appearance (Light, Dark, or match the system),
// saved with you so it follows you between devices.

import { useEffect, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { go, useApp } from "@/lib/app";
import { applyAppearance, loadAppearance, saveAppearance, type Appearance } from "@/lib/theme";
import { TopBar } from "@/components/TopBar";
import { openShortcuts } from "@/components/Shortcuts";
import { listMachines } from "@/lib/data";
import { Group } from "@/components/Grouped";
import { cn } from "@/lib/utils";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Row } from "@/components/Grouped";
import { askDevAgain, useDev } from "@/lib/dev";
import { remoteToken, setRemoteToken } from "@/lib/remote";

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
  // Machines and remote control only for people who have a machine (or are
  // on one now): a household board's people never see them (#227).
  const [dev] = useDev(db);
  const [machines, setMachines] = useState<number | null>(null);
  useEffect(() => {
    listMachines(db).then((m) => setMachines(m.length), () => setMachines(0));
  }, [db]);
  const usesMachines = !!dev || (machines ?? 0) > 0 || remoteToken() !== null;

  const choose = (a: Appearance) => {
    // Shows at once; saved in the background.
    setAppearance(a);
    applyAppearance(a);
    act(() => saveAppearance(db, me.personId, a));
  };

  return (
    <>
      <TopBar here="/settings" title="Settings" />
      <main className="mx-auto grid w-full max-w-5xl gap-6 px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 [&>*]:max-w-3xl">
        <Group title="Signed in as">
          <div className="grid gap-0.5 px-4 py-3">
            <span className="text-[0.9375rem] font-medium sm:text-sm">{me.displayName}</span>
            <span className="tabular-nums text-xs text-muted-foreground">{me.login}</span>
          </div>
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
                  "flex min-h-11 w-full items-center px-4 text-left text-[0.9375rem] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:text-sm",
                )}
              >
                <span className="flex-1">{c.label}</span>
                {appearance === c.value && <Check className="h-4 w-4 text-[var(--sys-blue)]" aria-hidden />}
              </button>
            ))}
          </div>
        </Group>
        <Group title="Keyboard">
          <button
            type="button"
            onClick={openShortcuts}
            className="flex min-h-11 w-full items-center px-4 text-left text-[0.9375rem] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:text-sm"
          >
            <span className="flex-1">Keyboard shortcuts</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>
        </Group>
        {usesMachines && (
          <>
        <Group title="Machines">
          <button
            type="button"
            onClick={() => go("/machines")}
            className="flex min-h-11 w-full items-center px-4 text-left text-[0.9375rem] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:text-sm"
          >
            <span className="flex-1">Machines and their keys</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </button>
        </Group>
        <RemoteControl />
          </>
        )}
      </main>
    </>
  );
}

/**
 * A remote control token for the computer serving this page, made there
 * with `omicron remote token`: kept in this browser, it lets you control
 * that computer from here while you're signed in.
 */
function RemoteControl() {
  const { db } = useApp();
  const [dev] = useDev(db);
  const [saved, setSaved] = useState(remoteToken() !== null);
  const [typed, setTyped] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Controlled from here already, without a token: nothing to unlock.
  if (dev && !saved) return null;
  const use = async () => {
    setChecking(true);
    setRemoteToken(typed);
    const d = await askDevAgain(db);
    setChecking(false);
    if (d) {
      setSaved(true);
      setTyped("");
      setProblem(null);
    } else {
      setRemoteToken(null);
      setProblem("That token doesn't work on this computer. It may have run out, been taken back, or been made for someone else.");
    }
  };
  const forget = async () => {
    setRemoteToken(null);
    setSaved(false);
    await askDevAgain(db);
  };
  return (
    <Group title="Remote control">
      {saved ? (
        <Row>
          <span className="flex-1 text-[0.9375rem] sm:text-sm">{dev ? `This browser can control ${dev.machine}.` : "This browser's token no longer works."}</span>
          <Button variant="ghost" size="sm" className="text-destructive" onClick={forget}>
            Forget token
          </Button>
        </Row>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) use();
          }}
        >
          <Row>
            <label htmlFor="remote-token" className="shrink-0 text-sm">
              Token
            </label>
            <Input
              id="remote-token"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Paste it here"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 border-0 bg-transparent px-0 font-mono shadow-none placeholder:font-sans focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <Button type="submit" size="sm" disabled={!typed.trim() || checking}>
              {checking ? "Checking…" : "Use token"}
            </Button>
          </Row>
          {problem && (
            <Row className="text-sm text-destructive">
              <span role="alert">{problem}</span>
            </Row>
          )}
        </form>
      )}
    </Group>
  );
}

