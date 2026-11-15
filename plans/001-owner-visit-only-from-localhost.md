# Plan 001: Only a visit to this computer's own address counts as its owner

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat df2448e..HEAD -- crates/omicron/src/identity.rs crates/omicron/src/web.rs`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `df2448e`, 2026-11-14

## Why this matters

`omicron serve` (the web page's server, the "Web Machine") decides who a
visitor is from request headers. When a request has **no**
`Tailscale-User-Login` header, it is treated as the computer's own owner
(`Visit::Local`). Every request proxied by `tailscale serve` arrives from
127.0.0.1, and Tailscale leaves the identity headers out for some traffic
(tagged devices, Funnel). Such a request would be signed in as the owner,
get a Dev view marked `local`, and could open remote control and type into
Claude sessions on this computer. A real local visit (a browser on this Mac
opening `http://127.0.0.1:9010`) always uses a localhost `Host`, so
requiring that keeps it working and closes the hole.

## Current state

- `crates/omicron/src/identity.rs` — `visitor()` works out who a visit is.
  Lines ~146-169:

  ```rust
  pub fn visitor(
      peer: IpAddr,
      header: impl Fn(&str) -> Option<String>,
      gate: Option<&str>,
      local: impl FnOnce() -> Result<TailscalePerson>,
  ) -> Result<Visit> {
      if !peer.is_loopback() {
          bail!("refused a visit from {peer}: ...");
      }
      match header("Tailscale-User-Login").filter(|l| !l.trim().is_empty()) {
          Some(login) => { /* gate secret check, then */ Ok(Visit::Tailnet(...)) }
          None => Ok(Visit::Local(local()?)),
      }
  }
  ```

  Its unit tests are in the same file, `mod gate_tests` (~line 171), using
  a `visit(headers, gate)` helper that calls `visitor("127.0.0.1", ...)`.
  Match their style.

- `crates/omicron/src/web.rs`:
  - `is_localhost(host)` (~line 86) and `allowed_host(host, extra)` (~line
    91) already know what a localhost `Host` header is
    (`localhost`, `127.0.0.1`, `::1`, any port).
  - `visitor` is called in two places, passing
    `|name| request_header(request, name)` as `header`: ~line 375 (owner
    checks for the Dev routes) and ~line 709 (`/api/session`, sign-in).

## Commands you will need

| Purpose   | Command | Expected on success |
|-----------|---------|---------------------|
| Build     | `cargo build -q` | exit 0 |
| Unit tests | `cargo test -q -p omicron --lib identity` | all pass |
| All Rust tests | `bash scripts/test.sh` | all pass (uses the test Supabase from `scripts/test.conf`) |
| Browser sign-in tests | `bash scripts/e2e.sh tests/sign-in.spec.js` | all pass |

## Scope

**In scope**: `crates/omicron/src/identity.rs` (the `visitor` function and
its tests).

**Out of scope**: `web.rs` routing and Host checks (`allowed_host` stays as
it is); the gate-secret logic for visits that *do* carry a login; anything
under `web/`.

## Git workflow

- Branch: `advisor/001-owner-visit-only-from-localhost`
- One commit; message style like the repo's: a plain sentence saying what
  is true now, then the task reference, e.g.
  `A visit counts as this computer's owner only at its own address`.
- Do not push.

## Steps

### Step 1: Make `visitor` refuse header-less visits that aren't to a localhost Host

In `visitor`, in the `None =>` arm, only return `Visit::Local` when the
`Host` header (read with the same `header` closure: `header("Host")`) is a
localhost address — reuse the same rule as `web.rs`'s `is_localhost` (move
or duplicate a small `is_localhost` helper into `identity.rs`; if you move
it, keep `web.rs` compiling by calling the moved one). Also refuse when
`X-Forwarded-For` or `Tailscale-User-Name` is present without a login (a
proxied request). Otherwise `bail!` with a plain message, e.g.
"refused a visit with no login: only this computer's own address is trusted
without one".

**Verify**: `cargo build -q` → exit 0.

### Step 2: Tests

In `mod gate_tests` add:
- no login header, `Host: 127.0.0.1:9010` → `Visit::Local`
- no login header, `Host: localhost` → `Visit::Local`
- no login header, `Host: atlas.example.ts.net` → error
- no login header, `Host: 127.0.0.1:9010`, `X-Forwarded-For: 100.1.2.3` → error

Note the existing `visit()` helper passes only the headers you give it; add
`Host` to the existing cases that expect `Visit::Local` if any now fail.

**Verify**: `cargo test -q -p omicron --lib identity` → all pass, including 4 new tests.

### Step 3: Whole suite

**Verify**: `bash scripts/test.sh` → all pass; `bash scripts/e2e.sh tests/sign-in.spec.js` → all pass.

## Done criteria

- [ ] `cargo build -q` exits 0
- [ ] `cargo test -q -p omicron --lib identity` passes with the 4 new tests
- [ ] `bash scripts/test.sh` passes
- [ ] `bash scripts/e2e.sh tests/sign-in.spec.js` passes
- [ ] Only `crates/omicron/src/identity.rs` (and, if you moved the helper, `web.rs`) changed (`git status`)

## STOP conditions

- `visitor` no longer has a `None => Ok(Visit::Local(...))` arm (drift).
- The browser tests sign in with no `Tailscale-User-Login` header and a
  non-localhost Host (they'd now be refused): report which test and how it
  visits, don't change the tests to work around it.
- Making this work seems to need changes in `web.rs` beyond the helper move.

## Maintenance notes

- Anything new that calls `visitor` must pass a `header` closure that can
  read `Host`.
- Reviewers: check the localhost rule matches `allowed_host`'s exactly
  (ports and `[::1]`).
