-- Unread replaces Needs review (#280). A task is Unread when the newest
-- word on it is a session's: a comment from a machine (a Claude session)
-- marks it Unread; a person commenting, or a person moving it, reads it;
-- anyone in the Project can Mark as Read. Kept in the needs_review column,
-- so older copies of Omicron (and `--review`) keep working.

create function public.comment_marks_unread() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.tasks set needs_review = not public.is_person()
  where id = new.task_id and needs_review is distinct from (not public.is_person());
  return null;
end;
$$;
create trigger comment_marks_unread after insert on public.comments
  for each row execute function public.comment_marks_unread();

create function public.move_reads_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status_id is distinct from old.status_id and public.is_person() then
    new.needs_review := false;
  end if;
  return new;
end;
$$;
create trigger move_reads_task before update on public.tasks
  for each row execute function public.move_reads_task();

revoke execute on all functions in schema public from public, anon;
