-- Run rules: a Project's note on how its Claude sessions work (test,
-- screenshots, commit, push, report, ask in Waiting on Joe), given to a
-- session with every task it's handed (see ref/BRAINSTORM.md, "Runs").
-- Members change it in Project settings, like the Project's name.

alter table public.projects add column run_rules text not null default ''
  check (length(run_rules) <= 20000);
