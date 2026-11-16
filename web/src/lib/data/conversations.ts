// Conversations (#281): a Project's group chats with its Claude sessions,
// their messages and pinned tasks. (The same as `omicron conversations`.)

import type { SupabaseClient } from "@supabase/supabase-js";
import { must } from "../omicron";
import type { Message } from "./types";

export async function startConversation(db: SupabaseClient, projectId: string, name: string): Promise<string> {
  const row = must(await db.from("conversations").insert({ project_id: projectId, name: name.trim() }).select("id").single()) as { id: string };
  return row.id;
}

export async function renameConversation(db: SupabaseClient, id: string, name: string) {
  must(await db.from("conversations").update({ name: name.trim() }).eq("id", id));
}

export async function deleteConversation(db: SupabaseClient, id: string) {
  must(await db.from("conversations").delete().eq("id", id));
}

export async function markConversationRead(db: SupabaseClient, id: string) {
  must(await db.from("conversations").update({ unread: false }).eq("id", id));
}

/** A conversation's messages, oldest first. */
export async function loadMessages(db: SupabaseClient, conversationId: string): Promise<Message[]> {
  const rows = must(
    await db.from("messages").select("id,author_name,body,created_at,images,sessions(name)").eq("conversation_id", conversationId).order("created_at"),
  ) as any[];
  return rows.map((m) => ({ id: m.id, author: m.author_name, session: m.sessions?.name ?? null, body: m.body, created_at: m.created_at, images: m.images ?? [] }));
}

export async function postMessage(db: SupabaseClient, conversationId: string, body: string, images: string[] = []) {
  must(await db.from("messages").insert({ conversation_id: conversationId, body, images }));
}

export async function pinTask(db: SupabaseClient, conversationId: string, taskId: string) {
  must(await db.from("conversation_tasks").insert({ conversation_id: conversationId, task_id: taskId }));
}

export async function unpinTask(db: SupabaseClient, conversationId: string, taskId: string) {
  must(await db.from("conversation_tasks").delete().eq("conversation_id", conversationId).eq("task_id", taskId));
}

/** The conversations that mention a task (#12), by id and name. */
export async function mentionsOf(db: SupabaseClient, taskId: string): Promise<{ id: string; name: string }[]> {
  const rows = must(await db.from("message_mentions").select("conversations(id,name)").eq("task_id", taskId)) as any[];
  const seen = new Map<string, string>();
  for (const r of rows) if (r.conversations) seen.set(r.conversations.id, r.conversations.name);
  return [...seen].map(([id, name]) => ({ id, name }));
}
