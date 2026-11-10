-- Tasks: the Trello part.
--
-- Each Project has its own statuses (columns), with exactly one marked as its
-- Done status, and its own labels. A task has a title, notes, a status, a
-- date (when it'll get done), who it's given to, labels, and a checklist.
-- "Needs review" is a mark on a task, not a status: only a machine (a Claude
-- session) can put it on, and anyone can take it off ("Reviewed").
--
-- Every table here carries its project_id, so the access rules and the change
-- list work the same way for all of them.

create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  position double precision not null default 0,
  is_done boolean not null default false,
  unique (project_id, name)
);
create unique index statuses_one_done on public.statuses (project_id) where is_done;

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  color text,
  unique (project_id, name)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Short number within the Project, like #12, for typing in the terminal.
  number integer not null default 0,
  title text not null check (length(trim(title)) > 0),
  notes text not null default '',
  -- Checked at the end of each statement (not `restrict`), so deleting a
  -- whole Project can remove its tasks and statuses together.
  status_id uuid not null references public.statuses (id),
  due_on date,
  assignee_person_id uuid references public.people (id) on delete set null,
  position double precision not null default 0,
  needs_review boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_project_idx on public.tasks (project_id, status_id, position);
create unique index tasks_number on public.tasks (project_id, number);

-- Hands out task numbers one at a time per Project, even when two tasks are
-- added at once.
alter table public.projects add column next_task_number integer not null default 1;

create function public.number_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.projects set next_task_number = next_task_number + 1
  where id = new.project_id
  returning next_task_number - 1 into new.number;
  return new;
end;
$$;
create trigger number_task before insert on public.tasks
  for each row execute function public.number_task();

create table public.task_labels (
  task_id uuid not null references public.tasks (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  project_id uuid not null,
  primary key (task_id, label_id)
);

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  project_id uuid not null,
  text text not null check (length(trim(text)) > 0),
  done boolean not null default false,
  position double precision not null default 0
);
create index checklist_items_task_idx on public.checklist_items (task_id, position);

-- New Projects start with the two statuses our family Trello uses.
create function public.add_default_statuses() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.statuses (project_id, name, position, is_done)
  values (new.id, 'To do', 0, false), (new.id, 'Done', 1, true);
  return new;
end;
$$;
create trigger add_default_statuses after insert on public.projects
  for each row execute function public.add_default_statuses();

-- Keep everything inside one Project: a task's status and assignee, and a
-- label or checklist item's task, must all belong to the same Project. Child
-- rows copy their project_id from their task.
create function public.check_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.statuses s where s.id = new.status_id and s.project_id = new.project_id) then
    raise exception 'that status belongs to another Project' using errcode = '23514';
  end if;
  if new.assignee_person_id is not null and not exists (
    select 1 from public.project_members m where m.project_id = new.project_id and m.person_id = new.assignee_person_id
  ) then
    raise exception 'tasks can only be given to members of the Project' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if new.project_id <> old.project_id then
      raise exception 'tasks can''t move to another Project' using errcode = '23514';
    end if;
    -- Only machines (Claude sessions) put the Needs review mark on.
    if new.needs_review and not old.needs_review
       and not exists (select 1 from public.machines m where m.id = auth.uid()) then
      raise exception 'only a Claude session can mark a task as needing review' using errcode = '42501';
    end if;
    new.updated_at := now();
  elsif new.needs_review and not exists (select 1 from public.machines m where m.id = auth.uid()) then
    raise exception 'only a Claude session can mark a task as needing review' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger check_task before insert or update on public.tasks
  for each row execute function public.check_task();

create function public.copy_task_project() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select t.project_id into new.project_id from public.tasks t where t.id = new.task_id;
  if new.project_id is null then
    raise exception 'no such task' using errcode = '23503';
  end if;
  -- Nested, not `and`: checklist rows have no label_id, and plpgsql would
  -- still look it up.
  if tg_table_name = 'task_labels' then
    if not exists (select 1 from public.labels l where l.id = new.label_id and l.project_id = new.project_id) then
      raise exception 'that label belongs to another Project' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger copy_task_project before insert or update on public.task_labels
  for each row execute function public.copy_task_project();
create trigger copy_task_project before insert or update on public.checklist_items
  for each row execute function public.copy_task_project();

-- Only one Done status per Project: marking a new one moves the mark.
create function public.move_done_mark() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_done then
    update public.statuses set is_done = false
    where project_id = new.project_id and is_done and id <> new.id;
  end if;
  return new;
end;
$$;
create trigger move_done_mark before insert or update of is_done on public.statuses
  for each row when (new.is_done) execute function public.move_done_mark();

-- Members (and the Project's machines) can do everything inside it.
do $$
declare t text;
begin
  foreach t in array array['statuses', 'labels', 'tasks', 'task_labels', 'checklist_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members" on public.%I for all using (public.can_use_project(project_id)) with check (public.can_use_project(project_id))', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create trigger record_change after insert or update or delete on public.%I for each row execute function public.record_change()', t);
  end loop;
end;
$$;

-- Statuses with tasks in them can't be deleted (move the tasks first), and
-- a Project always keeps its Done status.
create function public.keep_done_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.is_done and exists (select 1 from public.projects p where p.id = old.project_id) then
    raise exception 'a Project needs a Done status. Mark another status as Done first.' using errcode = '23514';
  end if;
  return old;
end;
$$;
create trigger keep_done_status before delete on public.statuses
  for each row execute function public.keep_done_status();

revoke execute on all functions in schema public from public, anon;
