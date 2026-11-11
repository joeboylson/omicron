// Live updates. Every change adds a line to the `changes` table, and Supabase
// Realtime sends each new line the visitor is allowed to see. The page just
// reloads what it shows when a line arrives, so a line heard twice is fine.

import { useEffect, useRef } from "react";

// Each listener gets its own channel name. Two channels with the same name
// don't share: the live-updates library closes the first when the second
// opens (the chat sheet was cutting off the Project page's updates).
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
    const channel = db
      .channel(`changes:${projectId ?? "all"}:${++next}`)
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
        if (state === "SUBSCRIBED") soon();
      });
    return () => {
      clearTimeout(timer);
      db.removeChannel(channel);
    };
  }, [db, projectId]);
}
