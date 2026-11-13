-- A session takes its new tasks: the ones its own machine gave it, and,
-- while its computer's gate is open, the ones its machine's owner gave it.
-- Nobody else's, ever (see ref/BRAINSTORM.md, "The gate").
create or replace function public.pick_up_tasks(session uuid, gate_open boolean default false) returns setof public.tasks
language sql volatile set search_path = '' as $$
  update public.tasks t set picked_up_at = now()
  where t.assignee_session_id = pick_up_tasks.session
    and t.picked_up_at is null
    and (t.given_by = auth.uid()
         or (pick_up_tasks.gate_open
             and t.given_by = (select m.owner from public.machines m where m.id = auth.uid())))
    and exists (select 1 from public.sessions se where se.id = pick_up_tasks.session and se.machine_id = auth.uid())
    and not exists (select 1 from public.statuses st where st.id = t.status_id and st.is_done)
  returning t.*;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.pick_up_tasks(uuid, boolean) to authenticated;
