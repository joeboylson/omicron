-- Runs and loops become one idea (#258): a loop, of one of two kinds.
--   command  a message typed into the session every so often (the old loops)
--   tasks    the session works down tasks one at a time: chosen ones in
--            order (task_ids), or the top status (the old runs)
-- The runs table's rows move into loops, and runs goes.

alter table public.loops
  add column kind text not null default 'command' check (kind in ('command', 'tasks')),
  alter column prompt drop not null,
  alter column every_seconds drop not null,
  alter column next_run_at drop not null,
  -- Tasks loops: only tasks with this label, if set; the chosen tasks, if
  -- any; the task it's on now; how many it has finished.
  add column label_id uuid references public.labels (id) on delete set null,
  add column task_ids uuid[],
  add column task_id uuid references public.tasks (id) on delete set null,
  add column done integer not null default 0,
  add column updated_at timestamptz not null default now(),
  add constraint loops_command_needs check (kind = 'tasks' or (prompt is not null and every_seconds is not null));

-- pausing: a tasks loop finishing the task it's on, then stopping.
alter table public.loops drop constraint loops_state_check,
  add constraint loops_state_check check (state in ('running', 'pausing', 'stopped', 'finished'));

-- One loop at a time in a session, of either kind.
drop index public.loops_one_running;
create unique index loops_one_per_session on public.loops (session_id) where state in ('running', 'pausing');
drop index public.loops_machine_idx;
create index loops_machine_idx on public.loops (machine_id) where state in ('running', 'pausing');
create index loops_project_idx on public.loops (project_id, started_at desc);

create or replace function public.fill_loop() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
begin
  select * into s from public.sessions where id = new.session_id;
  if s.id is null then
    raise exception 'there''s no such session' using errcode = '23503';
  end if;
  new.project_id := s.project_id;
  new.machine_id := s.machine_id;
  new.started_by := auth.uid();
  new.started_at := now();
  new.updated_at := now();
  new.state := 'running';
  new.runs := 0;
  new.done := 0;
  new.task_id := null;
  new.note := null;
  new.last_run_at := null;
  new.ended_at := null;
  if new.kind = 'command' then
    -- The first run comes after one interval.
    new.next_run_at := now() + make_interval(secs => new.every_seconds);
    new.label_id := null;
    new.task_ids := null;
  else
    new.next_run_at := null;
    new.prompt := null;
    new.every_seconds := null;
    new.times := null;
    new.until := null;
  end if;
  if new.until is not null and new.until <= now() then
    raise exception 'the end time has already passed' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- The loop's machine changes anything; anyone else in the Project can only
-- pause a tasks loop or stop a loop.
create function public.check_loop_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- (The service role, with no login, is Omicron's own upkeep and tests.)
  if auth.uid() is not null and auth.uid() is distinct from old.machine_id then
    if old.state not in ('running', 'pausing')
       or new.state not in ('pausing', 'stopped')
       or (new.state = 'pausing' and old.kind <> 'tasks')
       or (to_jsonb(new) - 'state' - 'updated_at' - 'ended_at') <> (to_jsonb(old) - 'state' - 'updated_at' - 'ended_at') then
      raise exception 'only the loop''s machine changes a loop; others can pause or stop it' using errcode = '42501';
    end if;
  end if;
  if new.state in ('stopped', 'finished') and old.state not in ('stopped', 'finished') then
    new.ended_at := coalesce(new.ended_at, now());
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger check_loop_change before update on public.loops
  for each row execute function public.check_loop_change();

create policy "change loops" on public.loops for update
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
create policy "remove loops" on public.loops for delete
  using (public.can_use_project(project_id) and public.is_person());
grant update, delete on public.loops to authenticated;

-- Stopping works on a pausing loop too.
create or replace function public.stop_loop(loop uuid) returns setof public.loops
language sql volatile security definer set search_path = '' as $$
  update public.loops l set state = 'stopped', ended_at = now()
  where l.id = stop_loop.loop and l.state in ('running', 'pausing') and public.can_use_project(l.project_id)
  returning l.*;
$$;

-- Move the runs over (one whose session is gone has nothing to show).
alter table public.loops disable trigger fill_loop;
insert into public.loops (id, kind, session_id, project_id, machine_id, label_id, task_ids, task_id, done, state, note,
                          started_by, started_at, updated_at, ended_at, runs, next_run_at)
select r.id, 'tasks', r.session_id, r.project_id, r.machine_id, r.label_id, r.task_ids, r.task_id, r.done,
       -- A session holds one loop at a time: a run beside a running loop stops.
       case when r.state in ('running', 'pausing') and exists (
              select 1 from public.loops l where l.session_id = r.session_id and l.state = 'running'
            ) then 'stopped' else r.state end,
       r.note, r.started_by, r.started_at, r.updated_at,
       case when r.state in ('stopped', 'finished') then r.updated_at end, 0, null
from public.runs r
where r.session_id is not null;
alter table public.loops enable trigger fill_loop;

drop table public.runs;
drop function public.check_run();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.stop_loop(uuid) to authenticated;
