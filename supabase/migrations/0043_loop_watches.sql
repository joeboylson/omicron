-- One kind of loop (#278): a loop has a timer (every so often, or "as soon
-- as it's done"), an optional message, Start Fresh, and a list of watches:
-- sets of tasks its session checks each run, with `omicron loop check`.

alter table public.loops
  add column asap boolean not null default false,
  -- Off for loops already running (they keep doing what they did), on for new ones.
  add column start_fresh boolean not null default false,
  -- The board rules as `omicron loop check` last gave them, to say when they change.
  add column rules_seen text;
alter table public.loops alter column start_fresh set default true;
alter table public.loops drop constraint loops_command_needs,
  add constraint loops_command_needs check (kind = 'tasks' or every_seconds is not null or asap);
-- (A command loop's message is optional now: one with only watches is a watcher.)

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
    -- The first run comes after one interval, or straight away when the
    -- loop is started with a first run time given ("Run now", #260).
    -- Run now, or "as soon as it's done" (#278): at once (it's typed in
    -- when the session is free). Otherwise after one interval.
    new.next_run_at := case
      when new.next_run_at is not null or new.asap then now()
      else now() + make_interval(secs => new.every_seconds)
    end;
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


-- After a run: "as soon as it's done" is due again at once (typed in when
-- the session is free); every so often, the next time on the schedule.
create or replace function public.loop_ran(loop uuid, due timestamptz) returns setof public.loops
  language sql security definer set search_path = '' as $$
  with next as (
    select l.id,
      case
        when l.asap then now()
        when l.next_run_at + make_interval(secs => l.every_seconds) > now() then l.next_run_at + make_interval(secs => l.every_seconds)
        else now() + make_interval(secs => l.every_seconds)
      end as at
    from public.loops l
    where l.id = loop_ran.loop
  )
  update public.loops l set
    runs = l.runs + 1,
    last_run_at = now(),
    note = null,
    next_run_at = next.at,
    state = case
      when l.times is not null and l.runs + 1 >= l.times then 'finished'
      when l.until is not null and next.at > l.until then 'finished'
      else 'running'
    end,
    ended_at = case
      when (l.times is not null and l.runs + 1 >= l.times) or (l.until is not null and next.at > l.until) then now()
    end
  from next
  where l.id = next.id and l.state = 'running' and l.machine_id = auth.uid() and l.next_run_at = loop_ran.due
  returning l.*;
$$;

-- A check that found nothing new: an "as soon as it's done" loop waits a
-- while before the next, so an empty board doesn't spin (the loop's machine only).
create function public.loop_idle(loop uuid, wait_seconds integer) returns void
language sql volatile security definer set search_path = '' as $$
  update public.loops l set next_run_at = now() + make_interval(secs => greatest(wait_seconds, 60))
  where l.id = loop_idle.loop and l.state = 'running' and l.machine_id = auth.uid();
$$;

-- What `omicron loop check` gave as the board rules (the loop's machine only).
create function public.loop_saw_rules(loop uuid, rules text) returns void
language sql volatile security definer set search_path = '' as $$
  update public.loops l set rules_seen = loop_saw_rules.rules
  where l.id = loop_saw_rules.loop and l.machine_id = auth.uid() and l.rules_seen is distinct from loop_saw_rules.rules;
$$;

create table public.loop_watches (
  id uuid primary key default gen_random_uuid(),
  loop_id uuid not null references public.loops (id) on delete cascade,
  -- Filled in from the loop.
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Which tasks: any mix of these (all must match), or one task.
  status_ids uuid[] not null default '{}',
  label_ids uuid[] not null default '{}',
  given_person uuid references public.people (id) on delete cascade,
  given_session uuid references public.sessions (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  -- Its own instructions, on top of the board rules.
  instructions text not null default '' check (length(instructions) <= 20000),
  -- When `omicron loop check` last went through it.
  checked_at timestamptz,
  created_at timestamptz not null default now()
);
create index loop_watches_loop_idx on public.loop_watches (loop_id);

create function public.fill_loop_watch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  l public.loops;
begin
  select * into l from public.loops where id = new.loop_id;
  if l.id is null then
    raise exception 'there''s no such loop' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' then
    if l.kind <> 'command' then
      raise exception 'only a loop that types a message or checks a list can watch tasks' using errcode = '23514';
    end if;
    new.project_id := l.project_id;
    new.checked_at := null;
    new.created_at := now();
  elsif new.loop_id <> old.loop_id or new.project_id <> old.project_id then
    raise exception 'a watch stays on its loop' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger fill_loop_watch before insert or update on public.loop_watches
  for each row execute function public.fill_loop_watch();

-- Watching something new (or not any more) is an order to the loop's
-- session: whoever does it becomes the one who gave it, so the machine's
-- owner and remote control decide, as for starting or changing a loop.
create function public.loop_watch_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  lid uuid := coalesce(new.loop_id, old.loop_id);
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'checked_at') = (to_jsonb(old) - 'checked_at') then
    return null;
  end if;
  if auth.uid() is not null then
    perform set_config('omicron.changing_loop', 'on', true);
    update public.loops set started_by = auth.uid() where id = lid and machine_id <> auth.uid();
    perform set_config('omicron.changing_loop', '', true);
  end if;
  return null;
end;
$$;
create trigger loop_watch_order after insert or update or delete on public.loop_watches
  for each row execute function public.loop_watch_order();

alter table public.loop_watches enable row level security;
create policy "see loop watches" on public.loop_watches for select using (public.can_use_project(project_id));
create policy "add loop watches" on public.loop_watches for insert with check (public.can_use_project(project_id));
create policy "change loop watches" on public.loop_watches for update
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
create policy "remove loop watches" on public.loop_watches for delete using (public.can_use_project(project_id));
grant select, insert, update, delete on public.loop_watches to authenticated;

create trigger record_change after insert or update or delete on public.loop_watches
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
grant execute on function public.loop_ran(uuid, timestamptz) to authenticated;
grant execute on function public.loop_idle(uuid, integer) to authenticated;
grant execute on function public.loop_saw_rules(uuid, text) to authenticated;
