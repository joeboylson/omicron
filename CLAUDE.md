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

No multipass? `bash dev/docker/setup.sh` makes an `omicron-dev` Docker container
with the same paths. Run the same scripts with
`docker exec -u ubuntu omicron-dev bash /home/ubuntu/omicron/dev/...`.
`bash dev/docker/systemd-test.sh` checks `omicron daemon start-at-login`
against a real systemd.

The real Omicron runs on this Mac (atlas), against the real Supabase:
`bash dev/mac.sh` builds, installs `~/.local/bin/omicron`, and restarts the
web page (127.0.0.1:9010, on the tailnet admin-only at
https://atlas.taileedd95.ts.net:8451 through the home lab's gate) and the
daemon, in the tmux sessions `omicron-serve` and `omicron-daemon`. Claude
sessions get Omicron's hooks with `claude --settings
~/.omicron/claude/settings.json`; Claude Code's own settings are left alone.

Two Supabases run in Colima (both inside `omicron-dev`'s reach):
- **Test** (`~/supabase`, API 127.0.0.1:8000, tailnet :8450): tests use it and
  `migrate.sh --reset` wipes it.
- **Real** (`~/supabase-real`, API 127.0.0.1:8100, tailnet :8452): Omicron's
  own data. `dev/supabase/install-real.sh` set it up; apply migrations with
  `OMICRON_SUPABASE_DIR=~/supabase-real bash ~/omicron/dev/supabase/migrate.sh`.
  It can't be reset.

To click around in made-up data, `docker exec -u ubuntu omicron-dev bash
/home/ubuntu/omicron/dev/seed/seed.sh` wipes the test Supabase and fills it
(people, five Projects, machines, Claude sessions, handoff notes, chat); the
dev web page on this Mac (http://127.0.0.1:9011, from `dev/mac.sh`) shows it,
signed in as Joe. Tests run on the same Supabase, so reseed after them.
`dev/seed/shots.js` takes screenshots of it.

The real web page only believes a Tailscale login that comes through the
home lab's gate: the gate adds the secret in `~/.omicron/gate-secret` as the
`Omicron-Gate-Secret` header. To change the secret, update the file and
home_lab's `.env` (`OMICRON_GATE_SECRET`), then `docker compose up -d
omicron-gate` in home_lab.

Errors the web page catches (a crash, a background error, a failed change)
are sent to its Web Machine and logged as `page error [...]` lines: in
`~/.omicron/serve.log` for the real page and `~/.omicron-dev/serve.log` for
the dev page.

## Scripts

Repeated steps, in `scripts/` (run on the Mac):
- `scripts/shots.sh [folder]`: screenshots of the dev web page (seeded
  data), desktop and phone, copied to a folder here.
- `scripts/finish-task.sh <n> "<report>" [images...]`: finish an Omicron
  task like a session does: tick its checklist, post the report with the
  last commit's hash (and screenshots) marked for review, move it to Review.
- `scripts/backup.sh`: copy the real Supabase (database and uploaded files)
  to `~/.omicron/backups`, keeping 21 days; `--install` runs it nightly.
- `scripts/restore.sh <date|latest> --scratch|--real`: put a copy back, into
  a scratch database to check it, or over the real one.

## How to work here

- Keep every file for this project in this folder.
- Run tests in the multipass VM or the `omicron-dev` container. Omicron
  itself runs for real on this Mac (`dev/mac.sh`). The old tools keep running
  until each Omicron part replaces them.
- `ref/` is planning notes and stays out of git.
- Git pushes to my personal GitHub (`joeboylson/omicron`) with my personal key
  and email. This is set in this repo's local git config. Don't change it, and
  don't use the work `gh` login for this repo.
