# Plan 002: Only people can delete a Project or change its name, rules and numbering

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat df2448e..HEAD -- supabase/migrations crates/omicron/tests/access.rs`
> If a new migration changed the `projects` policies since this plan was
> written, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `df2448e`, 2026-11-14

## Why this matters

Machines (computers signed in with an API key) can delete whole Projects,
with every task, comment and session, and can rename them or rewrite their
run rules and task numbering. A machine on "every Project" can do it to all
of them. Omicron keeps no backups (the owner's choice), so one lost or
misbehaving key could wipe everything for good. Membership changes are
already limited to people; deleting and renaming a Project should be too.

## Current state

- `supabase/migrations/0001_identity.sql:108-113`:

  ```sql
  create policy "see projects" on public.projects for select
    using (public.can_use_project(id));
  create policy "change projects" on public.projects for update
    using (public.can_use_project(id));
  create policy "delete projects" on public.projects for delete
    using (public.can_use_project(id));
  ```

  `can_use_project(p)` (same file, ~line 62) is true for a member person
  **and** for an active machine in the Project (or on every Project).
  `public.is_person()` (same file) is true only for people.

- Machines legitimately update a Project? Check before writing: grep the
  Rust code for PATCHes to `/rest/v1/projects`. At the time of planning the
  only one is `crates/omicron/src/board.rs:~1174` (setting `run_rules`),
  used by `omicron run-rules` (see STOP conditions).

- Database changes are made only by adding a migration file
  (`supabase/migrations/NNNN_what_it_does.sql`, next number after the
  highest — at planning time `0036_dispatch_claim_by.sql`, so `0037`). The
  hosted database applies them on push to `main`. Each must also work on a
  fresh database. Look at `0036_dispatch_claim_by.sql` for the style
  (a short comment saying why, then plain SQL).

- `crates/omicron/tests/access.rs` checks what an outsider can and can't
  do; model a new test after the tests in that file (they use `admin()`,
  `person()`, `machine()`, `call()` and `attempt()` helpers at the top).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Rust tests (one file) | `bash scripts/test.sh --test access` | all pass |
| All Rust tests | `bash scripts/test.sh` | all pass |
| Reset the local test database to apply a new migration | `bash scripts/test-db.sh reset` | exit 0 |

## Scope

**In scope**: a new `supabase/migrations/0037_only_people_delete_projects.sql`;
`crates/omicron/tests/access.rs` (new test).

**Out of scope**: `0001_identity.sql` (never edit applied migrations);
the select policy; membership policies; web code.

## Git workflow

- Branch: `advisor/002-only-people-delete-or-rename-projects`
- One commit, plain-sentence message.
- Do not push (pushing to `main` changes the hosted database).

## Steps

### Step 1: Migration

Drop and re-create the "delete projects" policy with
`using (public.can_use_project(id) and public.is_person())`.

For updates, keep machines able to do what the CLI needs (see the Rust
grep) and nothing else: either re-create "change projects" with
`and public.is_person()` if machines never update Projects, or add a
`before update` trigger that raises when the caller isn't a person and
`name` or `next_task_number` changed. Say in a SQL comment which you chose
and why.

**Verify**: `bash scripts/test-db.sh reset` → exit 0 (the migration applies to a fresh database).

### Step 2: Access test

Add a test to `access.rs`: a machine in a Project tries to DELETE the
Project and to PATCH its `name` → nothing happens (the row is still there,
name unchanged); a member person can rename it.

**Verify**: `bash scripts/test.sh --test access` → all pass, including the new test.

### Step 3: Whole suite

**Verify**: `bash scripts/test.sh` → all pass.

## Done criteria

- [ ] New migration file exists and applies on a fresh test database
- [ ] `bash scripts/test.sh --test access` passes with the new test
- [ ] `bash scripts/test.sh` passes
- [ ] No existing migration file changed (`git diff --stat df2448e -- supabase/migrations` lists only the new file)

## STOP conditions

- The Rust code has a machine path that deletes Projects or changes their
  `name`/`next_task_number` (it would break): report it.
- `omicron run-rules` runs as a machine and the update policy you chose
  would block it: report which way you'd go instead.
- Any existing test fails after the migration.

## Maintenance notes

- New columns on `projects` that machines must write need adding to
  whatever the update rule allows.
- Reviewers: try the new policy by hand with a machine key on the local
  test database.
