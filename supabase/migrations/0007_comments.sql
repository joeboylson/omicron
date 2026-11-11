-- Comments on tasks, from people and from Claude sessions. A session's
-- report on its work is a comment (usually with the Needs review mark put
-- on at the same time).
--
-- The author's name is kept on the comment, so it reads the same after a
-- person or machine is renamed or removed.

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  project_id uuid not null,
  author_id uuid not null default auth.uid(),
  author_name text not null default '',
  -- The Claude session that wrote it, when a session did.
  session_id uuid references public.sessions (id) on delete set null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);
create index comments_task_idx on public.comments (task_id, created_at);

create trigger copy_task_project before insert on public.comments
  for each row execute function public.copy_task_project();

create function public.fill_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.author_id := auth.uid();
  select coalesce(
    (select p.display_name from public.people p where p.id = new.author_id),
    (select m.name from public.machines m where m.id = new.author_id),
    ''
  ) into new.author_name;
  if new.session_id is not null and not exists (
    select 1 from public.sessions s
    where s.id = new.session_id and s.project_id = new.project_id and s.machine_id = new.author_id
  ) then
    raise exception 'a comment can only name a session of its own machine in the same Project' using errcode = '23514';
  end if;
  new.created_at := now();
  return new;
end;
$$;
-- Runs after copy_task_project (triggers fire in name order).
create trigger fill_comment before insert on public.comments
  for each row execute function public.fill_comment();

alter table public.comments enable row level security;
create policy "see comments" on public.comments for select using (public.can_use_project(project_id));
create policy "add comments" on public.comments for insert with check (public.can_use_project(project_id));
create policy "remove your comments" on public.comments for delete
  using (author_id = auth.uid() and public.can_use_project(project_id));
grant select, insert, delete on public.comments to authenticated;

create trigger record_change after insert or update or delete on public.comments
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
