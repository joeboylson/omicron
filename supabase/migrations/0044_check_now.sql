-- Check Now (#278): a running loop's next run straight away, for anyone in
-- its Project (Dispatch, for a session that has a loop). Its message and
-- list stay as they are, so who gave the order doesn't change.
create function public.check_now(loop uuid) returns setof public.loops
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform set_config('omicron.changing_loop', 'on', true);
  return query
  with changed as (
    update public.loops l set next_run_at = now(), note = null
    where l.id = check_now.loop and l.state = 'running' and l.kind = 'command' and public.can_use_project(l.project_id)
    returning l.*
  )
  select * from changed;
  perform set_config('omicron.changing_loop', '', true);
end;
$$;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.check_now(uuid) to authenticated;
