-- Send changes to these tables over Supabase Realtime, so machines and web
-- pages hear about them as they happen instead of asking over and over.
-- Each listener only gets the rows the access rules let them see.
alter publication supabase_realtime add table
  public.projects,
  public.project_members,
  public.project_machines,
  public.machines;
