# Plan 005: The board ignores a load that finishes after a newer one

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat df2448e..HEAD -- web/src/pages/ProjectPage.tsx`

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `df2448e`, 2026-11-14

## Why this matters

The Project page reloads the whole Project after each change: once straight
after the page's own save (`.then(reload)`), and again when the change comes
back through live updates. Each load is several parallel queries, so they
take different times, and nothing makes sure the newest one wins: an older
load finishing last can briefly show a card back where it was, or a comment
missing, until the next change.

## Current state

`web/src/pages/ProjectPage.tsx` (~lines 150-155):

```tsx
const reload = useCallback(() => {
  act(async () => setProject(withSaving(await loadProject(db, id)))).then((ok) => setLoadFailed(!ok));
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [db, act, id]);
useEffect(reload, [reload]);
useChanges(db, id, reload);
```

`withSaving` puts changes still being saved back on top (see
`web/src/lib/pending.ts`, `PendingChanges.over`). `useChanges`
(`web/src/lib/live.ts`) calls `reload` 100ms after a burst of change lines.
Conventions: plain React hooks, comments say *why* in plain words.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `cd web && npx tsc --noEmit -p .` | exit 0 |
| Unit tests | `cd web && npm test` | all pass |
| Board browser tests | `bash scripts/e2e.sh tests/projects.spec.js` | all pass |
| Two people at once | `bash scripts/e2e.sh tests/together.spec.js` | pass |

## Scope

In scope: `reload` in `ProjectPage.tsx`. Out of scope: `loadProject`, `live.ts`, `pending.ts`, merging the two reloads into one (a later plan).

## Git workflow

Branch `advisor/005-board-loads-land-in-order`; one commit; do not push.

## Steps

### Step 1: Number each load

Keep a `useRef(0)` counter. Each `reload` takes the next number before it
starts; when its `loadProject` finishes, it only calls `setProject` (and
`setLoadFailed`) if its number is still the latest. Add a one-line comment
saying why.

**Verify**: `cd web && npx tsc --noEmit -p .` → exit 0.

### Step 2: Tests

**Verify**: `bash scripts/e2e.sh tests/projects.spec.js` → all pass;
`bash scripts/e2e.sh tests/together.spec.js` → pass.

## Done criteria

- [ ] Typecheck and `npm test` pass
- [ ] The board and two-people browser tests pass
- [ ] Only `ProjectPage.tsx` changed

## STOP conditions

- Something relies on an older load's result being applied (a test starts
  failing because a load it waited for is now ignored): report which.

## Maintenance notes

A follow-up worth planning: send the page's own `.then(reload)` calls
through the same 100ms wait as live updates, so one change makes one load
instead of two.
