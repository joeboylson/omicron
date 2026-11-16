-- Conversations (#281): a group chat in a Project, with Claude sessions
-- and pinned tasks. Every person in the Project can read and post. A
-- session takes part when its loop watches the conversation (a loop watch
-- with conversation_id); each `omicron loop check` gives it the messages
-- since its last check. Unread, as for tasks (#280): a session spoke last.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  unread boolean not null default false,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, name)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  project_id uuid not null,
  author_id uuid not null default auth.uid(),
  author_name text not null default '',
  -- The person behind it: the author, or the owner of the machine that
  -- wrote it. A session acts only on its own owner's messages.
  author_owner uuid,
  session_id uuid references public.sessions (id) on delete set null,
  body text not null default '' check (length(body) <= 20000),
  images text[] not null default '{}' check (cardinality(images) <= 10),
  created_at timestamptz not null default now(),
  check (length(trim(body)) > 0 or cardinality(images) > 0)
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- Tasks pinned to a conversation.
create table public.conversation_tasks (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (conversation_id, task_id)
);

-- Tasks a message names (#12), so a task can link back to where it was mentioned.
create table public.message_mentions (
  message_id uuid not null references public.messages (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  project_id uuid not null,
  primary key (message_id, task_id)
);
create index message_mentions_task_idx on public.message_mentions (task_id);

alter table public.loop_watches add column conversation_id uuid references public.conversations (id) on delete cascade;

create function public.fill_message() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  p uuid;
begin
  select c.project_id into p from public.conversations c where c.id = new.conversation_id;
  if p is null then
    raise exception 'there''s no such conversation' using errcode = '23503';
  end if;
  new.project_id := p;
  new.author_id := auth.uid();
  select coalesce(
    (select x.display_name from public.people x where x.id = new.author_id),
    (select m.name from public.machines m where m.id = new.author_id),
    ''
  ) into new.author_name;
  new.author_owner := case when public.is_person() then new.author_id
    else (select m.owner from public.machines m where m.id = new.author_id) end;
  if new.session_id is not null and not exists (
    select 1 from public.sessions s
    where s.id = new.session_id and s.project_id = new.project_id and s.machine_id = new.author_id
  ) then
    raise exception 'a message can only name a session of its own machine in the same Project' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(new.images) i where split_part(i, '/', 1) <> new.project_id::text) then
    raise exception 'a message''s images must be filed under its own Project' using errcode = '23514';
  end if;
  new.created_at := now();
  return new;
end;
$$;
create trigger fill_message before insert on public.messages
  for each row execute function public.fill_message();

-- After a message: the conversation's newest activity and Unread, and the
-- tasks it names.
create function public.message_posted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.conversations
  set last_message_at = new.created_at, unread = not public.is_person()
  where id = new.conversation_id;
  insert into public.message_mentions (message_id, task_id, conversation_id, project_id)
  select distinct new.id, t.id, new.conversation_id, new.project_id
  from regexp_matches(new.body, '(?:^|[^&\w])#(\d{1,9})\y', 'g') as m
  join public.tasks t on t.project_id = new.project_id and t.number = m[1]::bigint
  on conflict do nothing;
  return null;
end;
$$;
create trigger message_posted after insert on public.messages
  for each row execute function public.message_posted();

create function public.fill_conversation_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select c.project_id into new.project_id from public.conversations c where c.id = new.conversation_id;
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.project_id = new.project_id) then
    raise exception 'that task belongs to another Project' using errcode = '23514';
  end if;
  new.created_at := now();
  return new;
end;
$$;
create trigger fill_conversation_task before insert on public.conversation_tasks
  for each row execute function public.fill_conversation_task();

-- A conversation watch stays in its loop's Project.
create function public.check_watch_conversation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.conversation_id is not null and not exists (
    select 1 from public.conversations c where c.id = new.conversation_id and c.project_id = new.project_id
  ) then
    raise exception 'that conversation belongs to another Project' using errcode = '23514';
  end if;
  return new;
end;
$$;
-- After fill_loop_watch (name order), which sets project_id.
create trigger loop_watch_conversation before insert or update on public.loop_watches
  for each row execute function public.check_watch_conversation();

alter table public.conversations enable row level security;
create policy "see conversations" on public.conversations for select using (public.can_use_project(project_id));
create policy "start conversations" on public.conversations for insert with check (public.can_use_project(project_id));
create policy "change conversations" on public.conversations for update
  using (public.can_use_project(project_id)) with check (public.can_use_project(project_id));
create policy "remove conversations" on public.conversations for delete using (public.can_use_project(project_id) and public.is_person());
grant select, insert, update, delete on public.conversations to authenticated;

alter table public.messages enable row level security;
create policy "see messages" on public.messages for select using (public.can_use_project(project_id));
create policy "post messages" on public.messages for insert with check (public.can_use_project(project_id));
create policy "remove your messages" on public.messages for delete
  using (author_id = auth.uid() and public.can_use_project(project_id));
grant select, insert, delete on public.messages to authenticated;

alter table public.conversation_tasks enable row level security;
create policy "see pinned tasks" on public.conversation_tasks for select using (public.can_use_project(project_id));
create policy "pin tasks" on public.conversation_tasks for insert with check (public.can_use_project(project_id));
create policy "unpin tasks" on public.conversation_tasks for delete using (public.can_use_project(project_id));
grant select, insert, delete on public.conversation_tasks to authenticated;

alter table public.message_mentions enable row level security;
create policy "see mentions" on public.message_mentions for select using (public.can_use_project(project_id));
grant select on public.message_mentions to authenticated;

create trigger record_change after insert or update or delete on public.conversations
  for each row execute function public.record_change();
create trigger record_change after insert or update or delete on public.messages
  for each row execute function public.record_change();
create trigger record_change after insert or update or delete on public.conversation_tasks
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
