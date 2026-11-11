-- Each person's settings, saved with them so they follow them between
-- devices. First one: appearance ("system", "light" or "dark"). People
-- change their own (the "rename yourself" rule already lets them update
-- their own row).

alter table public.people add column settings jsonb not null default '{}'::jsonb;
