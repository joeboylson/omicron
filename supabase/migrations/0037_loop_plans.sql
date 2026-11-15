-- Loops (#253): a run and a loop are both loops now. A run can work down a
-- chosen set of tasks instead of the top status, and a loop can be drafted
-- first (its tasks gathered over time, from the Tasks page too) or kept as
-- a template to start new ones from.

-- The tasks a run works down, in order; null means the top status, as before.
alter table public.runs add column task_ids uuid[];

-- A loop not started yet (a draft), or a template for new ones. A command
-- loop types `prompt` into its session every `every_seconds`, `times` times
-- (or until stopped); a tasks loop works down `task_ids` one at a time. A
-- template never keeps tasks or a session: those are chosen when it's used.
create table public.loop_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null default '',
  kind text not null check (kind in ('command', 'tasks')),
  prompt text not null default '',
  every_seconds integer check (every_seconds >= 60),
  times integer check (times > 0),
  task_ids uuid[] not null default '{}',
  session_id uuid references public.sessions (id) on delete set null,
  template boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index loop_plans_project_idx on public.loop_plans (project_id, created_at);

-- A template keeps no tasks and no session; a session must be the Project's.
create function public.check_loop_plan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.template then
    new.task_ids := '{}';
    new.session_id := null;
  end if;
  if new.session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.session_id and s.project_id = new.project_id
  ) then
    raise exception 'that session isn''t in this Project' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.project_id <> old.project_id then
    raise exception 'a loop can''t move to another Project' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger check_loop_plan before insert or update on public.loop_plans
  for each row execute function public.check_loop_plan();

alter table public.loop_plans enable row level security;
create policy "see loop plans" on public.loop_plans for select using (public.can_use_project(project_id));
create policy "add loop plans" on public.loop_plans for insert
  with check (public.can_use_project(project_id) and public.is_person());
create policy "change loop plans" on public.loop_plans for update
  using (public.can_use_project(project_id) and public.is_person())
  with check (public.can_use_project(project_id) and public.is_person());
create policy "remove loop plans" on public.loop_plans for delete
  using (public.can_use_project(project_id) and public.is_person());
grant select, insert, update, delete on public.loop_plans to authenticated;

create trigger record_change after insert or update or delete on public.loop_plans
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
