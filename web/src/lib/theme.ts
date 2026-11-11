// Appearance: Light, Dark, or match the system. Saved on the person (so it
// follows them between devices) and kept in this browser too, so the page
// starts in the right theme before signing in finishes (see index.html).

import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "./omicron";

export type Appearance = "system" | "light" | "dark";

export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  if (a === "system") delete root.dataset.theme;
  else root.dataset.theme = a;
  try {
    if (a === "system") localStorage.removeItem("omicron.theme");
    else localStorage.setItem("omicron.theme", a);
  } catch {
    // Not kept here; the saved setting still applies after signing in.
  }
}

export async function loadAppearance(db: SupabaseClient, personId: string): Promise<Appearance> {
  const row = must(await db.from("people").select("settings").eq("id", personId).maybeSingle()) as { settings?: { appearance?: string } } | null;
  const a = row?.settings?.appearance;
  return a === "light" || a === "dark" ? a : "system";
}

export async function saveAppearance(db: SupabaseClient, personId: string, a: Appearance) {
  const row = must(await db.from("people").select("settings").eq("id", personId).single()) as { settings: Record<string, unknown> };
  must(await db.from("people").update({ settings: { ...row.settings, appearance: a } }).eq("id", personId));
}
