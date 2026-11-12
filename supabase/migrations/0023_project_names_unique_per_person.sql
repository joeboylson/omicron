-- Projects are found by name (`omicron tasks add Home ...`), so nobody may
-- be in two Projects with the same name (any case): starting one, or
-- renaming one, is refused when it would be.

create function public.check_project_name() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if exists (
      select 1 from public.projects p
      join public.project_members m on m.project_id = p.id
      where m.person_id = auth.uid() and lower(trim(p.name)) = lower(trim(new.name))
    ) then
      raise exception 'you already have a Project called %', trim(new.name) using errcode = '23514';
    end if;
  elsif lower(trim(new.name)) <> lower(trim(old.name)) then
    if exists (
      select 1 from public.projects p
      join public.project_members m on m.project_id = p.id
      join public.project_members mine on mine.person_id = m.person_id and mine.project_id = new.id
      where p.id <> new.id and lower(trim(p.name)) = lower(trim(new.name))
    ) then
      raise exception 'someone in this Project is already in another one called %', trim(new.name) using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create trigger check_project_name before insert or update of name on public.projects
  for each row execute function public.check_project_name();
