# Omicron

One tool that replaces my separate dev tools and Trello. It's a task tracker
(Projects, tasks, members) that people and Claude sessions share, plus the
parts I use to run Claude: sessions, handoffs, chat, machines, accounts, and
teams of Claude sessions (rewritten from legion).

- Words: `DEFINITIONS.txt`. Use those names and no others.
- Decisions and reasons: `ref/BRAINSTORM.md`; the Teams plan: `ref/TEAMS.md`.
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
  legion, lethe and claude-code-session-manager are in `~/@/1_Projects/tools/`,
  janus is in `~/@/1_Projects/dev/janus`. The source for seraph, board,
  machine-pick and claude-sessions isn't on this Mac any more (only the
  `seraph` program in `~/.local/bin`); `ref/BRAINSTORM.md` has the notes on them.

## The hosted Supabase

Omicron's database is moving to a hosted Supabase project, `omicron`
(ref `fofxgxabbatahrjpoxug`, us-west-2), linked to this GitHub repository.
- Database changes: add a file to `supabase/migrations/` (next number, like
  `0025_what_it_does.sql`), commit and push to `main`. Supabase's GitHub
  integration applies new migrations to the hosted database on every push to
  `main`; don't change the hosted database by hand. Write each migration so
  it works on a fresh Supabase too.
- `supabase/config.toml` only names the project; its settings live in the
  Supabase dashboard.
- Keys: `supabase projects api-keys --project-ref fofxgxabbatahrjpoxug`.
  Omicron uses the anon and service_role keys. Keys never go in git.
- Copying the existing data across needs the database password (Project
  Settings, Database), kept in `~/.omicron/hosted-db-password`, never in git.
- The local Supabase in Colima stays, for tests only, so tests never touch
  the real data.

## Running tests

One Supabase, Omicron's real one, runs in Colima (Colima has 3 GB and is
shared with the home lab, so keep it lean). Only the parts Omicron uses run:
`omicron-supabase-db`, `-auth`, `-rest`, `-storage`, `-envoy` and
`realtime-dev.omicron-realtime` (start them with `docker start`; studio, edge
functions, imgproxy, meta and the pooler stay off). Its compose folder is
inside the Colima VM at `/home/ubuntu/supabase-real` (`colima ssh`). API
127.0.0.1:8100, tailnet :8452. It can't be reset. Ask the home-lab session
before stopping Colima or any container that isn't Omicron's own.

```sh
bash scripts/test.sh                    # every Rust test, on this Mac
bash scripts/test.sh --test sessions    # one test file (any cargo test arguments)
```

Tests run against the real Supabase in their own throwaway people, machines
and Projects (logins like name-1234abcd@example.com), never the Omicron
Project. `scripts/test.sh` cleans up everything a run made, even when tests
fail (`--clean-only <time>` after an interrupted run). It also hides this
Mac's own Tailscale login from the tests. Two test files act on the real setup
on purpose: `realtime_restart.rs` restarts Omicron's own Realtime container
(the real page's live updates pause a few seconds, then reconnect), and
`backup.rs` makes a backup into a temporary folder and restores it into the
scratch database `omicron_restore`, never over the real one.

Apply a new migration to it with `scripts/migrate.sh` and the database
connection string, or through `docker exec -i omicron-supabase-db psql -U
postgres` (see `dev/supabase/migrate.sh` for how they're recorded).

The browser tests (`e2e/`, Playwright 1.62, using the Chromium already in
`~/Library/Caches/ms-playwright`) run the same way: `bash scripts/e2e.sh`
(any Playwright arguments, like `-g "drag"` or `--project a11y`), one test
file at a time, cleaning up after. Each file starts its own `omicron serve`.
`scripts/shots.sh` does the same for screenshots: it fills a page of its own
with made-up data (`dev/seed/`, throwaway logins, a Project called Lumen)
and cleans it up after.

The real Omicron runs on this Mac (atlas): `bash dev/mac.sh` builds,
installs `~/.local/bin/omicron`, and restarts the web page (127.0.0.1:9010,
on the tailnet admin-only at https://atlas.taileedd95.ts.net:8451 through the
home lab's gate) and the daemon, in the tmux sessions `omicron-serve` and
`omicron-daemon`. Claude sessions get Omicron's hooks with `claude --settings
~/.omicron/claude/settings.json`; Claude Code's own settings are left alone.

The real web page only believes a Tailscale login that comes through the
home lab's gate: the gate adds the secret in `~/.omicron/gate-secret` as the
`Omicron-Gate-Secret` header. To change the secret, update the file and
home_lab's `.env` (`OMICRON_GATE_SECRET`), then `docker compose up -d
omicron-gate` in home_lab.

Errors the web page catches (a crash, a background error, a failed change)
are sent to its Web Machine and logged as `page error [...]` lines: in
`~/.omicron/serve.log` for the real page.

## Scripts

Repeated steps, in `scripts/` (run on the Mac):
- `scripts/shots.sh [folder]`: screenshots of the web page full of made-up
  data, desktop and phone, into a folder (default /tmp/omicron-shots),
  cleaning up after.
- `scripts/finish-task.sh <n> "<report>" [images...]`: finish an Omicron
  task like a session does: tick its checklist, post the report with the
  last commit's hash (and screenshots) marked for review, move it to Review.
- `scripts/test.sh [cargo test args]`: the Rust tests on this Mac against
  the one Supabase, cleaning up after (see "Running tests").
- `scripts/e2e.sh [playwright args]`: the browser tests, the same way.
  Both share `scripts/lib/test-run.sh` (settings and clean-up).
- `scripts/backup.sh`: copy the real Supabase (database and uploaded files)
  to `~/.omicron/backups`, keeping 21 days; `--install` runs it nightly.
- `scripts/restore.sh <date|latest> --scratch|--real`: put a copy back, into
  a scratch database to check it, or over the real one.

## How to work here

- Keep every file for this project in this folder.
- Run tests on the Mac with `scripts/test.sh` and `scripts/e2e.sh`. Omicron
  itself runs for real on this Mac (`dev/mac.sh`). The old tools keep running
  until each Omicron part replaces them.
- `ref/` is planning notes (the brainstorm, the Teams plan), kept in git.
- Git pushes to my personal GitHub (`joeboylson/omicron`) with my personal key
  and email. This is set in this repo's local git config. Don't change it, and
  don't use the work `gh` login for this repo.
