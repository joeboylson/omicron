-- A session exists only while it runs. When it ends (its Claude quits, it
-- crashes, its machine leaves the Project) its record is deleted; the
-- changes table keeps the line saying so, as the activity log. Its tasks
-- stay, with the name of the session they were given to, shown as a flag
-- until they're given to someone else.

alter table public.tasks add column ended_session text;

-- Before a session's record goes: flag its tasks (the reference itself is
-- cleared by the foreign key).
create function public.session_ended() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.tasks set ended_session = old.name where assignee_session_id = old.id;
  return old;
end;
$$;
create trigger session_ended before delete on public.sessions
  for each row execute function public.session_ended();

-- Given to someone (a person or a session): no longer flagged.
create function public.clear_ended_session() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.assignee_person_id is not null or new.assignee_session_id is not null then
    new.ended_session := null;
  end if;
  return new;
end;
$$;
create trigger clear_ended_session before update of assignee_person_id, assignee_session_id on public.tasks
  for each row execute function public.clear_ended_session();

-- A machine taken out of the Project, or switched off: its sessions there end.
create or replace function public.machine_sessions_gone() returns trigger
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
  delete from public.sessions s
  where s.machine_id = machine and not public.machine_can_use(machine, s.project_id);
  return null;
end;
$$;

-- Tasks go only to sessions in the same Project (every session runs now).
create or replace function public.check_task_session() returns trigger
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

-- Sessions that aren't running any more end now.
delete from public.sessions where state <> 'open';

revoke execute on all functions in schema public from public, anon;
