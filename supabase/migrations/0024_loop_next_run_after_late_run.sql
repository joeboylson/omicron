-- After a late run (the daemon was off, or the run was overdue), the next
-- run was set to now, so the loop was due again at once and typed its
-- prompt twice. The next run is now the next one on the schedule that's
-- still to come, or a full interval from now if it fell behind.

create or replace function public.loop_ran(loop uuid, due timestamptz) returns setof public.loops
  language sql security definer set search_path = '' as $$
  with next as (
    select l.id,
      case
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
