-- Dispatch: give a task to a Claude session.
--
-- A task is given to a person or to a Claude session, not both. A session
-- isn't told by typing into it: it pulls its new tasks itself (Claude Code
-- hooks, at the start of a conversation and at the end of each turn), and
-- marks each one picked up so it's handed over only once. Sending a task
-- to a session again (or to another one) makes it new again.

alter table public.tasks
  add column assignee_session_id uuid references public.sessions (id) on delete set null,
  add column picked_up_at timestamptz,
  add constraint tasks_one_assignee check (assignee_person_id is null or assignee_session_id is null);
create index tasks_session_idx on public.tasks (assignee_session_id) where assignee_session_id is not null;

create function public.check_task_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.assignee_session_id and s.project_id = new.project_id
  ) then
    raise exception 'tasks can only be sent to sessions in the same Project' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.assignee_session_id is distinct from old.assignee_session_id then
    new.picked_up_at := null;
  end if;
  return new;
end;
$$;
create trigger check_task_session before insert or update of assignee_session_id on public.tasks
  for each row execute function public.check_task_session();

-- A session takes its new tasks: marks them picked up and returns them, in
-- one step, so two hooks at once can't both hand the same task over. Only
-- the session's own machine can, and finished tasks are left alone.
create function public.pick_up_tasks(session uuid) returns setof public.tasks
language sql volatile set search_path = '' as $$
  update public.tasks t set picked_up_at = now()
  where t.assignee_session_id = pick_up_tasks.session
    and t.picked_up_at is null
    and exists (select 1 from public.sessions se where se.id = pick_up_tasks.session and se.machine_id = auth.uid())
    and not exists (select 1 from public.statuses st where st.id = t.status_id and st.is_done)
  returning t.*;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.pick_up_tasks(uuid) to authenticated;
