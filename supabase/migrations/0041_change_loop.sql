-- Change a running loop (#262): its message, how often, how many times,
-- and what it does in each case. `reset_time` puts the next run at once (with
-- the new timing from then on); without it the next run stays where it
-- is, and the new timing counts from that run.
--
-- Whoever changes it becomes the one who gave the order (started_by), so
-- a loop changed from elsewhere still needs the machine's owner and its
-- remote control, like one started from elsewhere.

-- The loop's machine changes anything; anyone else in the Project can only
-- pause a tasks loop or stop a loop, or change it through change_loop.
create or replace function public.check_loop_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- (The service role, with no login, is Omicron's own upkeep and tests.)
  if auth.uid() is not null and auth.uid() is distinct from old.machine_id
     and coalesce(current_setting('omicron.changing_loop', true), '') <> 'on' then
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

create function public.change_loop(
  loop_id uuid,
  prompt text,
  every_seconds integer,
  times integer,
  rules jsonb,
  reset_time boolean
) returns setof public.loops
language plpgsql volatile security definer set search_path = '' as $$
#variable_conflict use_column
begin
  perform set_config('omicron.changing_loop', 'on', true);
  return query
  with changed as (
  update public.loops l set
    prompt = change_loop.prompt,
    every_seconds = change_loop.every_seconds,
    times = change_loop.times,
    rules = coalesce(change_loop.rules, '{}'::jsonb),
    started_by = auth.uid(),
    note = null,
    next_run_at = case when change_loop.reset_time then now() else l.next_run_at end,
    -- Fewer times than it has already run: it's done.
    state = case when change_loop.times is not null and l.runs >= change_loop.times then 'finished' else l.state end
  where l.id = change_loop.loop_id
    and l.kind = 'command'
    and l.state = 'running'
    and public.can_use_project(l.project_id)
  returning l.*
  )
  select * from changed;
  perform set_config('omicron.changing_loop', '', true);
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.change_loop(uuid, text, integer, integer, jsonb, boolean) to authenticated;
