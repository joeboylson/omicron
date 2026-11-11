-- Gone sessions, and why. A session is gone when:
--   - it stopped without saying (a crash, a restart), found later by its machine
--   - its conversation was deleted (Claude Code's transcript), found by its machine
--   - its machine was taken out of the Project, or switched off (here)
-- A gone session can't be given new tasks; its tasks can be given to
-- someone else. A gone session that starts again (its machine back in the
-- Project, `claude --resume`) is open again.

alter table public.sessions add column gone_why text;

-- The reason only belongs to a gone session.
create function public.clear_gone_why() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.state <> 'gone' then
    new.gone_why := null;
  end if;
  return new;
end;
$$;
create trigger clear_gone_why before insert or update on public.sessions
  for each row execute function public.clear_gone_why();

-- Can this machine still use this Project?
create function public.machine_can_use(machine uuid, project uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.machines m
    where m.id = machine and m.active
      and (m.all_projects or exists (
        select 1 from public.project_machines pm where pm.machine_id = m.id and pm.project_id = project))
  );
$$;

create function public.machine_sessions_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  machine uuid;
begin
  -- Separate branches: plpgsql would look up both fields in one expression.
  if tg_table_name = 'machines' then
    machine := old.id;
  else
    machine := old.machine_id;
  end if;
  update public.sessions s set
    state = 'gone',
    gone_why = case
      when exists (select 1 from public.machines m where m.id = machine and not m.active) then 'its machine was switched off'
      else 'its machine was taken out of the Project'
    end
  where s.machine_id = machine
    and s.state <> 'gone'
    and not public.machine_can_use(machine, s.project_id);
  return null;
end;
$$;
create trigger machine_sessions_gone after delete on public.project_machines
  for each row execute function public.machine_sessions_gone();
create trigger machine_sessions_gone after update of active, all_projects on public.machines
  for each row execute function public.machine_sessions_gone();

-- No new tasks for a gone session.
create or replace function public.check_task_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.assignee_session_id and s.project_id = new.project_id
  ) then
    raise exception 'tasks can only be sent to sessions in the same Project' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.assignee_session_id is distinct from old.assignee_session_id)
     and exists (select 1 from public.sessions s where s.id = new.assignee_session_id and s.state = 'gone') then
    raise exception 'that session is gone, so it can''t be given tasks. Give it to someone else.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.assignee_session_id is distinct from old.assignee_session_id then
    new.picked_up_at := null;
  end if;
  return new;
end;
$$;

revoke execute on all functions in schema public from public, anon;
