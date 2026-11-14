import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const [error, setError] = useState<{ message: string; from: "action" | "uncaught"; started?: number } | null>(null);
  // Each action's place in line: one that started before a failure doesn't clear it by succeeding.
  const started = useRef(0);
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
    const n = ++started.current;
    try {
      await work();
      setError((current) => (current?.from === "action" && (current.started ?? 0) < n ? null : current));
      return true;
    } catch (e) {
      // Not reported when it's only the connection: nothing to fix.
      const words = errorWords(e);
      if (words !== OFFLINE_WORDS) reportError("action", e);
      setError({ message: words, from: "action", started: n });
      return false;
    }
  }, []);

  const app: AppState | null = useMemo(() => (session ? { ...session, act } : null), [session, act]);

  if (signInError) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">
          {signInError.words === OFFLINE_WORDS ? "You're offline" : signInError.who ? "We couldn't tell who you are" : "Omicron couldn't open"}
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
        {error && (
          <div
            role="alert"
            className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t bg-background px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-sm shadow-lg"
          >
            <span className="flex-1 text-destructive">{error.message}</span>
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
