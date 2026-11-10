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
- [ ] `omicron` commands for these: register a machine, sign it in, link a
      second Tailscale identity.
- [ ] The Web Machine's sign-in page: put `identity::visitor` and
      `sign_in_person` together, and hand the login to the web page.

## 2. Base
- [x] Rust workspace in this repo. Web page skeleton still to do.
- [x] Supabase tables: people, Tailscale identities, machines, Projects,
      members (`supabase/migrations/0001_identity.sql`).
- [x] Test setup in multipass: self-hosted Supabase (release v0.8.4) in the
      `omicron-dev` VM. `dev/supabase/install.sh`, `migrate.sh`, `test.sh`.
- [ ] Machines check in and listen for changes with Supabase Realtime.

## 3. Projects and tasks (replaces Trello)
- [ ] Projects with members, per-Project statuses, and one Done status.
- [ ] Tasks: title, who it's given to, status, date, labels, checklists.
- [ ] People table: anyone can add or remove people from Projects.
- [ ] Web page (installable on the phone) and the same things in `omicron`.

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
