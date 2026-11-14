// People: who's in a Project, the people table, and deleting someone.

import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "../omicron";
import type { Person } from "./types";

export async function listPeople(db: SupabaseClient): Promise<Person[]> {
  return must(await db.from("people").select("id,display_name").order("display_name")) as Person[];
}

export async function addMember(db: SupabaseClient, projectId: string, personId: string) {
  must(await db.from("project_members").insert({ project_id: projectId, person_id: personId }));
}

export async function removeMember(db: SupabaseClient, projectId: string, personId: string) {
  must(await db.from("project_members").delete().eq("project_id", projectId).eq("person_id", personId));
}

/** Someone in the people table: their logins and the Projects (that you can see) they're in. */
export type PersonRow = { id: string; display_name: string; logins: string[]; projectIds: string[] };

export async function listPeopleTable(db: SupabaseClient): Promise<PersonRow[]> {
  const rows = must(
    await db.from("people").select("id,display_name,tailscale_identities(login),project_members(project_id)").order("display_name"),
  ) as any[];
  return rows.map((r) => ({
    id: r.id,
    display_name: r.display_name,
    logins: (r.tailscale_identities ?? []).map((t: { login: string }) => t.login).sort(),
    projectIds: (r.project_members ?? []).map((m: { project_id: string }) => m.project_id),
  }));
}

/** Delete a person for good, through the Web Machine (it has the secret key). */
export async function deletePerson(db: SupabaseClient, id: string) {
  const { data } = await db.auth.getSession();
  const res = await fetch(`/api/people/${id}/delete`, { method: "POST", headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}` } });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? res.statusText);
}
