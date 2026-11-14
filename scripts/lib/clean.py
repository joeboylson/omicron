"""Clean up what a test run made in the hosted Supabase, through its admin
(service_role) key. Only things that are plainly a test's are removed:
  - Projects made since the run started whose members are all test people
    (or that have none), never one called Omicron;
  - test people made since then (every Tailscale login of theirs ends in
    @example.com);
  - test machines made since then (names ending in a random code, like
    box-1a2b3c4d);
  - comment images filed under Projects that no longer exist.
    python3 scripts/lib/clean.py <since, like 2026-11-12T18:00:00Z>
"""
import json, os, re, sys, urllib.request, urllib.parse

since = sys.argv[1]
cfg = json.load(open(os.path.expanduser(os.environ.get("OMICRON_CONFIG", "~/.omicron/config.json"))))
URL, KEY = cfg["supabase_url"], cfg["supabase_secret_key"]
H = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"}

def call(method, path, body=None):
    req = urllib.request.Request(URL + path, data=None if body is None else json.dumps(body).encode(), method=method, headers=H)
    with urllib.request.urlopen(req) as r:
        t = r.read()
        return json.loads(t) if t else None

def get_all(path):
    out, offset = [], 0
    while True:
        page = call("GET", f"{path}&offset={offset}&limit=1000")
        out += page
        if len(page) < 1000:
            return out
        offset += 1000

q = urllib.parse.quote(since)
test_login = lambda logins: logins and all(l.endswith("@example.com") for l in logins)

people = get_all(f"/rest/v1/people?created_at=gte.{q}&select=id,tailscale_identities(login)")
test_people = {p["id"] for p in people if test_login([i["login"] for i in p["tailscale_identities"]])}

projects = get_all(f"/rest/v1/projects?created_at=gte.{q}&select=id,name,project_members(person_id)")
gone = 0
for p in projects:
    members = {m["person_id"] for m in p["project_members"]}
    if p["name"] != "Omicron" and members <= test_people:
        call("DELETE", f"/rest/v1/projects?id=eq.{p['id']}")
        gone += 1

machines = get_all(f"/rest/v1/machines?created_at=gte.{q}&select=id,name")
# The made-up machines of scripts/shots.sh (dev/seed/seed.js) have plain
# names; only ones made during the run are taken.
SEED_MACHINES = {"mac-mini", "studio", "build-box", "this-mac"}
test_machines = [m["id"] for m in machines if re.search(r"-[0-9a-f]{4,32}$", m["name"]) or m["name"] in SEED_MACHINES]

users = 0
for uid in list(test_people) + test_machines:
    try:
        call("DELETE", f"/auth/v1/admin/users/{uid}")
        users += 1
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

# Images under Projects that are gone.
ids = {p["id"] for p in get_all("/rest/v1/projects?select=id")}
folders = call("POST", "/storage/v1/object/list/comment-images", {"prefix": "", "limit": 1000})
files = 0
for f in folders:
    if re.fullmatch(r"[0-9a-f-]{36}", f["name"]) and f["name"] not in ids:
        inner = call("POST", "/storage/v1/object/list/comment-images", {"prefix": f["name"], "limit": 1000})
        names = [f"{f['name']}/{x['name']}" for x in inner]
        if names:
            call("DELETE", "/storage/v1/object/comment-images", {"prefixes": names})
            files += len(names)

print(f"test.sh: cleaned up what the run made since {since}: {gone} Projects, {users} test logins, {files} images")
