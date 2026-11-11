-- Team requests: a question from a team member to a person. It's a task in
-- the team's Project (given to whoever added the job, when a person did),
-- so it shows on the board and the phone. The answer is a comment on that
-- task, which the team's machine passes back to the member who asked.

create table public.team_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  -- The member who asked, like builder-2.
  worker text not null,
  task_id uuid not null unique references public.tasks (id) on delete cascade,
  state text not null default 'open' check (state in ('open', 'answered')),
  created_at timestamptz not null default now()
);

create trigger fill_team_row before insert on public.team_requests
  for each row execute function public.fill_team_row();

alter table public.team_requests enable row level security;
create policy "see team requests" on public.team_requests for select using (public.can_use_project(project_id));
create policy "the team's machine keeps its requests" on public.team_requests for all
  using (public.runs_team(team_id)) with check (public.runs_team(team_id) and public.can_use_project(project_id));
grant select, insert, update, delete on public.team_requests to authenticated;

create trigger record_change after insert or update or delete on public.team_requests
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.runs_team(uuid) to authenticated;
