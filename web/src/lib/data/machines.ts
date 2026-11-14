// Machines: which Projects they use, their Claude accounts, and their
// keys (made through the Web Machine).

import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "../omicron";

/** Let a machine use a Project (its sessions can work in it). */
export async function addProjectMachine(db: SupabaseClient, projectId: string, machineId: string) {
  must(await db.from("project_machines").insert({ project_id: projectId, machine_id: machineId }));
}

/** Take a machine out of a Project: its sessions there end. */
export async function removeProjectMachine(db: SupabaseClient, projectId: string, machineId: string) {
  must(await db.from("project_machines").delete().eq("project_id", projectId).eq("machine_id", machineId));
}

export type UsageWindow = { percent: number; resets_at: string | null } | null;

export type MachineAccounts = {
  in_use: string | null;
  accounts: { name: string; five_hour: UsageWindow; weekly: UsageWindow }[];
  auto: { primary: string; secondary: string; held: string | null } | null;
};

export type MachineSummary = { id: string; name: string; active: boolean; accounts: MachineAccounts };

/** Machines that report their Claude accounts. */
export async function listMachineAccounts(db: SupabaseClient): Promise<MachineSummary[]> {
  const rows = must(
    await db.from("machines").select("id,name,active,claude_accounts").not("claude_accounts", "is", null).order("name"),
  ) as any[];
  return rows.map((r) => ({ id: r.id, name: r.name, active: r.active, accounts: r.claude_accounts }));
}

/** A registered machine (each has its own API key). */
export type MachineRow = {
  id: string;
  name: string;
  active: boolean;
  last_seen: string | null;
  all_projects: boolean;
  projectIds: string[];
};

export async function listMachines(db: SupabaseClient): Promise<MachineRow[]> {
  const rows = must(await db.from("machines").select("id,name,active,last_seen,all_projects,project_machines(project_id)").order("name")) as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    active: r.active,
    last_seen: r.last_seen,
    all_projects: r.all_projects,
    projectIds: (r.project_machines ?? []).map((m: { project_id: string }) => m.project_id),
  }));
}

/** API keys go through the Web Machine (it has the secret key), as you. */
async function machinesApi(db: SupabaseClient, path: string, body?: unknown): Promise<any> {
  const { data } = await db.auth.getSession();
  const res = await fetch(`/api/machines${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(json?.error ?? res.statusText);
  return json;
}

/** Register a machine in these Projects. Returns its API key (shown once). */
export async function createMachineKey(db: SupabaseClient, name: string, projectIds: string[]): Promise<string> {
  return (await machinesApi(db, "", { name, project_ids: projectIds })).key;
}

export async function switchMachine(db: SupabaseClient, id: string, on: boolean) {
  await machinesApi(db, `/${id}/${on ? "switch-on" : "switch-off"}`);
}

export async function removeMachine(db: SupabaseClient, id: string) {
  await machinesApi(db, `/${id}/remove`);
}
