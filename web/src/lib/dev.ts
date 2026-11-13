// The Dev side of the page: only for the owner of the computer serving it,
// seen by that computer itself (ref/BRAINSTORM.md, "Two views of a
// Project" and "The gate"). Everyone else gets the Tasks view only.

import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export type Dev = {
  /** From the computer itself (only then can its gate be opened here). */
  local: boolean;
  machine: string;
  machine_id: string;
  /** When its gate closes, if it's open. */
  gate_until: string | null;
};

/** Ask the computer serving this page. `path` is "" (who am I) or an action. */
export async function devApi(db: SupabaseClient, path = "", body?: unknown): Promise<Dev | null> {
  const { data } = await db.auth.getSession();
  const res = await fetch(`/api/dev${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    // An older server, or none: no Dev side.
    if (res.status === 404 && !path) return null;
    throw new Error(json?.error ?? res.statusText);
  }
  return json?.dev ? (json as Dev) : null;
}

/** An action on this computer (open, end, hand off): its answer as sent. */
export async function devAction(db: SupabaseClient, path: string, body: unknown): Promise<any> {
  const { data } = await db.auth.getSession();
  const res = await fetch(`/api/dev${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? res.statusText);
  return json;
}

let known: Promise<Dev | null> | null = null;
const listeners = new Set<(d: Dev | null) => void>();

/** Whether this visit gets the Dev side, waiting for the answer if it's still coming. */
export function whenDev(db: SupabaseClient): Promise<Dev | null> {
  known ??= devApi(db).catch(() => null);
  return known;
}

/** Whether this visit gets the Dev side, asked once and shared. */
export function useDev(db: SupabaseClient): [Dev | null, (d: Dev | null) => void] {
  const [dev, setDev] = useState<Dev | null>(null);
  useEffect(() => {
    known ??= devApi(db).catch(() => null);
    let live = true;
    known.then((d) => live && setDev(d));
    listeners.add(setDev);
    return () => {
      live = false;
      listeners.delete(setDev);
    };
  }, [db]);
  const update = (d: Dev | null) => {
    known = Promise.resolve(d);
    listeners.forEach((l) => l(d));
  };
  return [dev, update];
}

/** Is the gate open now? (It closes on its own at its time.) */
export function gateOpen(dev: Dev, now = Date.now()): boolean {
  return dev.gate_until !== null && new Date(dev.gate_until).getTime() > now;
}
