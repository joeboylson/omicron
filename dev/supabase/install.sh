#!/usr/bin/env bash
# Install and start a self-hosted Supabase inside the omicron-dev VM.
# Run inside the VM:
#   bash ~/omicron/dev/supabase/install.sh
#
# Uses Supabase's own setup script, which clones docker/ from the latest
# self-hosted release, writes .env, and makes every secret and API key.
# The stack lives on the VM's own disk at ~/supabase, never in the mounted
# folder: its database files and secrets must not land in the repo.
set -euo pipefail

if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
sudo apt-get install -y -q jq openssl >/dev/null

if [ ! -f "$HOME/supabase/.env" ]; then
  rm -rf "$HOME/supabase"
  setup=$(mktemp)
  curl -fsSL https://raw.githubusercontent.com/supabase/supabase/master/docker/setup.sh -o "$setup"
  (cd "$HOME" && sh "$setup" -y --skip-deps --project-dir supabase)
  rm -f "$setup"
fi

cd "$HOME/supabase"
sudo docker compose pull -q
sudo sh run.sh start
sudo docker compose ps --format 'table {{.Service}}\t{{.Status}}'
