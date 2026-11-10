#!/usr/bin/env bash
# Set up the omicron-dev test VM. Run inside the VM:
#   bash ~/omicron/dev/vm/setup.sh
# Create the VM on the Mac first:
#   multipass launch 24.04 --name omicron-dev --cpus 2 --memory 2G --disk 10G
#   multipass mount "$PWD" omicron-dev:/home/ubuntu/omicron
set -euo pipefail

sudo apt-get update -q
sudo apt-get install -y -q build-essential pkg-config libssl-dev curl git

if ! command -v cargo >/dev/null && [ ! -x "$HOME/.cargo/bin/cargo" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi

# Build output stays on the VM's own disk: the mounted folder is slow and
# shouldn't fill up with build files.
grep -q CARGO_TARGET_DIR "$HOME/.bashrc" || echo 'export CARGO_TARGET_DIR=$HOME/target' >> "$HOME/.bashrc"

echo "omicron-dev ready: $("$HOME/.cargo/bin/cargo" --version)"
