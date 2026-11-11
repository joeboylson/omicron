-- Which Claude account each machine is using, and how much of each saved
-- account's limits is used, for the web page. Names, percentages and reset
-- times only: logins never leave the machine. Each machine sets its own.

alter table public.machines add column claude_accounts jsonb;

create function public.report_claude_accounts(info jsonb) returns void
language sql security definer set search_path = '' as $$
  update public.machines set claude_accounts = info
  where id = auth.uid() and active and claude_accounts is distinct from info;
$$;
revoke execute on all functions in schema public from public, anon;
grant execute on function public.report_claude_accounts(jsonb) to authenticated;
