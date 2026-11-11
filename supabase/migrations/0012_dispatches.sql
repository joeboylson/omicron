-- Dispatch: a request to hand a task to its Claude session, on the
-- session's own machine.
--
-- Anyone in the Project asks (a person on the web page, or `omicron tasks
-- dispatch`). The session's machine hears the new row live, claims it (only
-- it can, and only once), opens the session in its host with the task (or
-- types it into the one that's running), and saves how it went.
--
-- A request that isn't claimed within 20 seconds can't be claimed any more:
-- whoever asked gives up on it (`give_up_dispatch`), and a machine catching
-- up later never acts on an old request.
--
-- State:
--   pending  waiting for the machine
--   claimed  the machine took it and is opening the session
--   done     the session has the task (`result` says how)
--   failed   it didn't happen (`error` says why)

create table public.dispatches (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  -- Filled in from the task when the request is made.
  project_id uuid not null references public.projects (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  machine_id uuid not null references public.machines (id) on delete cascade,
  requested_by uuid not null default auth.uid(),
  state text not null default 'pending' check (state in ('pending', 'claimed', 'done', 'failed')),
  result text,
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  finished_at timestamptz
);
create index dispatches_task_idx on public.dispatches (task_id, created_at desc);

-- The request names only the task; the rest comes from it, so nobody can
-- point a request at another machine.
create function public.fill_dispatch() returns trigger
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
create trigger fill_dispatch before insert on public.dispatches
  for each row execute function public.fill_dispatch();

alter table public.dispatches enable row level security;
create policy "see dispatches" on public.dispatches for select
  using (public.can_use_project(project_id));
create policy "ask for dispatches" on public.dispatches for insert
  with check (public.can_use_project(project_id));
-- Changes go through the functions below.
grant select, insert on public.dispatches to authenticated;

create trigger record_change after insert or update or delete on public.dispatches
  for each row execute function public.record_change();

-- The session's machine takes the request, if it's still waiting and not
-- too old. Returns the request, or nothing if it can't be taken.
create function public.claim_dispatch(dispatch uuid) returns setof public.dispatches
language sql volatile security definer set search_path = '' as $$
  update public.dispatches d set state = 'claimed', claimed_at = now()
  where d.id = claim_dispatch.dispatch
    and d.state = 'pending'
    and d.machine_id = auth.uid()
    and d.created_at > now() - interval '20 seconds'
  returning d.*;
$$;

-- The machine says how it went.
create function public.finish_dispatch(dispatch uuid, ok boolean, message text) returns setof public.dispatches
language sql volatile security definer set search_path = '' as $$
  update public.dispatches d set
    state = case when ok then 'done' else 'failed' end,
    result = case when ok then message end,
    error = case when ok then null else message end,
    finished_at = now()
  where d.id = finish_dispatch.dispatch
    and d.state = 'claimed'
    and d.machine_id = auth.uid()
  returning d.*;
$$;

-- Whoever can see a request can give up on it while nobody has taken it.
-- Returns the request if it was still waiting.
create function public.give_up_dispatch(dispatch uuid, why text) returns setof public.dispatches
language sql volatile security definer set search_path = '' as $$
  update public.dispatches d set state = 'failed', error = why, finished_at = now()
  where d.id = give_up_dispatch.dispatch
    and d.state = 'pending'
    and public.can_use_project(d.project_id)
  returning d.*;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.claim_dispatch(uuid) to authenticated;
grant execute on function public.finish_dispatch(uuid, boolean, text) to authenticated;
grant execute on function public.give_up_dispatch(uuid, text) to authenticated;
