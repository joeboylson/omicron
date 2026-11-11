// Which machines are awake: the ones connected to the shared live channel
// right now (each machine's daemon announces itself there). Supabase says
// the moment one joins or leaves, so there's nothing to check on a timer.
//
// The access rules only let listeners into the channel named "omicron", and
// the live-updates library closes a channel when a second one with the same
// name opens, so the whole page shares one.

import { useEffect, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

type Listener = (awake: Set<string>) => void;
let shared: { db: SupabaseClient; channel: RealtimeChannel; listeners: Set<Listener>; awake: Set<string> | null } | null = null;

function join(db: SupabaseClient, listener: Listener): () => void {
  if (!shared || shared.db !== db) {
    // Presence has to be asked for on join: this version of the library
    // doesn't say so on its own, and Realtime only sends who's connected
    // to channels that ask.
    const config = { private: true, presence: { key: "", enabled: true } } as { private: boolean; presence: { key: string } };
    const channel = db.channel("omicron", { config });
    const s = { db, channel, listeners: new Set<Listener>(), awake: null as Set<string> | null };
    channel
      .on("presence", { event: "sync" }, () => {
        const ids = new Set<string>();
        for (const metas of Object.values(channel.presenceState())) {
          for (const m of metas as { machine_id?: string; kind?: string }[]) {
            if (m.kind === "machine" && m.machine_id) ids.add(m.machine_id);
          }
        }
        s.awake = ids;
        s.listeners.forEach((l) => l(ids));
      })
      .subscribe();
    shared = s;
  }
  const s = shared;
  s.listeners.add(listener);
  if (s.awake) listener(s.awake);
  return () => {
    s.listeners.delete(listener);
    if (s.listeners.size === 0) {
      s.db.removeChannel(s.channel);
      if (shared === s) shared = null;
    }
  };
}

/** Machine ids that are awake, or null until the channel has said. */
export function useAwakeMachines(db: SupabaseClient): Set<string> | null {
  const [awake, setAwake] = useState<Set<string> | null>(shared?.db === db ? shared.awake : null);
  useEffect(() => join(db, setAwake), [db]);
  return awake;
}
