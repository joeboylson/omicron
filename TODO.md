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
- [x] Run `omicron daemon` at login: `omicron daemon start-at-login` (and
      `stop-at-login`) writes a launchd agent on macOS or a systemd user
      service on Linux and starts it. It restarts after a failure but not
      after a switched-off stop. Tested against real systemd in a container
      (`dev/docker/systemd-test.sh`).
- [ ] Try `start-at-login` on a real Mac (launchd). Installing the login item
      from a Claude session was blocked by its permission checks; run it by
      hand (`omicron daemon start-at-login`). Until then `dev/mac.sh` runs the
      daemon in tmux.

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
- [x] Colors (Apple's system colors, light and dark): statuses and labels
      each have one (`omicron statuses color`, `omicron labels color`, or
      Project settings); blue for buttons and links, red for delete and
      overdue dates, orange for Needs review, green for open sessions.
- [ ] Labels: rename and remove.

## 4. Claude sessions
- [x] Decided (10 Nov 2026): Omicron doesn't start or host sessions. It keeps
      a record of the ones you open yourself. Tasks reach a session by the
      session pulling them (a hook), not by typing into it. ccsm keeps running
      next to Omicron for now.
- [x] `omicron sessions add <name> --project <P>` (run inside the session),
      `list`, `remove`, and `setup-claude` (adds Omicron's SessionStart and
      SessionEnd hooks to Claude Code's settings). The record follows `/clear`,
      a normal close, `claude --resume`, and a window that dies (marked gone
      by the next hook or daemon start). Hooks never fail Claude and never
      call Supabase for windows Omicron doesn't track. Shown on each Project's
      page, live. Tests in `tests/sessions.rs` and `e2e/tests/projects.spec.js`.
- [x] Tried with real Claude Code on the Mac (11 Nov 2026): a `claude -p`
      session added itself, its end hook closed it, `--resume` reopened it,
      the start hook handed it a sent task, and it reported back with
      `tasks comment --review`. Hooks come from `~/.omicron/claude/settings.json`
      via `claude --settings`, since changing Claude Code's own settings was
      blocked by its permission checks.
- [ ] Picker to jump into a session (needs a way in: tmux, or the Claude app).
- [ ] Keep the name in sync with `/rename`.
- [x] Dispatch: a task is given to a person or a Claude session
      (`omicron tasks send <P> <n> <session>`, or "Given to" on the web
      page). The session pulls it: its Stop hook hands new tasks over at the
      end of each turn (Claude carries on with them), and SessionStart at the
      start of a conversation. Each task is handed over once
      (`pick_up_tasks` in the database); sending it again makes it new.
      Tests in `tests/sessions.rs` and `e2e/tests/projects.spec.js`.
- Dropped: "reopen a closed session in the background". Omicron doesn't
  start sessions (decided 10 Nov 2026), so a task sent to a closed session
  waits until it's opened again.
- [x] Reports as task comments: people and sessions comment on tasks
      (`omicron tasks comment <P> <n> "text" [--review]`, or the task view
      on the web page). From inside a tracked session the comment says which
      session wrote it; the database checks the session is the machine's
      own. With the Needs review mark and the Reviewed button, a session's
      report goes: comment + review, someone reads it, Reviewed.
- [x] `omicron handoff write | list | show <P> <n> [--pickup]`: handoff notes
      per session (rewrite of lethe), numbered per Project. A newer note
      replaces the waiting one; after `/clear` the SessionStart hook gives it
      to the new conversation; closing the window cancels it; anyone in the
      Project can still pick one up by hand. Tapping a session on the web
      page shows its notes, with a button to copy the pickup command.
- [x] `/omicron-handoff` for Claude Code (installed by `omicron sessions
      setup-claude`, next to the hooks): checks the real state, writes the
      note with `omicron handoff write`, and says to type `/clear`. Named so
      it doesn't replace the existing `handoff` and `lethe` skills.

## 5. Chat
- [x] `omicron chat on | off | read | send`: one chat per Project, for people
      and Claude sessions, off until a member turns it on. A message naming a
      session (`@parser`) reaches it at the end of its next turn (Stop hook),
      once; a session's own messages say which session wrote them. On the
      web page: a chat sheet from the Project's top bar, live.

## 6. Machines and accounts
- [x] `omicron machines pick [machine]`: open a terminal on another awake
      machine with `ssh <its tailnet name>` (decided 11 Nov 2026). Each
      daemon announces its tailnet name with its "awake" status; with no name
      given it lists them and asks for a number.
- [x] Decided (11 Nov 2026): a full rewrite of janus inside Omicron.
- [x] `omicron accounts add | list | use | remove`: save the login Claude Code
      has now under a name, and swap saved logins in (Keychain on a Mac,
      `~/.claude/.credentials.json` on Linux; `~/.claude.json` for who it
      is). Saved logins stay on the machine in `~/.omicron/accounts/`. The
      account in use is saved again before each switch, so renewed tokens
      aren't lost. Tested on Linux files (`tests/accounts.rs`); the Keychain
      path isn't tried on the Mac yet.
- [x] `omicron accounts usage`: each account's 5-hour and weekly use (the
      endpoint Claude Code's /usage reads; expired tokens are skipped, never
      renewed, so Claude Code's own stay valid). `omicron accounts auto on |
      off | show | check` and `resume`: switch from the primary to the
      secondary at a limit and back when it resets; picking one by hand holds
      it. `omicron daemon` checks every 2 minutes while it's on. Tested with a
      stand-in usage server (`tests/accounts.rs`).
- [x] `omicron accounts run <name> [claude args]`: one session that stays on
      one account. The first time it runs `claude setup-token` and saves the
      pasted token (`~/.omicron/accounts/<name>.token`, private); then it
      starts `claude` with `CLAUDE_CODE_OAUTH_TOKEN`. Warns a month before the
      token's year is up; `--new-token` replaces it.
- [x] Web page: a Machines list on the Projects page with each machine's
      Claude account in use and every saved account's 5-hour and weekly use
      (green, orange from 70%, red from 90%). The daemon reports it through
      `report_claude_accounts` when it changes (names, numbers and reset
      times only; logins never leave the machine).

## 7. Teams (rewrite of legion)
- [ ] `omicron teams`: leads, workers, roles, workflows, jobs, parts,
      advisor, requests, heads-ups, runners.
- [ ] Only teams, jobs and their status, and workers go to Supabase.
- [ ] Pick a worker and jump into its live terminal.
- [ ] Open a team's folder in VS Code.

## Questions for Joe
Decisions an unattended run found it needed; it carried on with other work.
- (none yet)

## Ideas
- **Loops that talk to Claude sessions.** Omicron runs repeating check-ins
  itself (for example "every 10 minutes, ask this session for status") and
  sends them to the session, so we don't depend on Claude's `/loop` command.
- Build a terminal emulator. Not now.
