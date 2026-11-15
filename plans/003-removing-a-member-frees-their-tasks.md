# Plan 003: Removing someone from a Project doesn't freeze the tasks given to them

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat df2448e..HEAD -- supabase/migrations`
> If a new migration changed `check_task` or `project_members` triggers, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (number the migration after any from plan 002)
- **Category**: bug
- **Planned at**: commit `df2448e`, 2026-11-14

## Why this matters

When a person is taken out of a Project, every task given to them can no
longer be changed by anyone: dragging it, renaming it, ticking it done or a
session updating it all fail with "tasks can only be given to members of
the Project", until someone gives each one to someone else by hand. On the
board the move snaps back with an error.

## Current state

- `supabase/migrations/0004_tasks.sql`, `check_task()` (~lines 100-110),
  runs before every insert and update of a task:

  ```sql
  if new.assignee_person_id is not null and not exists (
    select 1 from public.project_members m where m.project_id = new.project_id and m.person_id = new.assignee_person_id
  ) then
    raise exception 'tasks can only be given to members of the Project' using errcode = '23514';
  end if;
  ```

- Nothing clears `assignee_person_id` when a membership row is deleted
  (grep the migrations for `assignee_person_id = null`: no hits at planning
  time). The web's `removeMember` (`web/src/lib/data/people.ts`) only
  deletes the `project_members` row.

- Migrations: add a new file, next number (`0037`, or `0038` if plan 002
  took `0037`). Never edit an applied migration. See
  `0025_sessions_only_while_running.sql` for a trigger written in this
  repo's style (`security definer set search_path = ''`, a comment saying
  why).

- Tests: `crates/omicron/tests/` holds Rust tests that talk to the test
  Supabase; `tests/access.rs` or `tests/tasks.rs` (if present; otherwise
  the file that covers members) are the pattern.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Apply migrations to the local test DB | `bash scripts/test-db.sh reset` | exit 0 |
| All Rust tests | `bash scripts/test.sh` | all pass |
| People page browser test | `bash scripts/e2e.sh tests/projects.spec.js -g "the People page"` | pass |

## Scope

**In scope**: a new migration; one new Rust test.

**Out of scope**: `check_task` itself (keep refusing to *give* a task to a
non-member); web code.

## Git workflow

Branch `advisor/003-removing-a-member-frees-their-tasks`; one commit; do not push.

## Steps

### Step 1: Migration

Add an `after delete on public.project_members` trigger that sets
`assignee_person_id = null` on that Project's tasks given to that person
(`where project_id = old.project_id and assignee_person_id = old.person_id`).
`security definer set search_path = ''`.

**Verify**: `bash scripts/test-db.sh reset` → exit 0.

### Step 2: Test

A person gives a task to a second member, removes that member, then
renames the task → the rename works and the task's `assignee_person_id` is
null.

**Verify**: `bash scripts/test.sh --test <the file you added it to>` → passes.

### Step 3: Whole suite

**Verify**: `bash scripts/test.sh` → all pass; the People browser test passes.

## Done criteria

- [ ] New migration applies on a fresh test database
- [ ] New test passes; `bash scripts/test.sh` passes
- [ ] No existing migration file changed

## STOP conditions

- The `project_members` delete is done in a way the trigger wouldn't see
  (e.g. a cascade from deleting a person, where the tasks go anyway) and
  that path also errors: report it.
- Clearing the assignee would break a rule in another trigger (e.g. the
  `clear_ended_session` trigger in 0025): report the error.

## Maintenance notes

The board shows a task with no one; that's intended. If later the product
wants "give their tasks to X" when removing someone, build it on top of this.
