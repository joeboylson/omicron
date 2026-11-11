-- Claude sessions. Omicron doesn't start or host them: it keeps a record of
-- the ones you open yourself, so people and other machines can see which
-- sessions are working on which Project.
--
-- A session belongs to one machine and one Project, and only its machine
-- changes it (through the machine's key, from Claude Code hooks and the
-- `omicron sessions` commands). Members of the Project can see it, and can
-- remove its record.
--
-- `claude_session_id` is Claude Code's own id for the conversation. It
-- changes on /clear (Claude starts a new conversation in the same window),
-- and the record follows it.
--
-- State:
--   open    the window is running
--   closed  it was closed normally
--   gone    it stopped without saying so (a crash, a restart), found later

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  machine_id uuid not null default auth.uid() references public.machines (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  claude_session_id uuid,
  folder text not null default '',
  state text not null default 'open' check (state in ('open', 'closed', 'gone')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);
create index sessions_machine_idx on public.sessions (machine_id);

create function public.touch_session() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger touch_session before update on public.sessions
  for each row execute function public.touch_session();

alter table public.sessions enable row level security;
create policy "see sessions" on public.sessions for select
  using (public.can_use_project(project_id));
create policy "machines add their sessions" on public.sessions for insert
  with check (machine_id = auth.uid() and public.can_use_project(project_id));
create policy "machines change their sessions" on public.sessions for update
  using (machine_id = auth.uid() and public.can_use_project(project_id))
  with check (machine_id = auth.uid() and public.can_use_project(project_id));
create policy "remove sessions" on public.sessions for delete
  using (public.can_use_project(project_id) and (machine_id = auth.uid() or public.is_person()));
grant select, insert, update, delete on public.sessions to authenticated;

create trigger record_change after insert or update or delete on public.sessions
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
