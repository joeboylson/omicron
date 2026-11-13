-- Who gave a task to its session. A session only works on tasks handed to
-- it on its own computer; ones given from elsewhere (the web page, another
-- machine) are only to read until that computer's gate is open (see
-- ref/BRAINSTORM.md, "The gate"). The gate lives on the computer, so the
-- database only records who gave the task, and the computer decides.

alter table public.tasks add column given_by uuid;

-- Set by the database from the login that gave it, never by the client.
-- Giving it to the same session again (a client writing any given_by)
-- counts as giving it anew: given by whoever did, and new again.
create function public.task_given_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.assignee_session_id is null then
    new.given_by := null;
  elsif tg_op = 'INSERT' or new.assignee_session_id is distinct from old.assignee_session_id then
    new.given_by := auth.uid();
  elsif new.given_by is distinct from old.given_by then
    new.given_by := auth.uid();
    new.picked_up_at := null;
  end if;
  return new;
end;
$$;
create trigger task_given_by before insert or update on public.tasks
  for each row execute function public.task_given_by();

-- A session takes its new tasks. Without the gate open, only the ones its
-- own machine gave it; the others wait, not picked up, so they come in as
-- new once the gate opens.
drop function if exists public.pick_up_tasks(uuid);
create function public.pick_up_tasks(session uuid, gate_open boolean default false) returns setof public.tasks
language sql volatile set search_path = '' as $$
  update public.tasks t set picked_up_at = now()
  where t.assignee_session_id = pick_up_tasks.session
    and t.picked_up_at is null
    and (pick_up_tasks.gate_open or t.given_by = auth.uid())
    and exists (select 1 from public.sessions se where se.id = pick_up_tasks.session and se.machine_id = auth.uid())
    and not exists (select 1 from public.statuses st where st.id = t.status_id and st.is_done)
  returning t.*;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.pick_up_tasks(uuid, boolean) to authenticated;
