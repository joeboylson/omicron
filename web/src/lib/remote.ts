// A remote control token for the computer serving this page (made there
// with `omicron remote token`): kept in this browser only, and sent with
// every request to that computer, so its owner can control it from here
// even when this visit's Tailscale login can't be checked.

import type { SupabaseClient } from "@supabase/supabase-js";

const KEY = "omicron.remoteToken";

export function remoteToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setRemoteToken(token: string | null) {
  try {
    if (token) localStorage.setItem(KEY, token.trim());
    else localStorage.removeItem(KEY);
  } catch {
    // Private browsing and the like: it just isn't kept.
  }
}

/** What every request to the computer serving the page carries: the page's login, and this browser's token if it has one. */
export async function computerHeaders(db: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await db.auth.getSession();
  const token = remoteToken();
  return { Authorization: `Bearer ${data.session?.access_token ?? ""}`, ...(token ? { "Omicron-Remote": token } : {}) };
}
