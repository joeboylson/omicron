-- No more Project chat. Task comments cover talking about the work, and a
-- chat message that named a session was an order anyone in the Project
-- could give it (see ref/BRAINSTORM.md, "Drop chat").
--
-- Waiting in supabase/pending until every machine runs a build without chat
-- (atlas's Stop hook still reads chat_read_at). Then move it to
-- supabase/migrations/ and push. It deletes the chat messages for good.

drop table if exists public.chat_messages;
alter table public.projects drop column if exists chat_enabled;
alter table public.sessions drop column if exists chat_read_at;
