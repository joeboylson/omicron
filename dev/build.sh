#!/usr/bin/env bash
# Build the `omicron` program with the web page inside, for running for
# real (not the tests). Works on the Mac or in the test machine:
#   bash dev/build.sh
# Prints the path of the program it built.
set -euo pipefail
cd "$(dirname "$0")/.."
(
  cd web
  [ -d node_modules ] && [ node_modules -nt package.json ] || { npm install --silent --no-audit --no-fund && touch node_modules; }
  npx --no-install tsc --noEmit
  OMICRON_WEB_OUT="$PWD/dist" npx --no-install vite build --logLevel warn
) >&2
OMICRON_WEB_DIST="$PWD/web/dist" cargo build --release -q
echo "${CARGO_TARGET_DIR:-$PWD/target}/release/omicron"
