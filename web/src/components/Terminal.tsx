import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useApp } from "@/lib/app";

/** Bearer header for the computer serving the page. */
async function auth(db: ReturnType<typeof useApp>["db"]) {
  const { data } = await db.auth.getSession();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}` };
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

  useEffect(() => {
    const term = new XTerm({
      fontFamily: '"Geist Mono", ui-monospace, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: "#111113" },
    });
    const fitter = new FitAddon();
    fit.current = fitter;
    term.loadAddon(fitter);
    term.open(box.current!);
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
    // is on its way goes together in the next.
    let waiting = "";
    let busy = false;
    const flush = async () => {
      if (busy || !waiting) return;
      busy = true;
      while (waiting) {
        const data = waiting;
        waiting = "";
        await post("input", { data });
      }
      busy = false;
    };
    const typed = term.onData((d) => {
      waiting += d;
      flush();
    });
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
      stop.abort();
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
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#111113]" hidden={!active} data-testid={`terminal-${session}`}>
      {state !== "open" && (
        <p role="status" className="px-3 py-2 text-xs text-white/70">
          {state === "connecting" ? `Connecting to ${session}…` : state === "ended" ? `${session} ended.` : state}
        </p>
      )}
      <div ref={box} className="min-h-0 flex-1 p-2" />
    </div>
  );
}
