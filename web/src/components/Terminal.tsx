import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { computerHeaders } from "@/lib/remote";
import { useApp } from "@/lib/app";
import { cn } from "@/lib/utils";

/** The page's own colors (they follow Light, Dark or the system). */
function pageTheme() {
  const css = getComputedStyle(document.documentElement);
  const hsl = (name: string) => `hsl(${css.getPropertyValue(name).trim().replace(/ /g, ", ")})`;
  const background = hsl("--background");
  const foreground = hsl("--foreground");
  return { background, foreground, cursor: foreground, cursorAccent: background, selectionBackground: hsl("--accent") };
}

/** Call `then` whenever the page's theme changes. Returns how to stop. */
function onThemeChange(then: () => void): () => void {
  const watch = new MutationObserver(then);
  watch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  system.addEventListener("change", then);
  return () => {
    watch.disconnect();
    system.removeEventListener("change", then);
  };
}

/** The extra keys under a terminal on touch screens: label, name, what's sent (null: Ctrl, held for the next key). */
const EXTRA_KEYS: [string, string, string | null][] = [
  ["Esc", "Escape", "\x1b"],
  ["Tab", "Tab", "\t"],
  ["⇧Tab", "Shift+Tab", "\x1b[Z"],
  ["Ctrl", "Control", null],
  ["^C", "Control+C", "\x03"],
  ["←", "Left", "\x1b[D"],
  ["↑", "Up", "\x1b[A"],
  ["↓", "Down", "\x1b[B"],
  ["→", "Right", "\x1b[C"],
];

/** Bearer header for the computer serving the page. */
async function auth(db: ReturnType<typeof useApp>["db"]) {
  return computerHeaders(db);
}

/**
 * One of this computer's sessions, in a terminal: what it kept, then live.
 * Keys go to it; its size follows the panel. Only for the computer's owner
 * (the computer checks).
 */
export function Terminal({ session, active }: { session: string; active: boolean }) {
  const { db } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const fit = useRef<FitAddon | null>(null);
  const [state, setState] = useState<"connecting" | "open" | "ended" | string>("connecting");
  // Sends keys to the session (set once it's connected).
  const send = useRef<(data: string) => void>(() => {});
  const terminal = useRef<XTerm | null>(null);
  // Ctrl on the extra keys: the next letter typed is sent with it.
  const [ctrl, setCtrl] = useState(false);
  const ctrlOn = useRef(false);
  ctrlOn.current = ctrl;

  useEffect(() => {
    const xterm = new XTerm({
      fontFamily: '"Geist Mono Variable", ui-monospace, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: pageTheme(),
    });
    const term = xterm;
    // Follows the page's theme, as it changes (#98).
    const stopTheme = onThemeChange(() => {
      term.options.theme = pageTheme();
    });
    const fitter = new FitAddon();
    fit.current = fitter;
    term.loadAddon(fitter);
    term.open(box.current!);
    // Geist Mono may still be loading: once it has, measure again, or the
    // terminal keeps the fallback font's size (and looks like Courier).
    let gone = false;
    document.fonts
      ?.load('13px "Geist Mono Variable"')
      .then(() => {
        if (gone) return;
        term.options.fontFamily = '"Geist Mono Variable", ui-monospace, monospace ';
        fitter.fit();
      })
      .catch(() => {});
    const stop = new AbortController();
    const base = `/api/dev/term/${encodeURIComponent(session)}`;
    const post = async (path: string, body: unknown) =>
      fetch(`${base}/${path}`, {
        method: "POST",
        headers: { ...(await auth(db)), "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: stop.signal,
      }).catch(() => {});

    // Keys go in order, one request at a time; whatever is typed while one
    // is on its way goes together in the next. Keys typed before the session
    // is connected wait for it, rather than being sent too early and lost (#272).
    let waiting = "";
    let busy = false;
    let connected = false;
    const flush = async () => {
      if (busy || !waiting || !connected) return;
      busy = true;
      while (waiting) {
        const data = waiting;
        waiting = "";
        await post("input", { data });
      }
      busy = false;
    };
    send.current = (d: string) => {
      waiting += d;
      flush();
    };
    const typed = term.onData((d) => {
      // Ctrl from the extra keys: a letter becomes its control key.
      if (ctrlOn.current && d.length === 1 && /[a-z@[\\\]^_]/i.test(d)) {
        d = String.fromCharCode(d.toUpperCase().charCodeAt(0) & 31);
        setCtrl(false);
      }
      send.current(d);
    });
    terminal.current = term;
    const sized = term.onResize(({ rows, cols }) => post("size", { rows, cols }));

    (async () => {
      try {
        const res = await fetch(base, { headers: await auth(db), signal: stop.signal });
        if (!res.ok || !res.body) {
          const j = await res.json().catch(() => null);
          setState(j?.error ?? res.statusText);
          return;
        }
        setState("open");
        fitter.fit();
        post("size", { rows: term.rows, cols: term.cols });
        connected = true;
        flush();
        const reader = res.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          term.write(value);
        }
        setState("ended");
      } catch {
        if (!stop.signal.aborted) setState("ended");
      }
    })();

    const resized = new ResizeObserver(() => {
      if (box.current?.offsetParent) fitter.fit();
    });
    resized.observe(box.current!);
    return () => {
      gone = true;
      stop.abort();
      stopTheme();
      typed.dispose();
      sized.dispose();
      resized.disconnect();
      term.dispose();
    };
  }, [session, db]);

  useEffect(() => {
    if (active) requestAnimationFrame(() => fit.current?.fit());
  }, [active]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background" hidden={!active} data-testid={`terminal-${session}`}>
      {state !== "open" && (
        <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
          {state === "connecting" ? `Connecting to ${session}…` : state === "ended" ? `${session} ended.` : state}
        </p>
      )}
      <div ref={box} className="min-h-0 flex-1 p-2" />
      {state === "open" && (
        // Keys a phone's keyboard doesn't have, which Claude Code needs.
        <div role="toolbar" aria-label="Extra keys" className="hidden shrink-0 gap-1 border-t bg-muted p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] [@media(pointer:coarse)]:flex">
          {EXTRA_KEYS.map(([label, name, data]) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              aria-pressed={data === null ? ctrl : undefined}
              // Keeps the keyboard up: the terminal keeps focus.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                if (data === null) setCtrl((c) => !c);
                else {
                  send.current(data);
                  setCtrl(false);
                }
                terminal.current?.focus();
              }}
              className={cn(
                "min-h-11 min-w-8 flex-auto whitespace-nowrap rounded-md bg-background px-1.5 font-mono text-xs shadow-sm active:bg-accent",
                data === null && ctrl && "bg-foreground text-background",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
