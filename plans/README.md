# Implementation Plans

Written by the improve skill (`.claude/skills/improve`, from
github.com/shadcn/improve) on 14 Nov 2026, at commit `df2448e`, for task
#195. Nobody was there to choose which findings to plan, so, as the skill
says to do then, these are the top five by leverage (impact for the effort,
weighted by how sure we are). The full list is below; any of them can be
planned next with `/improve plan <description>`.

Execute in the order below unless dependencies say otherwise. Each
executor: read the plan fully before starting, honor its STOP conditions,
and update your row when done.

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| 001  | Only a visit to this computer's own address counts as its owner | P1 | S | — | TODO |
| 002  | Only people can delete a Project or change its name, rules and numbering | P1 | S | — | TODO |
| 003  | Removing someone from a Project doesn't freeze the tasks given to them | P1 | S | — (migration number after 002's) | TODO |
| 004  | A person can only delete people they share a Project with | P2 | S | — | TODO |
| 005  | The board ignores a load that finishes after a newer one | P2 | S | — | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

## Dependency notes

- 002 and 003 each add a migration: whichever lands second takes the next number.

## Other findings (checked, not planned yet)

Ordered by leverage. "Checked" means the cited code was read and the
finding holds; the rest are leads.

**Needs a decision from Joe first**
- **Who may write the words a session acts on.** Any member of a Project
  (person or machine) can edit a waiting handoff note, a team job's text,
  a task's title and notes before a session picks it up, and the run rules.
  The gate (remote control) decides by who *gave* an order, not who
  *wrote* it, so an edit can put instructions into a session on someone
  else's computer with remote control off. (`0008_handoffs.sql:66`,
  `0019_teams.sql:160`, `0026_tasks_given_by.sql:14`, `0030_run_rules.sql:6`)

**Security**
- `machines pick` passes a host name that any member can announce (live
  presence) straight to `ssh`, with no `--` (`machines_cmd.rs:195`). Checked.
- Switched-off machines, or ones taken out of a Project, can still read and
  delete their teams' workers and requests (`0019_teams.sql:141`).
- Deleted comments stay readable for 30 days in the `changes` table's
  `old_record`, including to people added later (`0003_changes_and_presence.sql`).
- Secret files are written readable for a moment before being made private;
  `~/.omicron` isn't made private (`config.rs:68`, `board_cmd.rs:47`).
- `POST /api/machines` passes `project_ids` unchecked into a filter, and a
  failure part-way leaves a machine login nobody holds (`web.rs:272`).
- Error text from the server reaches visitors (paths, child process output) (`web.rs:132`).

**Bugs**
- Focusing a task's Notes (or title) and clicking away saves the old text
  over a session's newer edit, without anything being typed (`task/Notes.tsx:11`).
- Comment images break after an hour on a page left open (signed links
  expire, never refreshed) (`Comments.tsx:32`, `data/tasks.ts:121`).
- A dispatch claimed and then failing part-way stays "claimed" forever;
  reactions run in threads after the change line is marked done, so a
  crash loses them (`changes.rs:104`, `dispatch_cmd.rs:185`).
- Hand off from the page can run twice (double click), and misses a note
  saved while live updates were reconnecting (`web.rs:611`, `handover.rs:33`).
- Terminal keys that fail to send are dropped silently (`Terminal.tsx:96`).
- The error bar's Try Again repeats inserts (a second comment or task when
  the first actually landed) (`App.tsx:79`).
- One stuck session's terminal can freeze typing in all of them (one lock
  held across a blocking write) (`web.rs:792`).
- A team's lead can be started twice by two reactions at once (`team_launch.rs:110`).
- "Copy Link" in a task's menu doesn't use the shared copy helper, so it
  does nothing on a plain-http page (`task/Header.tsx:104`). Checked.

**Speed**
- Every board reload downloads every task's whole comment thread, dispatch
  history and 100 handoff bodies, though cards only need counts (`data/projects.ts:39`).
- Most actions reload twice (their own `.then(reload)` and the live
  update); see plan 005's maintenance note (`ProjectPage.tsx:150`).
- ⌘K's command list (one per task) is rebuilt on every render (`lib/commands.ts:28`).
- No memoizing on the board: every keystroke or drag re-renders every card (`ProjectPage.tsx:392`).
- `omicron tasks add/move` download every task to pick one position, and
  renumbering sends one update per task (`board.rs:1006`).

**Tests, tooling, docs**
- `runs` isn't in the row-level-security sweep test (`tests/access.rs:86`).
- Database tests pass silently (skipped) when no test database is set (`tests/common/mod.rs:14`).
- No test that a remote-control token can't switch remote control on, or
  that the gate secret works over real HTTP (`web.rs:513`).
- Fixed sleeps in tests (20 in e2e, 16 in Rust) (`together.spec.js:86`, …).
- Mac-only paths still untested per TODO.md (Keychain accounts, start at login).
- No lint, formatter check or one command that runs every check; the web unit
  tests aren't in `scripts/test.sh`.
- Dependencies: Vite and supabase-js behind within their majors; three `^`
  ranges left in `web/package.json`; no lockfile for the e2e tools.
- Stale docs: README/CLAUDE.md disagree on which database tests use;
  `build.rs`, TODO.md and a test name scripts that no longer exist.

**Where to take it next (grounded in ref/ and TODO.md)**
- Teams: edit a job after adding it, the lead proposing jobs, importing from legion (TEAMS.md:77,108).
- Show team jobs and their status on the web page, read-only (BRAINSTORM.md:54).
- `omicron doctor` lists Claude chats on this computer that aren't linked yet (BRAINSTORM.md:10).

## Findings considered and rejected

- Gate-secret compare leaks the secret's length: not worth doing; it's a
  long random secret compared in constant time otherwise.
- Remote token timing: tokens are compared as SHA-256 hashes; not a risk.
- Markdown in notes and comments: safe (react-markdown, no raw HTML).
- Missing database indexes: the columns the board loads by are indexed.

## Not audited

The desktop app (`desktop/`), most of the `*_cmd.rs` files beyond tasks,
board, machines, dispatch and runs, several web components (GateButton,
ComputerPanel, DevView, RunBar in depth), bundle size, and `cargo audit` /
`npm audit` (they write to disk or need the network).
