# Domain docs

How the engineering skills should read this repo's domain documentation.
Single-context: one glossary and one set of decisions for the whole repo.

## Before exploring, read these

- **`DEFINITIONS.txt`** at the repo root: Omicron's glossary. `GLOSSARY.md`
  only points here. Use these names and no others (CLAUDE.md says so).
- **`ref/BRAINSTORM.md`**: the decisions made so far and why, newest
  sections first by topic. Treat a decided item there like an ADR.
- **`docs/adr/`**: decision records written from now on (one file per
  decision, `NNNN-<slug>.md`).
- **`ref/TEAMS.md`** when the work touches teams.

## Use the glossary's vocabulary

When output names a domain concept (a task title, a refactor proposal, a
test name), use the term as `DEFINITIONS.txt` defines it, and none of the
words it says not to use (like "workspace" for Folder, or "lock" for the
gate).

A new term that's really needed: add it to `DEFINITIONS.txt` in its own
format (the word on its own line, its meaning indented below), not to
`GLOSSARY.md`.

## Flag decision conflicts

If output contradicts a decision in `ref/BRAINSTORM.md` or `docs/adr/`, say
so rather than silently overriding:

> _Goes against "The gate" (ref/BRAINSTORM.md), but worth reopening because…_
