# Plan 004: A person can only delete people they share a Project with

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat df2448e..HEAD -- crates/omicron/src/web.rs`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `df2448e`, 2026-11-14

## Why this matters

The Web Machine's "delete a person" route lets any signed-in person delete
another person whose Projects are all ones the asker is in. For someone in
**no** Projects (a person who just signed in, or one taken out of
everything) that check is empty, so anyone can delete them for good —
and any machine they owned loses its owner.

## Current state

`crates/omicron/src/web.rs`, the people-delete handler (~lines 218-236):

```rust
let mine = as_person.my_project_ids()?;
if self.supabase.person_projects(id)?.iter().any(|p| !mine.contains(p)) {
    return fail(403, "they're in a Project you're not in, so you can't delete them");
}
```

`person_projects(id)` returns the target's Project ids; `my_project_ids()`
the asker's. The browser test for this page is "the People page: everyone,
their Projects, and adding or taking them out" in
`e2e/tests/projects.spec.js`; it ends by checking a refused delete with a
direct `request.post(.../api/people/<id>/delete)` — model a new check on it.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Build | `cargo build -q` | exit 0 |
| People browser test | `bash scripts/e2e.sh tests/projects.spec.js -g "the People page"` | pass |

## Scope

In scope: that handler in `web.rs`; the People test in `e2e/tests/projects.spec.js`.
Out of scope: the web page (its menu already only offers Delete when allowed).

## Git workflow

Branch `advisor/004-only-delete-people-you-share-a-project-with`; one commit; do not push.

## Steps

### Step 1: The rule

Also refuse (403, plain words, e.g. "you can only delete people in one of
your Projects") when the target's Projects are empty, or none of them is
one of the asker's.

**Verify**: `cargo build -q` → exit 0.

### Step 2: Test

In the People test, add: a new person who is in no Project; Robin's
direct POST to delete them → 403, and they still exist.

**Verify**: the People browser test passes.

## Done criteria

- [ ] Build passes; the People test passes with the new check
- [ ] Only `web.rs` and `projects.spec.js` changed

## STOP conditions

- The web page offers Delete for people in no shared Project and a test
  depends on deleting them: report it before changing the page.

## Maintenance notes

If Omicron later gets an admin role, this is the route it would widen.
