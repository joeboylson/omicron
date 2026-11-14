-- Which comment answered a team's question, and when it was passed on, so
-- the page can mark it ("passed on to builder-2") apart from comments still
-- held for the gate.
alter table public.team_requests
  add column if not exists answer_comment_id uuid references public.comments (id) on delete set null,
  add column if not exists answered_at timestamptz;
