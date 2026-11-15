-- "Run now" (#260): a command loop started with a first run time given
-- runs straight away instead of after one interval. Without one (the
-- default is now none), it waits one interval, as before.

alter table public.loops alter column next_run_at drop default;

create or replace function public.fill_loop() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.sessions;
begin
  select * into s from public.sessions where id = new.session_id;
  if s.id is null then
    raise exception 'there''s no such session' using errcode = '23503';
  end if;
  new.project_id := s.project_id;
  new.machine_id := s.machine_id;
  new.started_by := auth.uid();
  new.started_at := now();
  new.updated_at := now();
  new.state := 'running';
  new.runs := 0;
  new.done := 0;
  new.task_id := null;
  new.note := null;
  new.last_run_at := null;
  new.ended_at := null;
  if new.kind = 'command' then
    -- The first run comes after one interval, or straight away when the
    -- loop is started with a first run time given ("Run now", #260).
    new.next_run_at := case
      when new.next_run_at is not null then now()
      else now() + make_interval(secs => new.every_seconds)
    end;
    new.label_id := null;
    new.task_ids := null;
  else
    new.next_run_at := null;
    new.prompt := null;
    new.every_seconds := null;
    new.times := null;
    new.until := null;
  end if;
  if new.until is not null and new.until <= now() then
    raise exception 'the end time has already passed' using errcode = '23514';
  end if;
  return new;
end;
$$;
