# TODO

Built in this order. Each part replaces an old tool only once it's ready.

## 1. Identity (now)
- [x] Prove the path works: a page in the test VM is reachable over this Mac's
      Tailscale (`tailscale serve`). See `dev/identity-test/README.md`.
- [x] Decided: a localhost visit is the person this machine is signed in to
      Tailscale as. A visit through the machine's Tailscale address is someone
      else, and their identity comes from Tailscale.
- [x] Local identity in code: `crates/omicron/src/identity.rs` and
      `omicron whoami`. 9 tests pass in the VM.
- [ ] Known gap: any program on the hosting machine can send a fake
      `Tailscale-User-Login` header straight to localhost. Fine while only I
      use my machines. Close it later, for example by double-checking the
      login with Tailscale.
- [ ] **Test later:** Tailscale address visits. Open the page from another
      device signed in as a person (not a tagged server, and not the hosting
      machine) and confirm `Tailscale-User-Login` arrives. Then repeat on the
      personal tailnet. Fallback if it fails: a VM or container that joins
      Tailscale on its own.
- [x] A Web Machine turns a Tailscale identity into a Supabase login: people
      and machines are both Supabase Auth users. With the secret key, the Web
      Machine makes a one-time sign-in link and uses it straight away, so
      there's no password or email. (`crates/omicron/src/supa.rs`)
- [x] One person can have several Tailscale identities (personal and work).
- [x] Machine registration: each machine gets its own API key
      (`omk_<machine id>_<secret>`). A machine signs in with only the
      publishable key, never the secret key.
- [x] Access rules in the database, tested: new people see nothing but
      themselves; members see everyone and can add or remove people and
      machines; machines see only their Projects (or all, if set); switched-off
      machines see nothing; machines can't start Projects or add people.
- [x] `omicron` commands for these: `setup`, `machines register` (or
      `--print` a key for another machine), `machines use-key`,
      `machines check-in`, `people link`. Settings in `~/.omicron/config.json`
      (only this user can read it). End-to-end tests in `tests/cli.rs` run the
      real command.
- [x] The Web Machine's sign-in page: `omicron serve` listens on 127.0.0.1,
      refuses any host name that isn't localhost or one given with `--host`,
      and `POST /api/session` hands the visitor a Supabase login. A stand-in
      page signs in and lists the person's Projects straight from Supabase.
      Browser tests in `e2e/` (Playwright, run with `dev/e2e.sh`).

## 2. Base
- [x] Rust workspace in this repo. Web page skeleton still to do.
- [x] Supabase tables: people, Tailscale identities, machines, Projects,
      members (`supabase/migrations/0001_identity.sql`).
- [x] Test setup in multipass: self-hosted Supabase (release v0.8.4) in the
      `omicron-dev` VM. `dev/supabase/install.sh`, `migrate.sh`, `test.sh`.
- [x] Event-driven, with no timers:
      - **Change list** (`changes` table): the database adds a numbered line
        for every change, with who made it and the row before and after.
        Nobody can edit it. People and machines only see lines for their
        Projects, plus lines about themselves (so they learn they were
        removed).
      - **`omicron daemon`** reads the lines it missed while off, then follows
        new ones live. It remembers its place in `~/.omicron/state.json`, so
        each line is printed once, in order, even across restarts.
      - **Who's awake** is Supabase's live list of connected machines on a
        private channel. A machine shows up when its daemon connects and
        drops off when it disconnects. `omicron machines awake` lists them.
      End-to-end tests in `tests/daemon.rs`.
- [x] Out-of-order saves: two changes saved at the same moment can be
      numbered in one order and finish in the other. Each machine remembers
      the last 1,000 lines it handled (not just the highest number), so a
      late one is still handled once, and on startup it rereads every line
      from the last second. Tested by holding a save open in the database.
- [x] The change list keeps 30 days. The database clears older lines itself
      every 100th line, so there's no timer.
- [x] A machine unseen for 30 days is switched off in the same cleanup
      step (it would have missed cleared lines). Its daemon says so and stops;
      `omicron machines switch-on <name>` (secret key) brings it back. A
      running daemon records it's still around each time it renews its login
      (about hourly), so a machine in use never expires.
- [ ] Run `omicron daemon` at login (launchd on macOS, systemd on Linux).

## 3. Projects and tasks (replaces Trello)
- [x] Projects with members, per-Project statuses, and one Done status. New
      Projects start with **To do** and **Done**. Marking another status as
      Done moves the mark; a Project can't lose its Done status.
- [x] Tasks: title, notes, status, date, who it's given to (members only),
      labels (per Project), checklists, and a short number per Project (#3).
- [x] Needs review: only machines (Claude sessions) can put it on; anyone can
      take it off.
- [x] `omicron projects`, `omicron statuses`, `omicron tasks` (add, list,
      show, move, done, label, check, tick, needs-review, reviewed). They act
      as you when this machine can tell who you are, or as the machine with
      `--as-machine`. Terminal tests in `tests/board.rs`.
- [x] People table in `omicron`: `people list`, `people add`, `people remove`
      (by name or Tailscale login). Machines too: `machines list`,
      `machines add`, `machines remove`.
- [x] Web page: Projects list, start a Project, each Project's statuses side
      by side, add tasks, and a task view for title, notes, status, date, who
      it's given to, labels, checklist, Reviewed, Mark done and delete.
      Project settings for the name, statuses (add, rename, move the Done
      mark, remove) and members. Updates live from the change list. Fits a
      phone (one status per screen width, swipe across). Built into the
      `omicron` program (`crates/omicron/build.rs`, `dev/web.sh`). Browser
      tests in `e2e/tests/projects.spec.js`; screenshots with
      `OMICRON_SCREENSHOTS=1 dev/e2e.sh screenshots`.
- [x] Installable on the phone: icons (`web/public/icon.svg`, PNGs made by
      `dev/icons.js`). A browser test asks Chrome whether it would offer to
      install the page.
- [ ] Drag tasks between statuses and reorder them (now: pick the status in
      the task view; new tasks go to the bottom).
- [ ] Labels: rename, remove, colors (the `color` column is unused).

## 4. Claude sessions
- [ ] `omicron sessions`: start a new session (pick Project, give a name), or
      add one that's already open. Picker to jump into one.
- [ ] Keep the name in sync with `/rename`.
- [ ] Handle cleared, closed, and gone sessions.
- [ ] Dispatch: send a task to a session; reopen a closed one in the
      background if its machine is awake; error if the machine is asleep.
- [ ] Reports as task comments, the Needs review mark, and the Reviewed button.
- [ ] `omicron handoff`: handoff notes per session, picked up after `/clear`.

## 5. Chat
- [ ] `omicron chat`: one chat per Project, turned on or off per Project.

## 6. Machines and accounts
- [ ] `omicron machines`: pick a machine for a new terminal tab.
- [ ] `omicron accounts`: switch Claude accounts (rewrite of janus).

## 7. Teams (rewrite of legion)
- [ ] `omicron teams`: leads, workers, roles, workflows, jobs, parts,
      advisor, requests, heads-ups, runners.
- [ ] Only teams, jobs and their status, and workers go to Supabase.
- [ ] Pick a worker and jump into its live terminal.
- [ ] Open a team's folder in VS Code.

## Ideas
- **Loops that talk to Claude sessions.** Omicron runs repeating check-ins
  itself (for example "every 10 minutes, ask this session for status") and
  sends them to the session, so we don't depend on Claude's `/loop` command.
- Build a terminal emulator. Not now.
