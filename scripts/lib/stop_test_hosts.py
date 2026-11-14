"""Stop the background programs a test run left going: session hosts
(`omicron sessions host-run`, with the stand-in Claude inside) and daemons
started by this repo's test build since the run began. The real ones run
from ~/.local/bin/omicron and are never touched; nor is anything started
before the run (another run going at the same time).

    python3 stop_test_hosts.py <repo> <since, UTC like 2026-11-13T21:55:50Z>
"""

import datetime
import os
import signal
import subprocess
import sys

repo, since = os.path.realpath(sys.argv[1]), sys.argv[2]
since = datetime.datetime.strptime(since, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
test_builds = [os.path.join(repo, "target", kind, "omicron") for kind in ("debug", "release")]

out = subprocess.run(["ps", "-A", "-o", "pid=,lstart=,command="], capture_output=True, text=True, env={**os.environ, "LC_ALL": "C", "TZ": "UTC"}).stdout
stopped = 0
for line in out.splitlines():
    parts = line.split()
    if len(parts) < 7:
        continue
    pid, started, command = int(parts[0]), " ".join(parts[1:6]), parts[6:]
    if not command or command[0] not in test_builds:
        continue
    if not ("host-run" in command or command[1:2] == ["daemon"]):
        continue
    try:
        when = datetime.datetime.strptime(started, "%a %b %d %H:%M:%S %Y").replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        continue
    if when < since - datetime.timedelta(seconds=5):
        continue
    try:
        os.kill(pid, signal.SIGTERM)
        stopped += 1
    except ProcessLookupError:
        pass
if stopped:
    print(f"test.sh: stopped {stopped} session hosts and daemons the tests left running", file=sys.stderr)
