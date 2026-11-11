// Signing in and talking to Supabase.
//
// The Web Machine that served this page hands out a Supabase login for the
// visitor (POST /api/session). After that the page talks to Supabase
// directly, like every other machine.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Me = { personId: string; displayName: string; login: string; via: "local" | "tailnet" };

export async function signIn(): Promise<{ db: SupabaseClient; me: Me }> {
  const config = await (await fetch("/config.json")).json();
  const res = await fetch("/api/session", { method: "POST" });
  const session = await res.json();
  if (!res.ok) throw new Error(session.error || res.statusText);
  const db = createClient(config.supabase_url, config.supabase_key, {
    // The Web Machine signs us in again on every visit, so nothing is kept in
    // the browser. Supabase still renews the login while the page is open.
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  const { error } = await db.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error) throw error;
  db.realtime.setAuth(session.access_token);
  return {
    db,
    me: { personId: session.person_id, displayName: session.display_name, login: session.login, via: session.via },
  };
}

/** Throw Supabase's error, if there is one, and return the data. */
export function must<T>(r: { data: T; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
