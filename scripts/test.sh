#!/usr/bin/env bash
# Run the Rust tests against the test Supabase (scripts/test.conf: the
# tests' own one on this Mac by default), then clean up everything the run
# made (scripts/lib/clean.py). Tests make their own
# throwaway people, machines and Projects (people log in as
# <name>-<random>@example.com), so the Omicron Project is never touched.
#   bash scripts/test.sh                    every Rust test
#   bash scripts/test.sh --test sessions    one test file (cargo test arguments)
#   bash scripts/test.sh --clean-only       just clean up (after an interrupted run)
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/test-run.sh

if [ "${1:-}" = "--clean-only" ]; then
  clean "${2:?say since when, like 2026-11-12T18:00:00Z}"
  exit 0
fi

start_test_run
cargo test "$@"
