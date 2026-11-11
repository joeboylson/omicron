import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { signIn, type Me } from "@/lib/omicron";
import { AppContext, usePath, type AppState } from "@/lib/app";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectPage } from "@/pages/ProjectPage";
import { reportError } from "@/lib/report";

export default function App() {
  const [session, setSession] = useState<{ db: SupabaseClient; me: Me } | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = usePath();

  useEffect(() => {
    signIn().then(setSession, (e) => {
      reportError("sign-in", e);
      setSignInError(e.message ?? String(e));
    });
  }, []);

  // Errors outside drawing the page (timers, live updates) show in the
  // error bar rather than vanishing.
  useEffect(() => {
    const show = (e: unknown) => {
      reportError("uncaught", e);
      setError(e instanceof Error ? e.message : String(e));
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
      setError(null);
      return true;
    } catch (e) {
      reportError("action", e);
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  const app: AppState | null = useMemo(() => (session ? { ...session, act } : null), [session, act]);

  if (signInError) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-2xl font-semibold">Omicron</h1>
        <p role="alert" className="mt-4 text-destructive">
          Couldn't sign in: {signInError}
        </p>
      </main>
    );
  }
  if (!app) {
    return <p className="p-6 text-muted-foreground">Signing in…</p>;
  }

  const projectId = path.match(/^\/p\/([0-9a-f-]{36})$/)?.[1] ?? null;
  return (
    <AppContext.Provider value={app}>
      <div className="flex min-h-dvh flex-col">
        {projectId ? <ProjectPage key={projectId} id={projectId} /> : <ProjectsPage />}
        {error && (
          <div
            role="alert"
            className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t bg-background px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 text-sm shadow-lg"
          >
            <span className="flex-1 text-destructive">{error}</span>
            <button aria-label="Dismiss" className="flex h-11 w-11 items-center justify-center" onClick={() => setError(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </AppContext.Provider>
  );
}
