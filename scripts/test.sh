#!/usr/bin/env bash
# Run the Rust tests on this Mac against Omicron's one Supabase (the real
# one, in Colima), then clean up everything the run made. Tests make their
# own throwaway people, machines and Projects (people log in as
# <name>-<random>@example.com), so the Omicron Project is never touched.
#   bash scripts/test.sh                    every Rust test
#   bash scripts/test.sh --test sessions    one test file (cargo test arguments)
#   bash scripts/test.sh --clean-only       just clean up (after an interrupted run)
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/lib/test-run.sh

if [ "${1:-}" = "--clean-only" ]; then
  clean "${2:?say since when, like '2026-11-11 16:00'}"
  exit 0
fi

start_test_run
cargo test "$@"
