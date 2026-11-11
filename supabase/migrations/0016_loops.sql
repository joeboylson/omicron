-- Loops: Omicron keeps a session's loop going, instead of the session
-- having to remember to wake itself up. A loop is a prompt typed into the
-- session every so often, until it's stopped, an end time passes, or it has
-- run a set number of times.
--
-- The session's machine runs it (its daemon): when a run is due and the
-- session has finished its turn, it types the prompt in and records the run
-- here. A busy session is waited for, so runs never stack up.
--
-- State:
--   running   it runs when due
--   stopped   someone stopped it
--   finished  it reached its end time or number of runs

create table public.loops (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  -- Filled in from the session.
  project_id uuid not null references public.projects (id) on delete cascade,
  machine_id uuid not null references public.machines (id) on delete cascade,
  prompt text not null check (length(trim(prompt)) > 0),
  every_seconds integer not null check (every_seconds >= 60),
  -- Optional ends: a time, a number of runs, or neither (until stopped).
  until timestamptz,
  times integer check (times > 0),
  runs integer not null default 0,
  state text not null default 'running' check (state in ('running', 'stopped', 'finished')),
  -- What the machine last had to say (like waiting for the session), if anything.
  note text,
  next_run_at timestamptz not null default now(),
  last_run_at timestamptz,
  started_by uuid not null default auth.uid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index loops_one_running on public.loops (session_id) where state = 'running';
create index loops_machine_idx on public.loops (machine_id) where state = 'running';

create function public.fill_loop() returns trigger
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
  new.state := 'running';
  new.runs := 0;
  new.note := null;
  new.last_run_at := null;
  new.ended_at := null;
  -- The first run comes after one interval.
  new.next_run_at := now() + make_interval(secs => new.every_seconds);
  if new.until is not null and new.until <= now() then
    raise exception 'the end time has already passed' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger fill_loop before insert on public.loops
  for each row execute function public.fill_loop();

alter table public.loops enable row level security;
create policy "see loops" on public.loops for select using (public.can_use_project(project_id));
create policy "start loops" on public.loops for insert with check (public.can_use_project(project_id));
-- Changes go through the functions below.
grant select, insert on public.loops to authenticated;

create trigger record_change after insert or update or delete on public.loops
  for each row execute function public.record_change();

-- Anyone in the Project stops a loop.
create function public.stop_loop(loop uuid) returns setof public.loops
language sql volatile security definer set search_path = '' as $$
  update public.loops l set state = 'stopped', ended_at = now()
  where l.id = stop_loop.loop and l.state = 'running' and public.can_use_project(l.project_id)
  returning l.*;
$$;

-- The machine records a run (only its own loops, only once per due time):
-- counts it, sets the next one, and finishes the loop if that was the last.
create function public.loop_ran(loop uuid, due timestamptz) returns setof public.loops
language sql volatile security definer set search_path = '' as $$
  update public.loops l set
    runs = l.runs + 1,
    last_run_at = now(),
    note = null,
    next_run_at = greatest(l.next_run_at + make_interval(secs => l.every_seconds), now()),
    state = case
      when l.times is not null and l.runs + 1 >= l.times then 'finished'
      when l.until is not null and greatest(l.next_run_at + make_interval(secs => l.every_seconds), now()) > l.until then 'finished'
      else 'running'
    end,
    ended_at = case
      when (l.times is not null and l.runs + 1 >= l.times)
        or (l.until is not null and greatest(l.next_run_at + make_interval(secs => l.every_seconds), now()) > l.until) then now()
    end
  where l.id = loop_ran.loop and l.state = 'running' and l.machine_id = auth.uid() and l.next_run_at = loop_ran.due
  returning l.*;
$$;

-- The machine says why a due run is waiting (or clears it with null).
-- Only changes anything when the note is different.
create function public.loop_note(loop uuid, note text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.loops l set note = loop_note.note
  where l.id = loop_note.loop and l.state = 'running' and l.machine_id = auth.uid()
    and l.note is distinct from loop_note.note;
$$;

-- A loop past its end time that never got to run again finishes too.
create function public.finish_loop(loop uuid) returns void
language sql volatile security definer set search_path = '' as $$
  update public.loops l set state = 'finished', ended_at = now()
  where l.id = finish_loop.loop and l.state = 'running' and l.machine_id = auth.uid()
    and l.until is not null and l.until <= now();
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.stop_loop(uuid) to authenticated;
grant execute on function public.loop_ran(uuid, timestamptz) to authenticated;
grant execute on function public.loop_note(uuid, text) to authenticated;
grant execute on function public.finish_loop(uuid) to authenticated;
