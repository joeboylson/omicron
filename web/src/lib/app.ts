// What every part of the page needs: the Supabase client, who's signed in,
// and a way to show an error.

import { createContext, useContext, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Me } from "./omicron";

export type AppState = {
  db: SupabaseClient;
  me: Me;
  /** Run a change, showing any error instead of throwing it. */
  act: (work: () => Promise<unknown>) => Promise<boolean>;
};

export const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const app = useContext(AppContext);
  if (!app) throw new Error("useApp outside the app");
  return app;
}

// Page addresses: "/" is the Projects list, "/p/<id>" one Project.
export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const update = () => setPath(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return path;
}

export function go(path: string) {
  if (path === window.location.pathname) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
