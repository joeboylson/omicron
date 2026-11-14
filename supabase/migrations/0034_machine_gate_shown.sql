-- Each machine's gate, as it last said, so a page can show it (the run bar,
-- Start a run). Display only: the machine itself still decides, from its
-- own file. Null, or a time that has passed, means closed.
alter table public.machines add column if not exists gate_until timestamptz;

create or replace function public.machine_report_gate(until timestamptz) returns void
language sql security definer set search_path = '' as $$
  update public.machines set gate_until = until where id = auth.uid();
$$;

revoke execute on function public.machine_report_gate(timestamptz) from public, anon;
grant execute on function public.machine_report_gate(timestamptz) to authenticated;
