-- What a loop's session does in each case (#261): if it has a question,
-- needs more information, finishes something, needs a person, or runs
-- out of work. Each is optional text; a case left out uses Omicron's own
-- default, which the machine running the loop puts in each message.
-- Drafts and templates keep them too.

alter table public.loops add column rules jsonb not null default '{}'::jsonb
  check (jsonb_typeof(rules) = 'object');
alter table public.loop_plans add column rules jsonb not null default '{}'::jsonb
  check (jsonb_typeof(rules) = 'object');
