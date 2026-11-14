// Signing in and talking to Supabase.
//
// The Web Machine that served this page hands out a Supabase login for the
// visitor (POST /api/session). After that the page talks to Supabase
// directly, like every other machine.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Me = { personId: string; displayName: string; login: string; via: "local" | "tailnet" };

/** Signing in failed: we couldn't tell who's visiting, or something else. */
export class SignInError extends Error {
  constructor(
    readonly kind: "who" | "other",
    readonly detail: string,
  ) {
    super(detail);
  }
}

export async function signIn(): Promise<{ db: SupabaseClient; me: Me }> {
  const config = await (await fetch("/config.json")).json();
  const res = await fetch("/api/session", { method: "POST" });
  const session = await res.json();
  if (!res.ok) throw new SignInError(session.error === "who" ? "who" : "other", session.detail ?? session.error ?? res.statusText);
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
export function must<T>(r: { data: T; error: { message: string; code?: string } | null }): T {
  if (r.error) throw new Error(plainError(r.error));
  return r.data;
}

/** The browser's ways of saying it couldn't connect. */
const OFFLINE = /Failed to fetch|NetworkError|Load failed|network connection was lost|ERR_INTERNET_DISCONNECTED|ERR_NETWORK/i;

export const OFFLINE_WORDS = "Couldn't reach Omicron. Check your connection, then try again.";

/** Any error, in words a person can act on. */
export function errorWords(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (OFFLINE.test(m) || (typeof navigator !== "undefined" && navigator.onLine === false)) return OFFLINE_WORDS;
  // A slip in the page's own code ("Cannot read properties of undefined"):
  // nothing a person can act on, so plain words (the error report has it).
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError || e instanceof SyntaxError) return SOMETHING_WRONG;
  return m;
}

export const SOMETHING_WRONG = "Something went wrong. Try again, or reload the page.";

/** What the database said, in words a person can act on (as the CLI says it). */
export function plainError(e: { message: string; code?: string }): string {
  const m = e.message ?? "";
  if (OFFLINE.test(m)) return OFFLINE_WORDS;
  switch (e.code) {
    case "22007":
    case "22008":
      return "That date isn't on the calendar.";
    case "23505":
      return "There's already one with that name.";
    case "23503":
      return "It refers to something that isn't there any more.";
    case "23514": {
      const rules: [string, string][] = [
        ["_body_or_images", "A comment needs some text or an image."],
        ["_display_name_check", "The name needs some text."],
        ["_title_check", "The title needs some text."],
        ["_name_check", "The name needs some text."],
        ["_body_check", "It needs some text."],
        ["_text_check", "It needs some text."],
        ["_prompt_check", "The prompt needs some text."],
      ];
      const hit = rules.find(([r]) => m.includes(r));
      if (hit) return hit[1];
    }
  }
  if (m && !m.includes("violates")) return m.charAt(0).toUpperCase() + m.slice(1);
  return "That didn't save. Try again.";
}
