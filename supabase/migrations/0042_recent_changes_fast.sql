-- recent_changes() ran past Supabase's 8-second limit once the change list
-- grew (#267): with the newest time hidden in a subquery, the planner read
-- the whole table instead of using changes_at_idx, so a machine's daemon
-- could never catch up. Now the newest time is looked up first (newest
-- first, one line, from the index), and the lines from the last second
-- before it are read with that time as a real value.
--
-- Still security invoker (no security definer): the row rules decide what
-- each caller sees, as before (tests/access.rs checks it).

create or replace function public.recent_changes() returns setof public.changes
language plpgsql stable set search_path = '' as $$
declare
  newest timestamptz;
begin
  select c.at into newest from public.changes c order by c.at desc limit 1;
  if newest is null then
    return;
  end if;
  return query execute
    'select * from public.changes where at >= $1 order by seq'
    using newest - interval '1 second';
end;
$$;
grant execute on function public.recent_changes() to authenticated;
