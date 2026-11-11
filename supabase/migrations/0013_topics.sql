-- Topics: a second way to group a Project's tasks, next to statuses. The
-- board can show one row per topic (like "Joe's to-do" and "Claire's
-- to-do"), each with the status columns. A task has at most one topic.
-- Removing a topic leaves its tasks without one.

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  -- New topics go last.
  position double precision not null default extract(epoch from clock_timestamp()),
  unique (project_id, name)
);

alter table public.tasks add column topic_id uuid references public.topics (id) on delete set null;
create index tasks_topic_idx on public.tasks (topic_id) where topic_id is not null;

create function public.check_task_topic() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.topic_id is not null and not exists (
    select 1 from public.topics t where t.id = new.topic_id and t.project_id = new.project_id
  ) then
    raise exception 'that topic belongs to another Project' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_task_topic before insert or update of topic_id on public.tasks
  for each row execute function public.check_task_topic();

alter table public.topics enable row level security;
create policy "members" on public.topics for all
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
grant select, insert, update, delete on public.topics to authenticated;
create trigger record_change after insert or update or delete on public.topics
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
