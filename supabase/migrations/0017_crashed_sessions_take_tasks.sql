-- A session that only crashed (it stopped without saying) can be reopened
-- by Dispatch or a loop, so it can still be given tasks. Only sessions that
-- can't come back (machine taken out, conversation deleted) refuse them.
create or replace function public.check_task_session() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.assignee_session_id is not null and not exists (
    select 1 from public.sessions s where s.id = new.assignee_session_id and s.project_id = new.project_id
  ) then
    raise exception 'tasks can only be sent to sessions in the same Project' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.assignee_session_id is distinct from old.assignee_session_id)
     and exists (
       select 1 from public.sessions s
       where s.id = new.assignee_session_id and s.state = 'gone'
         and coalesce(s.gone_why, '') not like 'it stopped without saying%'
     ) then
    raise exception 'that session is gone, so it can''t be given tasks. Give it to someone else.' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.assignee_session_id is distinct from old.assignee_session_id then
    new.picked_up_at := null;
  end if;
  return new;
end;
$$;

revoke execute on all functions in schema public from public, anon;
