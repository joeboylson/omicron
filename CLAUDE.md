# Omicron

One tool that replaces my separate dev tools and Trello. It's a task tracker
(Projects, tasks, members) that people and Claude sessions share, plus the
parts I use to run Claude: sessions, handoffs, chat, machines, accounts, and
teams of Claude sessions (rewritten from legion).

- Words: `DEFINITIONS.txt`. Use those names and no others.
- Decisions and reasons: `ref/BRAINSTORM.md` (not in git).
- Work list: `TODO.md`.

## What it is

- **No central server.** Every computer runs its own copy of Omicron and talks
  straight to one shared Supabase database. Anyone can set it up against their
  own Supabase.
- **Event-driven.** Every change adds a line to the `changes` table (written
  by the database itself). Machines catch up on lines they missed, then follow
  new ones live through Supabase Realtime. Who's awake comes from Realtime's
  list of connected machines. Don't check the database on a timer, and make
  anything that reacts to a change safe to run twice.
- **The database is the source of truth**, including logins.
- **People** sign in with their Tailscale identity. **Machines** use an API key,
  one per machine. API keys are never for people.
- **Claude sessions** belong to one machine and one Project, and use their
  machine's key through `omicron` commands.
- **Web Machine**: any machine that also shows the web page. Optional, any
  number of them, and no other machine relies on one.
- **Teams** (legion) keep most of their data on the machine running them. Only
  teams, jobs and their status, and workers go to Supabase.

## How it's built

- **One Rust program** is both the `omicron` command and the background program.
- **The web page** is TypeScript and React with plain shadcn components (no
  slag styling). It can't create new sessions; the `omicron` command can do
  everything the web page can.
- Old tools (legion, lethe, seraph, janus, board, machine-pick,
  claude-sessions) are references for ideas only. Rewrite, don't copy code in.
  They live in `~/@/1_Projects/agent_orchestration/` and `~/@/1_Projects/infra/`.

## Running tests

Everything runs in the `omicron-dev` multipass VM, which has this folder
mounted at `~/omicron` and a self-hosted Supabase at `~/supabase`.

```sh
multipass exec omicron-dev -- bash /home/ubuntu/omicron/dev/supabase/migrate.sh   # apply new migrations (--reset to start over)
multipass exec omicron-dev -- bash /home/ubuntu/omicron/dev/supabase/test.sh      # every Rust test, including the Supabase ones
multipass exec omicron-dev -- bash /home/ubuntu/omicron/dev/e2e.sh                # browser tests (Playwright) against the real `omicron serve`
```

New VM: `dev/vm/setup.sh`, then `dev/supabase/install.sh`.

## How to work here

- Keep every file for this project in this folder.
- Run and test things in a multipass VM (or a Docker container), never against
  the tools installed on this Mac. The old tools keep running until each
  Omicron part replaces them.
- `ref/` is planning notes and stays out of git.
- Git pushes to my personal GitHub (`joeboylson/omicron`) with my personal key
  and email. This is set in this repo's local git config. Don't change it, and
  don't use the work `gh` login for this repo.
