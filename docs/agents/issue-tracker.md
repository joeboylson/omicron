# Issue tracker: the Omicron board

Omicron tracks its own work: issues are tasks in the **Omicron** Project, on
the real Supabase, through the `omicron` command (or the web page at
https://atlas.taileedd95.ts.net:8451). Not GitHub Issues, not `.scratch/`.

Columns, in order: **To do** (in working order, top first), **Doing**,
**Waiting on Joe**, **Review**, **Done**.

## When a skill says "publish to the issue tracker"

    omicron tasks add Omicron "<short title>" --notes "<the body>" [--label <label>]...

A spec or a long body goes in `--notes` (plain words; see CLAUDE.md). Put
it at the top of To do if it comes first: `omicron tasks move Omicron <n> --top`.
Several tickets from one spec: one task each, and say in each one's notes
which others it waits for (by number).

## When a skill says "fetch the relevant ticket"

    omicron tasks show Omicron <n>

It prints the task, its checklist, linked team jobs and every comment.

## Comments, state, and closing

- Comment: `omicron tasks comment Omicron <n> "<text>"` (from a Claude
  session, add `--as-machine`; a session's comment marks the task Unread).
- Move: `omicron tasks move Omicron <n> "<status>"`; finished:
  `omicron tasks done Omicron <n>`.
- A whole task from start to Review, like a session does it:
  `bash scripts/finish-task.sh <n> "<report>" [images...]`.
- Questions for Joe: comment, then move the task to **Waiting on Joe**; he
  answers in its comments.

## Wayfinding operations

Used by `/wayfinder`.

- **Map**: one task titled `Map: <effort>`, labelled `map`; its notes hold
  Notes / Decisions so far / Fog. Update it with a comment.
- **Child ticket**: one task per question, labelled `wayfinder` and the
  ticket type (`research`, `prototype`, `grilling` or `task`), with
  `Map: #<map number>` and `Blocked by: #n, #n` at the top of its notes.
- **Frontier**: open (To do) tasks labelled `wayfinder` whose blockers are
  all in Review or Done; lowest number first.
- **Claim**: move it to Doing before any work.
- **Resolve**: comment the answer, move it to Done, and comment a one-line
  pointer (gist + `#n`) on the map task.
