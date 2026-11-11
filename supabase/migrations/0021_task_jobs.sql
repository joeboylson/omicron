-- A task can link to one or more team jobs: the session handles the task,
-- the team handles the jobs. Links stay within a Project (a team belongs to
-- the Project of its managing session), so whoever sees the task sees its
-- jobs, live.

create table public.task_jobs (
  task_id uuid not null references public.tasks (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, job_id)
);
create index task_jobs_job_idx on public.task_jobs (job_id);

create function public.fill_task_job() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select t.project_id into new.project_id from public.tasks t where t.id = new.task_id;
  if new.project_id is null then
    raise exception 'there''s no such task' using errcode = '23503';
  end if;
  if not exists (select 1 from public.jobs j where j.id = new.job_id and j.project_id = new.project_id) then
    raise exception 'a task can only link to jobs of teams in its own Project' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger fill_task_job before insert on public.task_jobs
  for each row execute function public.fill_task_job();

alter table public.task_jobs enable row level security;
create policy "members" on public.task_jobs for all
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
grant select, insert, delete on public.task_jobs to authenticated;

create trigger record_change after insert or update or delete on public.task_jobs
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.runs_team(uuid) to authenticated;
