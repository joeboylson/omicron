-- A dispatch nobody finished no longer stays waiting forever (#114).
--
-- A request is only taken within 20 seconds (claim_dispatch), and whoever
-- asked gives up on it after that. But if the asker went away (a closed
-- tab, a stopped command) nothing did, so it stayed 'pending' for good,
-- and one a machine took but never finished (it crashed) stayed 'claimed'.
-- Now, without any timer:
--   - giving up works on a pending request at any time, and on a claimed
--     one once its machine has had two minutes to say how it went;
--   - asking for a new dispatch of a task first fails that task's stale
--     requests, so a task never shows an old one as still going.

create or replace function public.give_up_dispatch(dispatch uuid, why text) returns setof public.dispatches
language sql volatile security definer set search_path = '' as $$
  update public.dispatches d set state = 'failed', error = why, finished_at = now()
  where d.id = give_up_dispatch.dispatch
    and (d.state = 'pending' or (d.state = 'claimed' and d.claimed_at < now() - interval '2 minutes'))
    and public.can_use_project(d.project_id)
  returning d.*;
$$;

create or replace function public.fill_dispatch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  s public.sessions;
begin
  select * into t from public.tasks where id = new.task_id;
  if t.id is null then
    raise exception 'there''s no such task' using errcode = '23503';
  end if;
  if t.assignee_session_id is null then
    raise exception 'give the task to a Claude session first' using errcode = '23514';
  end if;
  select * into s from public.sessions where id = t.assignee_session_id;
  -- This task's requests that can't happen any more.
  update public.dispatches d set state = 'failed', finished_at = now(),
    error = case when d.state = 'pending' then s.name || '''s machine didn''t pick it up in time.'
                 else 'Its machine took it but never said how it went.' end
  where d.task_id = t.id
    and ((d.state = 'pending' and d.created_at < now() - interval '20 seconds')
      or (d.state = 'claimed' and d.claimed_at < now() - interval '2 minutes'));
  new.project_id := t.project_id;
  new.session_id := s.id;
  new.machine_id := s.machine_id;
  new.requested_by := auth.uid();
  new.state := 'pending';
  new.result := null;
  new.error := null;
  new.created_at := now();
  new.claimed_at := null;
  new.finished_at := null;
  return new;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.give_up_dispatch(uuid, text) to authenticated;
