#!/usr/bin/env bash
# Make the omicron-dev test machine as a Docker container. Run on the Mac:
#   bash dev/docker/setup.sh
# Then use it the way you'd use the multipass VM:
#   docker exec -u ubuntu omicron-dev bash /home/ubuntu/omicron/dev/supabase/install.sh
#
# The container uses the Docker host's network and Docker itself, so Supabase
# runs next to it (not inside it) and is at localhost:8000 from inside.
# Supabase's files live at /home/ubuntu/supabase on the Docker host and are
# mounted at that same path, because Docker resolves Supabase's own file
# mounts on the host.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)

docker build -q -t omicron-dev "$here"
docker rm -f omicron-dev >/dev/null 2>&1 || true
docker run -d --name omicron-dev --hostname omicron-dev --add-host omicron-dev:127.0.0.1 --network host \
  -v "$repo":/home/ubuntu/omicron \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /home/ubuntu/supabase:/home/ubuntu/supabase \
  -v omicron-dev-target:/home/ubuntu/target \
  -v omicron-dev-cargo:/home/ubuntu/.cargo/registry \
  -v omicron-dev-e2e:/home/ubuntu/omicron-e2e-deps \
  omicron-dev >/dev/null
docker exec -u root omicron-dev chown ubuntu:ubuntu /home/ubuntu/supabase /home/ubuntu/target \
  /home/ubuntu/.cargo/registry /home/ubuntu/omicron-e2e-deps
echo "omicron-dev ready: $(docker exec -u ubuntu omicron-dev /home/ubuntu/.cargo/bin/cargo --version)"
