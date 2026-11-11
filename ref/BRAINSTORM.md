# BRAINSTORM

## Words
- **Project**: the one name for a board or project. Don't use "board" anymore.

## Decided

### Starting point
- Omicron is a new tool built from scratch, not a wrapper around the existing tools. All the code lives in one place.
- It runs in two places: the terminal and a phone/web app you can install (PWA).
- It should fit into the homelab setup.

### No central server
- Anyone can set up Omicron by making their own Supabase database and connecting to it.
- There's no main Omicron server. Every computer has its own copy of Omicron and registers itself with the shared Supabase database.
- I'll only ever run one setup (one database) myself.
- Everything should react to events as they happen, not check for changes on a timer.

### Tasks
- A task works the same way whether it goes to a person or to a Claude session. The only difference is who it's given to.
- A task has a title, who it's given to, a status, a date (when it'll get done), labels, and checklists.
- Tasks don't link to legion missions. Legion only runs through a Claude session, so it belongs on the session instead ("you manage this squad").

- Each Project has its own labels.

### Statuses
- Each Project makes its own list of statuses. For example, our family Trello only has **To do** and **Done**.
- Each Project marks one of its statuses as its **Done** status.
- **Needs review** is separate from the Project's statuses. It's a mark on the task, not a column, and the task stays in whatever status it was in.
- Only a Claude session can put the Needs review mark on a task.
- The mark goes away only when I press **Reviewed** on the task.

### Permissions
- For now, every member of a Project can do everything in it.
- If a Project has no machines added, nobody can do Claude things in it (like Dispatch).

### Adding people
- A person can sign in on their own, or I can add them first.
- Either way, they see nothing until they're added to a Project.
- There's one table of people that shows the Projects each person is in. Any member can open it and add people to Projects or remove them.

### Projects and members
- Each Project has its own members.
- People only see the Projects they belong to. Family can't see work Projects unless they're added.
- A member is anyone I invite: me, family, and Claude sessions. No coworkers for now.
- Each Claude session is a real member with its own name, but it only sees the tasks given to it.
- With no Claude sessions in a Project, it works like a plain Trello replacement.

### Signing in
- The database is the source of truth, and it holds the logins. No central server holds them.
- People sign in with their Tailscale identity, if that's possible.
- API keys are only for machines, never for people.
- I'm on two Tailscale networks, personal and work, so I show up as two different Tailscale users. One person in Omicron can have more than one Tailscale identity linked to them.
- Goal: my wife opens the homelab dashboard, clicks the Omicron button, and is signed in automatically.
- How: a machine on each Tailscale network (for example the homelab on the personal one) serves the app. That machine checks who's connecting with Tailscale, looks up which person it belongs to, and signs them into Supabase. Only these machines need Supabase's secret key.
- No backup sign-in (like an email code) for now. Maybe later.

### Language
- Rule: use Rust if Tailscale sign-in works from Rust. If it doesn't, try Go. Pure TypeScript is also an option.
- Tailscale sign-in doesn't need Go's `tsnet`. When the Tailscale app is running on a computer, any program in any language can ask it who's on the other end of a connection. The `tailscale whois` command does this, and `tailscale serve` can add the person's login to each request it passes along. So Rust or TypeScript both work.
- Leaning TypeScript: the phone app is TypeScript anyway, Supabase's JavaScript library has the most complete live-update support, and the terminal tool can be built into one program file with Bun.
- **Decided:** all of Omicron is one Rust program: the `omicron` command and the background program. Only the web page is TypeScript and React, using plain shadcn components (no slag styling).

### Machines, API keys and Claude sessions (proposed, simpler version)
- **People**: members of Projects. Nothing else to it.
- **Machine**: a computer that's been registered with Omicron. It can be active or inactive. When it's registered, it gets its own API key, and that key belongs only to that machine.
- **Project access**: set on the machine, either to certain Projects or to all of them, the same way it works for people. Adding a machine to a Project and setting the machine's Project access are the same thing, set in one place.
- **Claude session**: belongs to one machine and one Project. It uses its machine's key through `omicron` commands, so it has no key of its own. Its Project has to be one its machine is allowed into. It can optionally manage a legion squad.
- Dropped: one key shared across several machines. With one key per machine you always know which machine did something, and you can shut off one machine without touching the others.
- I agreed to this simpler version.

### Computers and sessions
- Omicron can be installed on any of the 4 computers: the Mac, spark, the Mac mini, and the personal laptop.
- On any of those computers, a Claude session can be registered to the Omicron setup and to a specific Project.
- Omicron keeps track of each session and whether its computer is awake.

### Sending a task to a Claude session
- Sessions don't start tasks on their own.
- Two ways a task reaches a session:
  - I tell the session to go get its tasks.
  - I press a **Dispatch** button on the task. That opens the session on its computer and hands it the task.
- If the computer is asleep, Dispatch comes back with an error. The simplest rule: if no computer picks up the request within a set time, it fails.

### Reports
- A session's report shows up as a comment on the task.
- A report doesn't close the task. It puts the **Needs review** mark on it for me to check.

### Message board
- Each Project can turn its message board on or off at any time.
- When it's on, every member can read the chat and post in it.
- When it's off, nobody sees it at all.

### Tracking Claude sessions
- Omicron keeps a list of all my Claude sessions.
- From Omicron I can see every session, pick one, and jump straight into it.
- In the terminal, Omicron only shows the sessions on the machine I'm on. Picking one works like the `claude-sessions` picker: a full-screen list in the terminal that drops me into the session.
- From the terminal I can start a new session: pick a Project, then give it a name, like the Claude naming tool does today. The Claude session gets that same name.
- I can also add a session that's already open, instead of starting a new one.
- If I rename the session with `/rename` inside Claude, the name in Omicron changes too.
  - How it could work: `/rename` writes a `custom-title` line into the session's transcript file (`~/.claude/projects/.../<id>.jsonl`). `claude-sessions` already reads that line. Omicron can watch the file and update the name as soon as the line shows up.

- Only sessions started or added through Omicron show up. Other Claude sessions on the machine are ignored.

### Terminal vs. web page
- The `omicron` terminal tool can do everything the web page can do.
- The web page can't create new sessions. Only the terminal can.
- Exception: if a task's session is closed and its machine is awake, Dispatch can reopen it (`claude --resume`) on that machine.
- A session that Dispatch reopens runs in the background, the way seraph's "headless" sessions work. I can jump into it later from the `omicron` picker.

### The other tools
- The terminal machine picker, janus, board / board-tui, and `legion-instances` all become parts of Omicron and keep doing what they do today.
- They aren't closely tied to tasks and Projects. The point is to have one codebase to look after instead of several.
- Each one is part of the one `omicron` program, not a separate repo.
- Each one gets rewritten. No old code gets copied in.
- Each one plugs into what Omicron already has (Supabase, machines, sessions, Projects) instead of keeping its own copy of the same thing.
- Names can change so everything fits together.

#### What each one does today, and how it could fit (proposal)
| Today | What it does | In Omicron | Proposed command |
| --- | --- | --- | --- |
| `machine-pick` | Picks a machine for a new Ghostty/kitty tab and prints its ssh address. Machines come from `~/.config/machine-pick/machines.zsh`. | Uses Omicron's machine list, which already knows which machines are awake. | `omicron machines` |
| `janus` | Switches Claude Code between accounts without closing sessions, and can switch on its own when usage runs low. | Logins stay on each machine and never go into Supabase. Omicron shows which account each session is on. | `omicron accounts` |
| `board` / `board-tui` | Short messages between the Claude sessions on the Mac and spark, through a small server on spark (`BOARD_URL`, a shared secret). | Becomes the Project message board in Supabase, so the spark server goes away. Sessions post with their machine's key. | `omicron chat` |
| `legion-instances` | One folder per legion, plus `legion.sh place / diff / save` to copy a legion between this repo and the folder it runs from. | A legion squad is tied to a machine and folder, and a Claude session can manage it. Omicron also covers "open a legion folder in VS Code". | `omicron teams` (was `omicron squads`) |
| `claude-sessions` + the naming tool | Pick a past session and resume it. Name new sessions. | Already covered in "Tracking Claude sessions". | `omicron sessions` |
| `lethe` | Handoff notes across `/clear`. | Already covered in "Handoffs". | `omicron handoff` |

- I agreed to the command names in the table.
- Board / board-tui becomes one chat per Project. Sessions don't need to message each other outside a Project.

### Legion
- All of legion moves into Omicron and gets rewritten, not just `legion-instances`. This is probably the biggest part of the whole thing.
- Omicron keeps the list of squads (which machine, which folder, which session manages each one), so `machines.txt` goes away.
- The web page doesn't need to handle legion. It's all done from the `omicron` terminal tool and through the Claude session that manages the squad.
- No terminal view on the web.
- In the terminal, `omicron teams` lets me pick a worker and jump into its live terminal, the same way the session picker works.
- Legion is its own workflow and barely knows about the rest of Omicron. A task is **not** a legion mission. A Claude session can manage a legion team if I want it to, but the two stay separate.
- Legion's data mostly stays on the machine running it. Supabase only gets the important parts: deployments, missions and their status, and operators.

#### New words for legion (agreed)
Plain words most people know, no military terms. Each one is chosen so it doesn't clash with Omicron's **task**, **Project**, **member**, or **session**.

| Legion today | Proposed | What it means |
| --- | --- | --- |
| legion (the feature) | **teams** (`omicron teams`) | The part of Omicron that runs teams of Claude sessions |
| deployment | **team** | One lead and its workers, in one folder, following one workflow |
| commander | **lead** | The main session of a team. It hands out work and is the only one that starts or stops workers |
| operator | **worker** | Any other session in the team |
| operator's job (`planner`, `builder`) | **role** | What a worker does. Copies of one role are `builder`, `builder-2`, ... |
| pipeline | **workflow** | Which role a job goes to next |
| mission | **job** | One piece of work given to a team. Not the same as an Omicron task |
| part | **part** | A piece of a job's current step, split off so several workers can do it at once |
| strategist | **advisor** | An optional session that suggests speed-ups to the lead. It never gives orders |
| escalation | **request** | Anything waiting on me: a question, a permission, a stuck job, a decision |
| callout | **heads-up** | A one-line warning for the whole team |
| harness | **runner** | The program a worker runs in (Claude Code, OpenCode) |
| toolbox | **toolbox** | No change |

- With these words, Supabase gets: teams, jobs and their status, and workers.
- "Squad" earlier in this doc means the same thing as **team**.
- What legion is today (from `agent_orchestration/legion/docs/legion.md`):
  - Written in Rust (`crates/legion`, `legiond`, `legion-client`, `legion-proto`), plus a Tauri app in `app/`.
  - A background program, `legiond`, runs a team of Claude Code sessions for each folder.
  - Its words: **commander** (the lead session, the only one that starts or stops sessions), **operator** (any other session, named for its job), **pipeline** (who a mission goes to next), **deployment** (one commander and its operators, in one folder, on one pipeline), **mission** (one task, in a file that never changes), **strategist**, **part**, **escalation**, **callout**.
  - Each folder's setup lives in `.legion/` in git: `legion.json`, `operators/`, `pipelines/`, `harnesses/`, `tools/`, `callouts.md`.

### Later
- Maybe build a terminal emulator too. Not now.

### When a session is cleared, closed, or gone
- I agreed to this plan:
  - An Omicron session is the named thing I work with, and it stays the same even when Claude's own session ID changes underneath it.
  - **Cleared (`/clear`)**: Claude starts a new session ID in the same window. A start-up hook (the same kind lethe uses) tells Omicron, which moves the Omicron session onto the new ID. The name, Project, tasks, and handoff notes all stay put.
  - **Closed (exited)**: an end-of-session hook marks it **closed**. It stays in the list, and picking it runs `claude --resume <id>`.
  - **Gone (transcript file deleted, or the machine is removed)**: Omicron marks it **gone**. Its tasks and notes are kept, and I can either reassign its tasks or archive it.

### Handoffs (taken from lethe)
- Each Claude session has its own library of handoff notes. It can write new ones and pick one back up after `/clear`, the way lethe works today. This is for the terminal.
- How lethe does it now:
  - The `/lethe` skill writes a note and saves it with `lethe save`. `lethe context` first prints the project, its last note, and the project's own checks from `.lethe.md`.
  - Notes are stored on the computer, in `~/.lethe/lethe.db` and `~/.lethe/notes`.
  - Two Claude Code hooks run `lethe hook`: one when a session ends and one when a session starts. When I type `/clear`, the new session gets the saved note automatically.
  - `/recall` lists notes (`lethe list`) and loads one (`lethe show <n> --pickup`).
- What changes in Omicron: notes live in Supabase and belong to a Claude session, so I can see a session's notes from any machine or the web page.

### Claude sessions and legion
- A Claude session can run a legion squad if I want it to.
- A Claude session is not a legion commander.

### Decided while building (10–11 Nov 2026)
- Omicron itself runs on the Mac (atlas); tests run in the `omicron-dev` container. The home lab puts the real page (:8451) and a dev page with seed data (:8453) on the tailnet, admin only for now.
- Two Supabases: real data, and dev/test data with seed data to reset to.
- Web page: Apple's Human Interface Guidelines, plain shadcn components, Geist and Geist Mono, Apple's system colors used sparingly.
- `omicron machines pick` opens ssh to the machine's tailnet name.
- `omicron accounts` is a full rewrite of janus (save, switch, usage, switch at a limit, one session on one account, usage on the web page).
- Sessions follow this doc (11 Nov): Omicron starts sessions and Dispatch opens them. A sent task waits until I tell the session to get its tasks or press Dispatch; sessions never start tasks on their own.
- **Where Omicron's sessions run:** not tmux and not Claude's remote-control. Omicron hosts them itself, like `dtach`: a small detached `omicron` host process per session owns its terminal (a pseudo-terminal) and a socket in `~/.omicron/run/`. `omicron sessions attach <name>` (or the picker) connects to it; a key detaches. It survives the daemon restarting. Dispatch reopens a closed session with the task as Claude's first message; for an open one the host types the task in.
- Reports follow rules: `/s` style, no jargon, no made-up terms, at most 500 words.

## Notes from seraph (how computers talk through Supabase)
Source: `agent_orchestration/seraph`, mainly `src/daemon.rs` and `supabase/migrations/20261018000500_many_machines.sql`.

- Computers never talk to each other directly. They only talk through Supabase.
- A **`commands` table** works as a to-do list for computers. The page adds a request row that names which computer it's for (`target`), with status `pending`.
- **Claiming**: a computer changes the row from `pending` to `running`, but only if it's still `pending`. Only one computer can win that change, so two computers never both act on the same request. When the work is done, it saves the result or the error back on the row.
- **Awake check**: each computer saves a `last_seen` time in a `controllers` table every 10 seconds. The page treats a computer as asleep if it hasn't checked in recently.
- **Not event-driven**: seraph's background program checks the `commands` table about once a second. It only uses Supabase's live updates (Realtime) to stream the terminal screen.
- **What Omicron would change**: each computer listens for new rows with Supabase Realtime instead of checking every second. Dispatch fails if the row is still `pending` after the time limit, or right away if the computer's `last_seen` is too old.
- seraph is written in Rust, so picking Go means Omicron can't reuse its code directly, only its ideas.

## Open questions
1. What gets built first? One order: (a) Supabase tables, machines, and sign-in; (b) Projects and tasks, so it replaces Trello; (c) Claude sessions, Dispatch, and handoffs; (d) chat; (e) machines and accounts; (f) teams (legion), last because it's the biggest.
2. Where does the code live: a new git repo in this `omicron` folder, with the Rust program and the web page side by side?
3. While Omicron is being built, do the old tools (legion, lethe, board, janus, and the rest) keep running alongside it until each part is ready?
