-- Runs: one computer works down a Project's To do column on its own, in
-- one session (see ref/BRAINSTORM.md, "Runs"). The run's machine does the
-- work: it gives the session the top task, waits until the task leaves To
-- do and Doing, has the session hand off and clear, then gives it the next.
-- It stops when To do is empty, when it's paused or stopped, or when it
-- may no longer take orders (a run started from elsewhere goes only from
-- the machine's owner, while its gate is open; the machine checks).

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  machine_id uuid not null references public.machines (id) on delete cascade,
  session_id uuid references public.sessions (id) on delete set null,
  -- Only tasks with this label, if set.
  label_id uuid references public.labels (id) on delete set null,
  -- running; pausing (finish the current task, then stop); stopped; finished.
  state text not null default 'running' check (state in ('running', 'pausing', 'stopped', 'finished')),
  -- The task it's on now.
  task_id uuid references public.tasks (id) on delete set null,
  -- How many tasks it has finished.
  done integer not null default 0,
  -- What it's doing or why it stopped, in plain words.
  note text,
  started_by uuid not null default auth.uid(),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index runs_project_idx on public.runs (project_id, started_at desc);
-- One run at a time in a session.
create unique index runs_one_per_session on public.runs (session_id) where state in ('running', 'pausing');

-- Who started it is the login that did; the session must be the machine's,
-- in the same Project. Anyone but the run's machine can only pause or stop it.
create function public.check_run() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.started_by := auth.uid();
    new.state := 'running';
    new.done := 0;
    new.task_id := null;
    if not exists (
      select 1 from public.sessions s
      where s.id = new.session_id and s.machine_id = new.machine_id and s.project_id = new.project_id
    ) then
      raise exception 'a run needs one of its machine''s sessions in the Project' using errcode = '23514';
    end if;
  elsif auth.uid() is distinct from old.machine_id then
    if new.state not in ('pausing', 'stopped') or old.state not in ('running', 'pausing')
       or (to_jsonb(new) - 'state' - 'updated_at') <> (to_jsonb(old) - 'state' - 'updated_at') then
      raise exception 'only the run''s machine changes a run; others can pause or stop it' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger check_run before insert or update on public.runs
  for each row execute function public.check_run();

alter table public.runs enable row level security;
create policy "see runs" on public.runs for select using (public.can_use_project(project_id));
create policy "start runs" on public.runs for insert
  with check (public.can_use_project(project_id) and public.machine_can_use(machine_id, project_id));
create policy "change runs" on public.runs for update
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
create policy "remove runs" on public.runs for delete
  using (public.can_use_project(project_id) and public.is_person());
grant select, insert, update, delete on public.runs to authenticated;

create trigger record_change after insert or update or delete on public.runs
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
