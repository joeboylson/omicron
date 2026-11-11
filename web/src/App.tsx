import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { signIn, type Me } from "@/lib/omicron";
import { AppContext, go, usePath, type AppState } from "@/lib/app";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ProjectsPage } from "@/pages/ProjectsPage";
import { ProjectPage } from "@/pages/ProjectPage";

export default function App() {
  const [session, setSession] = useState<{ db: SupabaseClient; me: Me } | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = usePath();

  useEffect(() => {
    signIn().then(setSession, (e) => setSignInError(e.message ?? String(e)));
  }, []);

  const act = useCallback(async (work: () => Promise<unknown>) => {
    try {
      await work();
      setError(null);
      return true;
    } catch (e) {
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
        <header className="sticky top-0 z-10 flex h-12 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              go("/");
            }}
            className="font-semibold"
          >
            Omicron
          </a>
          <span
            className="ml-auto truncate text-sm text-muted-foreground"
            data-testid="me"
            data-person-id={app.me.personId}
            data-via={app.me.via}
            title={app.me.login}
          >
            {app.me.displayName}
          </span>
        </header>
        {error && (
          <div role="alert" className="flex items-start gap-2 border-b border-destructive/50 bg-destructive/10 px-4 py-2 text-sm">
            <span className="flex-1">{error}</span>
            <button aria-label="Dismiss" onClick={() => setError(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {projectId ? <ProjectPage key={projectId} id={projectId} /> : <ProjectsPage />}
      </div>
    </AppContext.Provider>
  );
}
