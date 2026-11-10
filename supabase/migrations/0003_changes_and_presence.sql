-- Two things that make Omicron fully event-driven.
--
-- 1. A change list. Every change to a watched table also adds one numbered
--    line here, written by the database itself. Nothing ever edits or deletes
--    these lines. A machine that was off reads the lines it missed, then
--    follows new ones live. It's also the history of who changed what, when.
--
-- 2. Who's awake. Machines join one shared live channel and Supabase keeps
--    the list of who's connected (Realtime "presence"). A machine shows up the
--    moment it connects and drops off the moment it disconnects, so there's no
--    check-in timer. The channel is private: only members and active machines
--    can join it.

create table public.changes (
  seq bigint generated always as identity primary key,
  at timestamptz not null default now(),
  table_name text not null,
  kind text not null check (kind in ('INSERT', 'UPDATE', 'DELETE')),
  -- The Project the change belongs to, if any.
  project_id uuid,
  -- The person or machine the change is about (a member added, a machine
  -- switched off). They can always see it, even after losing access to the
  -- Project, so they find out they were removed.
  subject_id uuid,
  -- Who made the change (null when it was made with the secret key).
  actor_id uuid default auth.uid(),
  record jsonb,
  old_record jsonb
);
create index changes_project_idx on public.changes (project_id, seq);
create index changes_subject_idx on public.changes (subject_id, seq);

alter table public.changes enable row level security;
create policy "see changes" on public.changes for select using (
  subject_id = auth.uid()
  or (project_id is not null and public.can_use_project(project_id))
  or (project_id is null and public.is_active_person())
);
-- Signed-in users can read (the rule above filters it); only the trigger below writes.
grant select on public.changes to authenticated;
revoke insert, update, delete on public.changes from authenticated, anon;

create function public.record_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  row_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  r jsonb := coalesce(row_new, row_old);
  project uuid;
  subject uuid;
begin
  case tg_table_name
    when 'projects' then project := (r ->> 'id')::uuid; subject := null;
    when 'project_members' then project := (r ->> 'project_id')::uuid; subject := (r ->> 'person_id')::uuid;
    when 'project_machines' then project := (r ->> 'project_id')::uuid; subject := (r ->> 'machine_id')::uuid;
    when 'machines' then project := null; subject := (r ->> 'id')::uuid;
    else project := (r ->> 'project_id')::uuid; subject := null;
  end case;
  -- A machine's check-in time isn't worth a line.
  if tg_table_name = 'machines' and tg_op = 'UPDATE'
     and (row_new - 'last_seen') = (row_old - 'last_seen') then
    return null;
  end if;
  insert into public.changes (table_name, kind, project_id, subject_id, record, old_record)
  values (tg_table_name, tg_op, project, subject, row_new, row_old);
  return null;
end;
$$;

create trigger record_change after insert or update or delete on public.projects
  for each row execute function public.record_change();
create trigger record_change after insert or update or delete on public.project_members
  for each row execute function public.record_change();
create trigger record_change after insert or update or delete on public.project_machines
  for each row execute function public.record_change();
create trigger record_change after insert or update or delete on public.machines
  for each row execute function public.record_change();

-- Listeners follow the change list instead of each table.
alter publication supabase_realtime drop table
  public.projects, public.project_members, public.project_machines, public.machines;
alter publication supabase_realtime add table public.changes;

-- Who can join the shared live channel, and announce themselves on it.
create function public.can_join_channel() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_person()
      or exists (select 1 from public.machines m where m.id = auth.uid() and m.active);
$$;
grant execute on function public.can_join_channel() to authenticated;

create policy "omicron channel: listen" on realtime.messages for select to authenticated
  using (realtime.topic() = 'omicron' and public.can_join_channel());
create policy "omicron channel: announce" on realtime.messages for insert to authenticated
  with check (realtime.topic() = 'omicron' and extension = 'presence' and public.can_join_channel());
