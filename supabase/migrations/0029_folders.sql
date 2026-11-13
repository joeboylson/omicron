-- Folders: one path, on one machine, for one Project. Claude sessions are
-- started in them. A folder is added only from the computer it's on
-- (`omicron folders add` there, or `omicron open` remembering where it ran),
-- so only a machine adds its own. Everyone in the Project sees them; the
-- web page lists them but can't add them (see ref/BRAINSTORM.md, "Two parts").

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null default auth.uid() references public.machines (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  path text not null check (length(trim(path)) > 0),
  created_at timestamptz not null default now(),
  -- A path is one Project's on its machine.
  unique (machine_id, path)
);
create index folders_project_idx on public.folders (project_id);

alter table public.folders enable row level security;
create policy "see folders" on public.folders for select
  using (public.can_use_project(project_id));
create policy "machines add their folders" on public.folders for insert
  with check (machine_id = auth.uid() and public.machine_can_use(auth.uid(), project_id));
create policy "machines change their folders" on public.folders for update
  using (machine_id = auth.uid())
  with check (machine_id = auth.uid() and public.machine_can_use(auth.uid(), project_id));
-- Taking a folder off the list makes no computer do anything: its machine,
-- or anyone in the Project, can.
create policy "remove folders" on public.folders for delete
  using (machine_id = auth.uid() or (public.is_person() and public.can_use_project(project_id)));
grant select, insert, update, delete on public.folders to authenticated;

create trigger record_change after insert or update or delete on public.folders
  for each row execute function public.record_change();

-- A machine taken out of a Project loses its folders there.
create function public.machine_folders_gone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  machine uuid;
begin
  if tg_table_name = 'machines' then
    machine := old.id;
  else
    machine := old.machine_id;
  end if;
  delete from public.folders f
  where f.machine_id = machine and not public.machine_can_use(machine, f.project_id);
  return null;
end;
$$;
create trigger machine_folders_gone after delete on public.project_machines
  for each row execute function public.machine_folders_gone();
create trigger machine_folders_gone after update of all_projects on public.machines
  for each row execute function public.machine_folders_gone();

revoke execute on all functions in schema public from public, anon;
