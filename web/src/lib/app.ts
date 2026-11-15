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

/**
 * A value kept in the page address (`?task=6`), so reloading or sharing the
 * link keeps it. `push` adds a step to the back button (opening a task:
 * Back closes it); otherwise the address is just updated.
 */
const ADDRESS_CHANGED = "omicron:address";

export function useAddressValue(name: string): [string | null, (value: string | null, push?: boolean) => void] {
  const read = () => new URLSearchParams(window.location.search).get(name);
  const [value, setValue] = useState<string | null>(read);
  useEffect(() => {
    const update = () => setValue(read());
    window.addEventListener("popstate", update);
    // Another part of the page changed the same value: follow it.
    window.addEventListener(ADDRESS_CHANGED, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(ADDRESS_CHANGED, update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  const set = (next: string | null, push = false) => {
    const params = new URLSearchParams(window.location.search);
    if (next === null || next === "") params.delete(name);
    else params.set(name, next);
    const query = params.toString();
    const url = window.location.pathname + (query ? `?${query}` : "");
    if (url === window.location.pathname + window.location.search) return;
    if (push) window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    setValue(next === "" ? null : next);
    window.dispatchEvent(new Event(ADDRESS_CHANGED));
  };
  return [value, set];
}

export function go(path: string) {
  if (path === window.location.pathname) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
