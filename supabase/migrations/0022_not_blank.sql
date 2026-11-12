-- Names, titles and texts need something to see. The first rules used
-- trim(), which only takes off spaces, so a title of just line breaks or
-- tabs got through; and Projects, people and machines had no rule at all.
-- Now each needs at least one character that isn't white space.

alter table public.chat_messages drop constraint chat_messages_body_check,
  add constraint chat_messages_body_check check (body ~ '[^[:space:]]');
alter table public.checklist_items drop constraint checklist_items_text_check,
  add constraint checklist_items_text_check check (text ~ '[^[:space:]]');
alter table public.comments drop constraint comments_body_or_images,
  add constraint comments_body_or_images check (body ~ '[^[:space:]]' or cardinality(images) > 0);
alter table public.handoffs drop constraint handoffs_body_check,
  add constraint handoffs_body_check check (body ~ '[^[:space:]]');
alter table public.jobs drop constraint jobs_title_check,
  add constraint jobs_title_check check (title ~ '[^[:space:]]');
alter table public.labels drop constraint labels_name_check,
  add constraint labels_name_check check (name ~ '[^[:space:]]');
alter table public.loops drop constraint loops_prompt_check,
  add constraint loops_prompt_check check (prompt ~ '[^[:space:]]');
alter table public.sessions drop constraint sessions_name_check,
  add constraint sessions_name_check check (name ~ '[^[:space:]]');
alter table public.statuses drop constraint statuses_name_check,
  add constraint statuses_name_check check (name ~ '[^[:space:]]');
alter table public.tasks drop constraint tasks_title_check,
  add constraint tasks_title_check check (title ~ '[^[:space:]]');
alter table public.teams drop constraint teams_folder_check,
  add constraint teams_folder_check check (folder ~ '[^[:space:]]');
alter table public.teams drop constraint teams_name_check,
  add constraint teams_name_check check (name ~ '[^[:space:]]');
alter table public.topics drop constraint topics_name_check,
  add constraint topics_name_check check (name ~ '[^[:space:]]');

alter table public.projects add constraint projects_name_check check (name ~ '[^[:space:]]');
alter table public.people add constraint people_display_name_check check (display_name ~ '[^[:space:]]');
alter table public.machines add constraint machines_name_check check (name ~ '[^[:space:]]');
