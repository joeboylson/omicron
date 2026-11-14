-- A dispatch's 20 seconds, held in one place: the database (#140).
--
-- Each request says when it can no longer be taken (claim_by). Taking it
-- (claim_dispatch) and failing old ones (fill_dispatch) read it, and pages
-- show it, so no page or command keeps its own copy of the number.

-- Set when the request is made (fill_dispatch), never by whoever asks.
alter table public.dispatches add column claim_by timestamptz;
update public.dispatches set claim_by = created_at + interval '20 seconds' where claim_by is null;
alter table public.dispatches alter column claim_by set not null;

create or replace function public.claim_dispatch(dispatch uuid) returns setof public.dispatches
language sql volatile security definer set search_path = '' as $$
  update public.dispatches d set state = 'claimed', claimed_at = now()
  where d.id = claim_dispatch.dispatch
    and d.state = 'pending'
    and d.machine_id = auth.uid()
    and now() < d.claim_by
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
    and ((d.state = 'pending' and d.claim_by < now())
      or (d.state = 'claimed' and d.claimed_at < now() - interval '2 minutes'));
  new.project_id := t.project_id;
  new.session_id := s.id;
  new.machine_id := s.machine_id;
  new.requested_by := auth.uid();
  new.state := 'pending';
  new.result := null;
  new.error := null;
  new.created_at := now();
  new.claim_by := now() + interval '20 seconds';
  new.claimed_at := null;
  new.finished_at := null;
  return new;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.claim_dispatch(uuid) to authenticated;
