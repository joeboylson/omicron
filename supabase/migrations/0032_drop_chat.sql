-- No more Project chat. Task comments cover talking about the work, and a
-- chat message that named a session was an order anyone in the Project
-- could give it (see ref/BRAINSTORM.md, "Drop chat").
--
-- It deletes the chat messages for good (Joe, 13 Nov: nothing important in
-- them). Every machine runs a build without chat by now.

drop table if exists public.chat_messages;
alter table public.projects drop column if exists chat_enabled;
alter table public.sessions drop column if exists chat_read_at;
