-- Handoff notes: a Claude session writes down where it stopped, and the
-- next conversation in the same window (after /clear) starts with it.
-- Rewritten from lethe.
--
-- A note is waiting until it's picked up. A newer note from the same session
-- replaces the waiting one, and closing the window cancels it. Any note can
-- still be read and picked up by hand later (`omicron handoff show`).

create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  number integer not null default 0,
  session_id uuid references public.sessions (id) on delete set null,
  machine_id uuid not null default auth.uid() references public.machines (id) on delete cascade,
  body text not null check (length(trim(body)) > 0),
  state text not null default 'waiting' check (state in ('waiting', 'picked_up', 'replaced', 'cancelled')),
  written_at timestamptz not null default now(),
  picked_up_at timestamptz,
  unique (project_id, number)
);
create index handoffs_session_idx on public.handoffs (session_id, written_at);

create function public.number_handoff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Numbered per Project. Locking the Project's row makes two notes written
  -- at once take turns, without changing the Project (which would add a
  -- line to the change list).
  perform 1 from public.projects where id = new.project_id for update;
  select coalesce(max(h.number), 0) + 1 into new.number from public.handoffs h where h.project_id = new.project_id;
  if new.session_id is not null and not exists (
    select 1 from public.sessions s
    where s.id = new.session_id and s.project_id = new.project_id and s.machine_id = auth.uid()
  ) then
    raise exception 'a handoff note can only come from a session of its own machine in the same Project' using errcode = '23514';
  end if;
  -- One waiting note per session: the new one replaces the old.
  if new.session_id is not null then
    update public.handoffs set state = 'replaced'
    where session_id = new.session_id and state = 'waiting';
  end if;
  return new;
end;
$$;
create trigger number_handoff before insert on public.handoffs
  for each row execute function public.number_handoff();

-- The time a note was picked up, by the database's clock.
create function public.stamp_handoff() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.state = 'picked_up' and old.state is distinct from 'picked_up' then
    new.picked_up_at := now();
  end if;
  return new;
end;
$$;
create trigger stamp_handoff before update of state on public.handoffs
  for each row execute function public.stamp_handoff();

alter table public.handoffs enable row level security;
create policy "see handoffs" on public.handoffs for select using (public.can_use_project(project_id));
create policy "machines write handoffs" on public.handoffs for insert
  with check (machine_id = auth.uid() and public.can_use_project(project_id));
-- Anyone in the Project can pick a note up (or cancel it), from any session.
create policy "change handoffs" on public.handoffs for update
  using (public.can_use_project(project_id))
  with check (public.can_use_project(project_id));
grant select, insert, update on public.handoffs to authenticated;

create trigger record_change after insert or update or delete on public.handoffs
  for each row execute function public.record_change();

revoke execute on all functions in schema public from public, anon;
