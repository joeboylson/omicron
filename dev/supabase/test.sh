#!/usr/bin/env bash
# Run every test, including the ones that need Supabase. Run inside the VM:
#   bash ~/omicron/dev/supabase/test.sh [cargo test args]
set -euo pipefail
env_value() { grep -E "^$1=" "$HOME/supabase/.env" | head -1 | cut -d= -f2-; }
export OMICRON_SUPABASE_URL=http://localhost:8000
export OMICRON_SUPABASE_KEY=$(env_value ANON_KEY)
export OMICRON_SUPABASE_SECRET_KEY=$(env_value SERVICE_ROLE_KEY)
export CARGO_TARGET_DIR=$HOME/target
# Linking many test programs at once can run the machine out of memory
# (the linker gets killed); two at a time is enough.
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
# Lets tests talk to the database directly, to set up cases the API can't
# (like a save that's held open). Only on the test VM.
export OMICRON_TEST_PSQL="sudo docker compose -f $HOME/supabase/docker-compose.yml exec -T db psql -U postgres -q -v ON_ERROR_STOP=1"
cd "$HOME/omicron"
"$HOME/.cargo/bin/cargo" test "$@"
