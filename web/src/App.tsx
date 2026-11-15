import { useLiveDown } from "@/lib/live";
import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { errorWords, OFFLINE_WORDS, signIn, SignInError, type Me } from "@/lib/omicron";
import { Button } from "@/components/base/button";
import { AppContext, go, usePath, type AppState } from "@/lib/app";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { PeoplePage } from "@/pages/PeoplePage";
import { SettingsPage } from "@/pages/SettingsPage";
import { MachinesPage } from "@/pages/MachinesPage";
import { applyAppearance, loadAppearance } from "@/lib/theme";
import { reportError } from "@/lib/report";
import { BoardSkeleton } from "@/components/Skeleton";
import { ToastProvider } from "@/lib/toast";
import { CommandMenu } from "@/components/CommandMenu";
import { GlobalCommands } from "@/components/GlobalCommands";
import { ShortcutsSheet } from "@/components/Shortcuts";

/** An address that isn't a page here. */
function NotFound() {
  return (
    <main className="mx-auto w-full max-w-md p-6">
      <h1 className="text-2xl font-semibold">Nothing here</h1>
      <p className="mt-2 text-muted-foreground">There's no page at this address.</p>
      <Button className="mt-4" onClick={() => go("/")}>
        Go to Projects
      </Button>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<{ db: SupabaseClient; me: Me } | null>(null);
  const [signInError, setSignInError] = useState<{ words: string; who: boolean; detail: string } | null>(null);
  // Where the error came from: a later action that works clears an
  // action's error, but not one from elsewhere (that stays until dismissed).
  // What went wrong, until it's dealt with: dismissed, tried again and done,
  // or (when it was only the connection) the connection coming back. A later
  // reload or another change never clears it, so a failed change can't
  // quietly undo itself (#197).
  const [error, setError] = useState<{ message: string; from: "action" | "uncaught"; retry?: () => Promise<unknown> } | null>(null);
  useEffect(() => {
    const back = () => setError((e) => (e?.message === OFFLINE_WORDS ? null : e));
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);
  const path = usePath();

  useEffect(() => {
    signIn().then((s) => {
      setSession(s);
      // The saved appearance wins over what this browser remembered.
      loadAppearance(s.db, s.me.personId).then(applyAppearance, () => {});
    }, (e) => {
      reportError("sign-in", e);
      setSignInError({ words: errorWords(e), who: e instanceof SignInError && e.kind === "who", detail: e instanceof Error ? e.message : String(e) });
    });
  }, []);

  // Errors outside drawing the page (timers, live updates) show in the
  // error bar rather than vanishing.
  useEffect(() => {
    const show = (e: unknown) => {
      reportError("uncaught", e);
      setError({ message: errorWords(e), from: "uncaught" });
    };
    const onError = (e: ErrorEvent) => show(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => show(e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const act = useCallback(async (work: () => Promise<unknown>) => {
    try {
      await work();
      return true;
    } catch (e) {
      // Not reported when it's only the connection: nothing to fix.
      const words = errorWords(e);
      if (words !== OFFLINE_WORDS) reportError("action", e);
      setError({ message: words, from: "action", retry: work });
      return false;
    }
  }, []);
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    const work = error?.retry;
    if (!work) return;
    setRetrying(true);
    try {
      await work();
      setError(null);
    } catch (e) {
      setError({ message: errorWords(e), from: "action", retry: work });
    } finally {
      setRetrying(false);
    }
  };

  const app: AppState | null = useMemo(() => (session ? { ...session, act } : null), [session, act]);

  if (signInError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">
          {signInError.words === OFFLINE_WORDS ? "You're offline" : signInError.who ? "Couldn't tell who you are" : "Omicron couldn't open"}
        </h1>
        <div role="alert" className="grid gap-2">
          {signInError.words === OFFLINE_WORDS ? (
            <p>{OFFLINE_WORDS}</p>
          ) : signInError.who ? (
            <>
              <p>Make sure you're signed in to Tailscale on this device, then try again.</p>
              <p className="text-muted-foreground">If it keeps happening, ask whoever set up Omicron for you.</p>
            </>
          ) : (
            <>
              <p>Something went wrong while signing you in. Try again in a moment.</p>
              <p className="text-muted-foreground">If it keeps happening, ask whoever set up Omicron for you.</p>
            </>
          )}
        </div>
        <Button className="self-start" onClick={() => window.location.reload()}>
          Try again
        </Button>
        {signInError.words !== OFFLINE_WORDS && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Details</summary>
            <p className="mt-1 break-words font-mono">{signInError.detail}</p>
          </details>
        )}
      </main>
    );
  }
  if (!app) {
    return (
      <div className="flex min-h-dvh flex-col">
        <BoardSkeleton />
      </div>
    );
  }

  const projectId = path.match(/^\/p\/([0-9a-f-]{36})$/)?.[1] ?? null;
  return (
    <AppContext.Provider value={app}>
      <ToastProvider>
        <GlobalCommands />
        <ShortcutsSheet />
        <CommandMenu />
      <div className="flex min-h-dvh flex-col">
        {projectId ? (
          <ProjectPage key={projectId} id={projectId} />
        ) : path === "/people" ? (
          <PeoplePage />
        ) : path === "/settings" ? (
          <SettingsPage />
        ) : path === "/machines" || path === "/keys" ? (
          <MachinesPage />
        ) : path === "/" || path === "/index.html" ? (
          <ProjectsPage />
        ) : (
          <NotFound />
        )}
        <LiveDown />
        {error && (
          // Above any open sheet (they're z-50 and block the page), so an
          // error made in one is seen and can be tried again from there.
          <div
            role="alert"
            data-error-bar
            className="pointer-events-auto fixed inset-x-0 bottom-0 z-[60] flex items-center gap-2 border-t bg-background px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-sm shadow-lg"
          >
            <span className="flex-1 text-destructive">{error.message}</span>
            {error.retry && (
              <Button variant="outline" size="sm" className="h-11 shrink-0 sm:h-9" disabled={retrying} onClick={retry}>
                {retrying ? "Trying…" : "Try Again"}
              </Button>
            )}
            <button aria-label="Dismiss" className="flex h-11 w-11 items-center justify-center" onClick={() => setError(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      </ToastProvider>
    </AppContext.Provider>
  );
}

/** A quiet line while live updates aren't arriving: what's shown may be
 *  out of date (HIG feedback #1, #3). It goes once they're back. */
function LiveDown() {
  const down = useLiveDown();
  if (!down) return null;
  return (
    <div
      role="status"
      data-testid="live-down"
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[60] flex justify-center px-4"
    >
      <span className="flex items-center gap-2 rounded-full border bg-background px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "var(--sys-orange)" }} />
        Not up to date. Reconnecting…
      </span>
    </div>
  );
}
