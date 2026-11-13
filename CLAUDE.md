# Omicron

One tool that replaces my separate dev tools and Trello. It's a task tracker
(Projects, tasks, members) that people and Claude sessions share, plus the
parts I use to run Claude: sessions, handoffs, chat, machines, accounts, and
teams of Claude sessions (rewritten from legion).

- Words: `DEFINITIONS.txt`. Use those names and no others.
- Ideas being talked through: `ref/BRAINSTORM.md`; the Teams plan: `ref/TEAMS.md`.
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
  slag styling). When shadcn has a ready-made component (or a standard
  pattern, like Popover + Command for picking several things), use it rather
  than building one. Two layers:
  - `web/src/components/ui/` is shadcn's files exactly as shadcn ships them.
    Never edit them; `npx shadcn@2.1.8 add <name> --overwrite` in `web/` may
    replace them at any time. Pin new packages' exact versions in
    `package.json` after.
  - `web/src/components/base/` is ours: a component of the same name built
    on the shadcn one, with our changes (phone-sized tap targets, the sheet
    dialog, `focusSheet`). The rest of the app imports a component from
    `base/` when there's one there, otherwise from `ui/`.
  - Every table is `components/DataTable` (shadcn's Data Table, on TanStack
    Table): a page passes it rows and columns; it searches and sorts.
  - Keep the UI plain and straightforward: no subtitles, explanatory notes or
    help text under titles, sections or forms. A label, the thing itself, and
    a warning only where something can't be undone.

  The web page can't create new sessions; the `omicron` command can do
  everything the web page can.
- Old tools (legion, lethe, seraph, janus, board, machine-pick,
  claude-sessions) are references for ideas only. Rewrite, don't copy code in.
  legion, lethe and claude-code-session-manager are in `~/@/1_Projects/tools/`,
  janus is in `~/@/1_Projects/dev/janus`. The source for seraph, board,
  machine-pick and claude-sessions isn't on this Mac any more (only the
  `seraph` program in `~/.local/bin`).

## The hosted Supabase

Omicron's database is a hosted Supabase project, `omicron` (ref
`fofxgxabbatahrjpoxug`, us-west-2, free tier), linked to this GitHub
repository. The real Omicron uses only this one; the tests have their own
on this Mac (see "Running tests").
- Database changes: add a file to `supabase/migrations/` (next number, like
  `0025_what_it_does.sql`), commit and push to `main`. Supabase's GitHub
  integration applies new migrations to the hosted database on every push to
  `main`; don't change the hosted database by hand. Write each migration so
  it works on a fresh Supabase too.
- `supabase/config.toml` only names the project; its settings live in the
  Supabase dashboard.
- Keys: `supabase projects api-keys --project-ref fofxgxabbatahrjpoxug`.
  Omicron uses the anon and service_role keys (atlas has them in
  `~/.omicron/config.json`). Keys never go in git.
- There's no direct database login here (no password on this Mac): anything
  past the rules goes through the service_role key and Supabase's API.
- No backups are kept (Joe's call, 12 Nov 2026).

## Running tests

```sh
bash scripts/test.sh                    # every Rust test
bash scripts/test.sh --test sessions    # one test file (any cargo test arguments)
```

`scripts/test.conf` says where tests run. By default (`local`) it's the
tests' own Supabase on this Mac, in Docker (OrbStack; Colima or Docker
Desktop by setting `OMICRON_TEST_DOCKER`), set up in `dev/test-db` with the
same migrations the hosted one gets. `scripts/test.sh` starts it the first
time it's needed and leaves it running; `bash scripts/test-db.sh
start|stop|reset|status` does it by hand. The whole suite takes under a
minute there. `OMICRON_TEST_DB=hosted` (in the file, or for one run) uses
the hosted Supabase instead, over the internet, which takes minutes.

Either way tests make their own throwaway people, machines and Projects
(logins like name-1234abcd@example.com), never the Omicron Project.
`scripts/test.sh` cleans up after every run, even when tests fail
(`--clean-only <time>` after an interrupted run), and only removes what is
plainly a test's (see `scripts/lib/clean.py`). It also hides this Mac's own
Tailscale login from the tests. Run the whole suite before committing a
change to shared code.

The browser tests (`e2e/`, Playwright 1.62, using the Chromium already in
`~/Library/Caches/ms-playwright`) run the same way: `bash scripts/e2e.sh`
(any Playwright arguments, like `-g "drag"` or `--project a11y`), one test
file at a time, cleaning up after. Each file starts its own `omicron serve`.
`scripts/shots.sh` does the same for screenshots: it fills a page of its own
with made-up data (`dev/seed/`, throwaway logins, a Project called Lumen)
and cleans it up after.

The real Omicron runs on this Mac (atlas): `bash dev/mac.sh` builds,
installs `~/.local/bin/omicron`, and restarts the web page (127.0.0.1:9010,
or the port in `~/.omicron/web-port` on a Mac where 9010 is taken; the work
Mac uses 9030 because its `minio` container holds 9010; on the tailnet admin-only at https://atlas.taileedd95.ts.net:8451 through the
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
- `scripts/test.sh [cargo test args]`: the Rust tests against the hosted
  Supabase, cleaning up after (see "Running tests").
- `scripts/e2e.sh [playwright args]`: the browser tests, the same way.
  Both share `scripts/lib/test-run.sh` (settings and clean-up).
- `scripts/migrate.sh <connection string>`: set up Omicron's tables in a
  Supabase someone hosts themselves (the hosted one gets them from GitHub).

## How to work here

- Keep every file for this project in this folder.
- Run tests on the Mac with `scripts/test.sh` and `scripts/e2e.sh`. The
  browser tests are slow: run them only now and then (before committing a
  big web change, or when asked), not after every change; keep their files
  updated to match either way. Omicron
  itself runs for real on this Mac (`dev/mac.sh`). The old tools keep running
  until each Omicron part replaces them.
- `ref/` is planning notes (the brainstorm, the Teams plan), kept in git.
- Git pushes to my personal GitHub (`joeboylson/omicron`) with my personal key
  and email. This is set in this repo's local git config. Don't change it, and
  don't use the work `gh` login for this repo.
