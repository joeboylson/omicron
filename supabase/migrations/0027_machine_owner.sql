-- Every machine has an owner: the person who made its key. Only the owner
-- can send it orders (dispatches, loops), and only while its gate is open;
-- the machine's own orders always go through (see ref/BRAINSTORM.md, "The
-- gate"). The machine itself checks, so this only records who the owner is.
--
-- People can't change it (machines have no update rule for people). It's
-- set when the key is made, or by the machine itself with
-- `omicron machines owner`. Machines made before this have no owner, and
-- take orders only from themselves until one is set.

alter table public.machines add column owner uuid references public.people (id) on delete set null;

-- A machine names its owner by one of their Tailscale logins (machines
-- can't see the people table). Returns the owner's name.
create function public.set_machine_owner(login text) returns text
language plpgsql security definer set search_path = '' as $$
declare
  who uuid;
  name text;
begin
  select p.id, p.display_name into who, name
  from public.tailscale_identities t join public.people p on p.id = t.person_id
  where t.login = set_machine_owner.login;
  if who is null then
    raise exception 'nobody has signed in to Omicron as %', set_machine_owner.login using errcode = 'P0002';
  end if;
  update public.machines set owner = who where id = auth.uid() and active;
  if not found then
    raise exception 'only a machine can set its own owner' using errcode = '42501';
  end if;
  return name;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.set_machine_owner(text) to authenticated;
