-- Who's who: people, their Tailscale identities, machines, and Projects.
--
-- People and machines are both Supabase Auth users, so the database itself
-- decides what each one can see (row level security). No server in the middle.
-- - A person signs in through a Web Machine, which checks them with Tailscale.
-- - A machine signs in with its API key (a Supabase Auth email and password,
--   packed into one string by `omicron`).

create table public.people (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- One person can have several Tailscale identities (personal and work).
create table public.tailscale_identities (
  login text primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  display_name text not null default '',
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index tailscale_identities_person_idx on public.tailscale_identities (person_id);

create table public.machines (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null unique,
  active boolean not null default true,
  -- true: the machine can use every Project, now and later.
  all_projects boolean not null default false,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, person_id)
);
create index project_members_person_idx on public.project_members (person_id);

-- Adding a machine to a Project is the same as giving it access to that Project.
create table public.project_machines (
  project_id uuid not null references public.projects (id) on delete cascade,
  machine_id uuid not null references public.machines (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, machine_id)
);
create index project_machines_machine_idx on public.project_machines (machine_id);

-- Checks used by the rules below. `security definer` so a rule on one table
-- can look at another without tripping that table's own rules.

-- Is the signed-in person or machine allowed into this Project?
create function public.can_use_project(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members m where m.project_id = p and m.person_id = auth.uid())
      or exists (select 1 from public.machines mc
                 where mc.id = auth.uid() and mc.active
                   and (mc.all_projects
                        or exists (select 1 from public.project_machines pm
                                   where pm.project_id = p and pm.machine_id = mc.id)));
$$;

-- Is the signed-in user a person who's in at least one Project? People who
-- aren't in any Project yet see nothing at all.
create function public.is_active_person() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.project_members m where m.person_id = auth.uid());
$$;

create function public.is_person() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.people p where p.id = auth.uid());
$$;

alter table public.people enable row level security;
alter table public.tailscale_identities enable row level security;
alter table public.machines enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_machines enable row level security;

-- People table: anyone in a Project can see everyone, so they can add people
-- to Projects. Everyone can always see themselves.
create policy "see people" on public.people for select
  using (id = auth.uid() or public.is_active_person());
create policy "rename yourself" on public.people for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy "see tailscale identities" on public.tailscale_identities for select
  using (person_id = auth.uid() or public.is_active_person());

create policy "see machines" on public.machines for select
  using (id = auth.uid() or public.is_active_person());

-- Projects: members can do everything. Any person can start a new Project
-- with start_project(), which also makes them its first member. (A plain
-- insert can't do both: the database checks that you can see the new row
-- before any trigger could add you as a member.)
create policy "see projects" on public.projects for select
  using (public.can_use_project(id));
create policy "change projects" on public.projects for update
  using (public.can_use_project(id));
create policy "delete projects" on public.projects for delete
  using (public.can_use_project(id));

create function public.start_project(name text) returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  project public.projects;
begin
  if not exists (select 1 from public.people where id = auth.uid()) then
    raise exception 'only people can start Projects' using errcode = '42501';
  end if;
  insert into public.projects (name) values (start_project.name) returning * into project;
  insert into public.project_members (project_id, person_id) values (project.id, auth.uid());
  return project;
end;
$$;

-- Every member can add and remove people and machines.
create policy "see members" on public.project_members for select
  using (public.can_use_project(project_id));
create policy "add members" on public.project_members for insert
  with check (public.can_use_project(project_id) and public.is_person());
create policy "remove members" on public.project_members for delete
  using (public.can_use_project(project_id) and public.is_person());

create policy "see project machines" on public.project_machines for select
  using (public.can_use_project(project_id));
create policy "add project machines" on public.project_machines for insert
  with check (public.can_use_project(project_id) and public.is_person());
create policy "remove project machines" on public.project_machines for delete
  using (public.can_use_project(project_id) and public.is_person());

-- Machines report that they're awake.
create function public.machine_check_in() returns void
language sql security definer set search_path = '' as $$
  update public.machines set last_seen = now() where id = auth.uid() and active;
$$;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.machine_check_in() to authenticated;
grant execute on function public.start_project(text) to authenticated;
-- The access rules call these as the signed-in user.
grant execute on function public.can_use_project(uuid), public.is_active_person(), public.is_person() to authenticated;

-- Functions can be called by anyone by default. Only signed-in users should.
revoke execute on all functions in schema public from public, anon;
