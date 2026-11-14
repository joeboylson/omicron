// Live updates. Every change adds a line to the `changes` table, and Supabase
// Realtime sends each new line the visitor is allowed to see. The page just
// reloads what it shows when a line arrives, so a line heard twice is fine.

import { useEffect, useRef, useState } from "react";

// Whether each open channel is getting live lines, by name: if any isn't
// (or the browser is offline), the page says it's not up to date (#226).
const down = new Set<string>();
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());
if (typeof window !== "undefined") {
  window.addEventListener("offline", tell);
  window.addEventListener("online", tell);
}
const isDown = () => down.size > 0 || (typeof navigator !== "undefined" && navigator.onLine === false);

/** True while live updates aren't arriving, after a short grace so a
 *  moment's hiccup doesn't flash a message. */
export function useLiveDown(graceMs = 3000): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      clearTimeout(timer);
      if (isDown()) timer = setTimeout(() => setShown(isDown()), graceMs);
      else setShown(false);
    };
    listeners.add(check);
    check();
    return () => {
      clearTimeout(timer);
      listeners.delete(check);
    };
  }, [graceMs]);
  return shown;
}

// Each listener gets its own channel name. Two channels with the same name
// don't share: the live-updates library closes the first when the second
// opens (one sheet was cutting off the Project page's updates).
let next = 0;
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Call `reload` whenever a change line arrives. `projectId` limits it to one
 * Project's lines. Lines that come in a burst cause one reload.
 */
export function useChanges(db: SupabaseClient, projectId: string | null, reload: () => void) {
  const latest = useRef(reload);
  latest.current = reload;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => latest.current(), 100);
    };
    const name = `changes:${projectId ?? "all"}:${++next}`;
    let gone = false;
    const channel = db
      .channel(name)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "changes",
          ...(projectId ? { filter: `project_id=eq.${projectId}` } : {}),
        },
        soon,
      )
      // Lines written while the connection was down are never sent, so
      // reload once each time it (re)connects.
      .subscribe((state) => {
        if (gone) return;
        if (state === "SUBSCRIBED") {
          down.delete(name);
          soon();
        } else down.add(name);
        tell();
      });
    return () => {
      gone = true;
      clearTimeout(timer);
      down.delete(name);
      tell();
      db.removeChannel(channel);
    };
  }, [db, projectId]);
}
