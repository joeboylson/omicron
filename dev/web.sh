#!/usr/bin/env bash
# Build the web page inside the omicron-dev test machine:
#   bash ~/omicron/dev/web.sh
# Prints the folder it built into. Point OMICRON_WEB_DIST at that folder when
# building `omicron` to put the page inside it (see crates/omicron/build.rs).
# The page's source is copied to the machine's own disk first, so
# node_modules never lands in the mounted folder.
set -euo pipefail
src=$HOME/omicron/web
work=$HOME/omicron-web
mkdir -p "$work"
# Fresh copy each time (so deleted files go too), keeping node_modules.
find "$work" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
tar -C "$src" --exclude=./node_modules --exclude=./dist -cf - . | tar -C "$work" -xf -
cd "$work"
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install --silent --no-audit --no-fund >&2
  touch node_modules
fi
export OMICRON_WEB_OUT=$HOME/omicron-web-dist
npx --no-install tsc --noEmit >&2
npx --no-install vite build --logLevel warn >&2
echo "$OMICRON_WEB_OUT"
