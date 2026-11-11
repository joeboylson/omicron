-- Teams (the legion rewrite; plan in ref/TEAMS.md). Most of a team lives on
-- the machine running it. Only what people elsewhere need to see is here:
-- teams, their jobs and their status, and their workers.
--
-- A team belongs to a Project (the one its managing Claude session is in),
-- so the usual access rules and the change list apply: people in the
-- Project see it live. Only the team's machine changes the team and its
-- workers. People in the Project add and edit jobs; the machine moves them
-- along.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  machine_id uuid not null default auth.uid() references public.machines (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  folder text not null check (length(trim(folder)) > 0),
  workflow text not null default 'default',
  -- The Claude session that manages it, if any.
  session_id uuid references public.sessions (id) on delete set null,
  state text not null default 'running' check (state in ('running', 'stopped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (machine_id, name)
);

-- Job states:
--   waiting   added, not started
--   working   a worker has it
--   blocked   stuck: waiting on a person (a request) or something else
--   done      finished (its work is on the base branch)
--   cancelled dropped
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Short number within the team, like job #3.
  number integer not null default 0,
  title text not null check (length(trim(title)) > 0),
  text text not null default '',
  state text not null default 'waiting' check (state in ('waiting', 'working', 'blocked', 'done', 'cancelled')),
  -- The role it's with now, like builder.
  step text,
  -- Why it's blocked, or what it ended with.
  note text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (team_id, number)
);
create index jobs_team_idx on public.jobs (team_id, number);

-- Worker states: starting, busy, idle, stopped, gone (ended without saying).
create table public.workers (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Its name in the team: the role, or a copy of it (builder, builder-2).
  name text not null check (name ~ '^[a-z0-9][a-z0-9_-]*$'),
  role text not null,
  -- lead and advisor are special; anything else is a role from the workflow.
  state text not null default 'starting' check (state in ('starting', 'busy', 'idle', 'stopped', 'gone')),
  job_id uuid references public.jobs (id) on delete set null,
  -- Which part of the job's step, when it was split.
  part text,
  updated_at timestamptz not null default now(),
  unique (team_id, name)
);

-- Jobs and workers take their Project from their team; jobs get the next
-- number in their team (locked per team, so two at once can't share one).
create function public.fill_team_row() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select t.project_id into new.project_id from public.teams t where t.id = new.team_id;
  if new.project_id is null then
    raise exception 'there''s no such team' using errcode = '23503';
  end if;
  if tg_table_name = 'jobs' and tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext(new.team_id::text));
    select coalesce(max(j.number), 0) + 1 into new.number from public.jobs j where j.team_id = new.team_id;
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;
create trigger fill_team_row before insert or update of team_id on public.jobs
  for each row execute function public.fill_team_row();
create trigger fill_team_row before insert or update of team_id on public.workers
  for each row execute function public.fill_team_row();

-- A job keeps its number and team; finishing stamps the time.
create function public.touch_job() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.number := old.number;
    new.team_id := old.team_id;
    new.created_by := old.created_by;
    if new.state in ('done', 'cancelled') and old.state not in ('done', 'cancelled') then
      new.finished_at := now();
    elsif new.state not in ('done', 'cancelled') then
      new.finished_at := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger touch_job before insert or update on public.jobs
  for each row execute function public.touch_job();

create function public.touch_team_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger touch_team_row before update on public.teams
  for each row execute function public.touch_team_row();
create trigger touch_team_row before update on public.workers
  for each row execute function public.touch_team_row();

-- A team's managing session must be in the same Project.
create function public.check_team_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.session_id and s.project_id = new.project_id
  ) then
    raise exception 'a team''s session must be in the team''s Project' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_team_session before insert or update of session_id, project_id on public.teams
  for each row execute function public.check_team_session();

-- Is the signed-in machine the one running this team?
create function public.runs_team(team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.teams t where t.id = team and t.machine_id = auth.uid());
$$;
grant execute on function public.runs_team(uuid) to authenticated;

alter table public.teams enable row level security;
create policy "see teams" on public.teams for select using (public.can_use_project(project_id));
create policy "machines add their teams" on public.teams for insert
  with check (machine_id = auth.uid() and public.can_use_project(project_id));
create policy "machines change their teams" on public.teams for update
  using (machine_id = auth.uid()) with check (machine_id = auth.uid() and public.can_use_project(project_id));
create policy "remove teams" on public.teams for delete
  using (public.can_use_project(project_id) and (machine_id = auth.uid() or public.is_person()));
grant select, insert, update, delete on public.teams to authenticated;

alter table public.jobs enable row level security;
create policy "see jobs" on public.jobs for select using (public.can_use_project(project_id));
create policy "add jobs" on public.jobs for insert with check (public.can_use_project(project_id));
create policy "change jobs" on public.jobs for update
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
create policy "remove jobs" on public.jobs for delete
  using (public.can_use_project(project_id) and (public.runs_team(team_id) or public.is_person()));
grant select, insert, update, delete on public.jobs to authenticated;

alter table public.workers enable row level security;
create policy "see workers" on public.workers for select using (public.can_use_project(project_id));
create policy "the team's machine runs its workers" on public.workers for all
  using (public.runs_team(team_id)) with check (public.runs_team(team_id) and public.can_use_project(project_id));
grant select, insert, update, delete on public.workers to authenticated;

create trigger record_change after insert or update or delete on public.teams
  for each row execute function public.record_change();
create trigger record_change after insert or update or delete on public.jobs
  for each row execute function public.record_change();
create trigger record_change after insert or update or delete on public.workers
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.runs_team(uuid) to authenticated;
