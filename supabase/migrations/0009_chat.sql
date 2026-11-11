-- One chat per Project, for people and Claude sessions. Off until a member
-- turns it on.
--
-- Sessions aren't sent every message. A message that names a session
-- (`@parser`) reaches it at the end of its next turn, like a task sent to
-- it; `chat_read_at` is how far it has read.

alter table public.projects add column chat_enabled boolean not null default false;
alter table public.sessions add column chat_read_at timestamptz not null default now();

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  author_id uuid not null default auth.uid(),
  author_name text not null default '',
  -- The Claude session that wrote it, when a session did.
  session_id uuid references public.sessions (id) on delete set null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index chat_messages_project_idx on public.chat_messages (project_id, created_at);

-- The author's name, the session check and the time, as for comments.
create trigger fill_comment before insert on public.chat_messages
  for each row execute function public.fill_comment();

alter table public.chat_messages enable row level security;
create policy "see chat" on public.chat_messages for select using (public.can_use_project(project_id));
create policy "chat when it's on" on public.chat_messages for insert with check (
  public.can_use_project(project_id)
  and exists (select 1 from public.projects p where p.id = project_id and p.chat_enabled)
);
create policy "remove your messages" on public.chat_messages for delete
  using (author_id = auth.uid() and public.can_use_project(project_id));
grant select, insert, delete on public.chat_messages to authenticated;

create trigger record_change after insert or update or delete on public.chat_messages
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
