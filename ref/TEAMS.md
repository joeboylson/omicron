# Teams: the plan for rewriting legion in Omicron

Read alongside `DEFINITIONS.txt` (the words) and `ref/BRAINSTORM.md` ("Legion").
Source read: `~/@/1_Projects/tools/legion` (docs/legion.md, IMPROVEMENTS.md,
HANDOFF.md), 11 Nov 2026. Nothing is copied from it; this is the shape to
rewrite.

## What a team is

A **team** is one **lead** and its **workers**, in one folder, following one
**workflow**. You give it **jobs**. The lead hands each job from role to role
(planner, builder, tester, reviewer…) until it's done, and only the lead
starts or stops workers. An optional **advisor** watches for speed-ups and
suggests them to the lead. Anything waiting on you is a **request**. A
**heads-up** is a one-line warning to everyone.

A team barely knows about the rest of Omicron. A **task** is not a job, but a
task can link to one or more jobs (#28): the session handles the task, the
team handles the jobs.

## How a job moves (kept from legion; it worked)

1. You add a job. The lead starts the workflow's first role on it, in the
   job's own git worktree on a `job/<number>-<name>` branch.
2. Each worker does its step, commits, catches its branch up with the base
   branch, and hands off, naming who's next. The handoff goes to the lead,
   which starts that role or messages the copy that's already running.
3. The last worker reports the job done. The lead finishes it: the base
   branch moves up, replaying the commits if the base moved on. A clash goes
   back to the builder to fix just the clash.
4. A big step can be split into **parts**, each in its own checkout, worked
   by copies of a role at the same time, merged as each is done.

## Where things live

- **On the machine running the team** (most of it): the folder's setup in
  `.omicron-team/` (kept in git, so it travels with the code): roles
  (`roles/<name>.md` plus optional settings), workflows (`workflows/<name>.yaml`),
  the toolbox (`tools/`), heads-ups (`heads-ups.md`). The running team's log,
  job files and worktrees go in `~/.omicron/teams/<folder>-<hash>/`.
- **In Supabase** (only what people elsewhere need to see): teams (machine,
  folder, workflow, which Claude session manages it), jobs and their status,
  and workers (role, copy name, state, which job). Changes go through the
  change list like everything else, so the web page and other machines hear
  about them live.

## How it fits into Omicron

- **No separate background program.** legion had its own `legiond`; here the
  `omicron daemon` runs the teams on its machine. It already hears changes
  live, restarts at login (#33 turns that on), and runs loops.
- **Workers run in Omicron's session host** (#18), like any session: no tmux,
  `omicron sessions attach`, and the picker shows them. `omicron teams`
  picks a worker and jumps into its live terminal.
- **Workers use `omicron teams ...` commands** for their tools (handoff,
  done, blocked, ask, heads-up…), not a separate tool server. Each worker's
  environment says which team and position it is; the daemon checks every
  call against the caller's role. (legion used an MCP tool server; commands
  are simpler, work in any runner, and match "the command can do everything".)
- **Requests** (questions, permissions, decisions) reach you as Omicron
  things: a comment or a task given to you, so they show on the board and the
  phone, not only in a team app.
- **Teams on the web page:** none at first (BRAINSTORM: terminal and the
  managing session only). The board shows linked jobs' status on a task (#28).

## Lessons legion already learned (build them in from the start)

From legion's IMPROVEMENTS.md, the ones that change the design:

- One copy per job: a second copy never starts on a job one already holds.
- Restarts keep names (`builder-3` stays `builder-3`) and bring back every
  worker that was on a job.
- Settings like the busy-session limit are read when needed, not only at start.
- The lead can interrupt a long turn; messages don't wait behind it forever.
- Decisions a worker flags reach you (as a request), and your answer reaches
  every worker it affects.
- Jobs can be edited after they're added, and the lead can propose jobs.
- Workers wait for events instead of polling in shell loops.
- Workflows can say "at most N rounds" without spelling out each round.
- A finish clash goes back to the builder before bothering you.
- Long conversations are handed over (a handoff note, then a fresh start)
  past a set fullness, as Omicron's `/omicron-handoff` already does.

## Build order (the Omicron tasks)

1. **#16** Supabase tables for teams, jobs and workers, with access rules and
   the change list.
2. **#17** `omicron teams` commands: set up a folder, start and stop a team,
   add and list jobs, the workers' own commands, and the daemon running it.
3. **#28** Link tasks to jobs (one or more), shown on the task.
4. **#18** Workers in the session host, and a picker to jump into one.
5. **#19** Open a team's folder in VS Code.

Other runners (OpenCode on a local model, as legion's harnesses did) come
after Claude Code works end to end.

## Open questions (my default in brackets; say if you want otherwise)

1. **Folder setup's name:** `.omicron-team/`, kept in git? [yes]
2. **Moving off legion:** run both side by side, then move each folder over
   with a small import of `.legion/` (roles, workflows, toolbox, callouts)?
   [yes, an import command; no copying of legion's running data]
3. **The advisor:** keep it, off by default, waking every 10 minutes when
   there's work? [yes]
4. **Requests on your phone:** a task given to you in the managing session's
   Project, with the question in it, and your answer as a comment? [yes]
5. **Who can add jobs:** you, the managing Claude session, and the lead (as a
   proposal you approve)? [yes]
6. **Other runners (OpenCode):** later, after Claude Code works? [yes]
