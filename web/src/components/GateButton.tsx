import { useEffect, useState } from "react";
import { MonitorSmartphone, MonitorX } from "lucide-react";
import { useApp } from "@/lib/app";
import { devApi, gateOpen, useDev } from "@/lib/dev";
import { Button } from "@/components/base/button";
import { Input } from "@/components/base/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/base/popover";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", weekday: "short" });

/** Five o'clock, or two hours from now if that's passed. */
function suggested(): string {
  const now = new Date();
  const at = now.getHours() < 17 ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 17) : new Date(now.getTime() + 2 * 3600_000);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

/**
 * This computer's remote control (called the gate in the code), for its
 * owner: whether it takes work from elsewhere, and until when. Turned on
 * and off only on the computer itself.
 */
export function GateButton() {
  const { db, act } = useApp();
  const [dev, setDev] = useDev(db);
  const [until, setUntil] = useState(suggested);
  const [, tick] = useState(0);
  // Re-draw when it closes by itself.
  useEffect(() => {
    if (!dev?.gate_until) return;
    const ms = new Date(dev.gate_until).getTime() - Date.now();
    if (ms <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.min(ms + 500, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [dev?.gate_until]);
  if (!dev) return null;
  const open = gateOpen(dev);
  const change = (body: unknown) => act(async () => setDev(await devApi(db, "/gate", body)));
  const Icon = open ? MonitorSmartphone : MonitorX;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5 text-muted-foreground"
          data-testid="gate"
          aria-label={open ? `${dev.machine}'s remote control: on until ${time(dev.gate_until!)}` : `${dev.machine}'s remote control: off`}
        >
          <Icon className="h-4 w-4" style={{ color: open ? "var(--sys-green)" : undefined }} aria-hidden />
          {/* Its name, and On or Off like a switch's state (HIG toggles #6). */}
          <span className="sm:hidden">Remote</span>
          <span className="hidden sm:inline">Remote control</span>
          <span className="rounded-full bg-secondary px-1.5 text-xs font-medium text-secondary-foreground">
            {open ? "On" : "Off"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent title="Remote control" align="end" className="grid w-80 max-w-[calc(100vw-2rem)] gap-3 text-sm">
        {/* This page is served by the computer: here it always takes your orders. */}
        <p>
          You can always use <span className="tabular-nums">{dev.machine}</span> from this page.{" "}
          {open
            ? `Until ${time(dev.gate_until!)} it also takes your work from other computers and their pages, then stops by itself.`
            : "It takes no work from other computers or their pages."}
        </p>
        {!dev.local ? (
          open ? null : <OpenOnIt machine={dev.machine} until={until} />
        ) : open ? (
          <Button variant="outline" onClick={() => change({ close: true })}>
            Turn off remote control
          </Button>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              change({ until });
            }}
          >
            <label htmlFor="gate-until" className="shrink-0">
              On until
            </label>
            <Input id="gate-until" type="time" value={until} onChange={(e) => setUntil(e.target.value)} className="h-9" />
            <Button type="submit">Turn on</Button>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Opening it from elsewhere isn't allowed: the command to run on it, to copy. */
function OpenOnIt({ machine, until }: { machine: string; until: string }) {
  const [copied, setCopied] = useState(false);
  const command = `omicron remote on --until ${until}`;
  return (
    <div className="grid gap-1.5">
      <p>
        To turn on remote control, run this on <span className="tabular-nums">{machine}</span>:
      </p>
      <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted py-1.5 pl-3 pr-1">
        <code className="min-w-0 flex-1 font-mono text-xs">{command}</code>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0"
          onClick={() =>
            navigator.clipboard?.writeText(command).then(
              () => setCopied(true),
              () => {},
            )
          }
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}
