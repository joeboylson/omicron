# Omicron

One tool for tasks, Projects and Claude sessions, shared by people and
machines. A task board (like Trello) that people and Claude Code sessions use
together, plus what it takes to run Claude: sessions you can jump into,
handing tasks to them, loops, machines and Claude accounts.

There's no central server. Every computer runs its own copy of `omicron` and
talks straight to one Supabase database, which is yours. People sign in with
their Tailscale identity; each machine has its own API key.

What it is and how it's built: `CLAUDE.md`. The words it uses: `DEFINITIONS.txt`.

## Setting it up

You need:

- A **Supabase** project (supabase.com, or self-hosted).
- **Tailscale** on every computer, with the people who'll use it on your tailnet.
- To build it: **Rust** (rustup.rs; open a new terminal after, so `cargo` is
  on your `PATH`), **Node 20+**, and **psql** (`brew install libpq`, or
  `apt install postgresql-client`).
- For Claude sessions: **Claude Code** (`claude`) on the machines that run them.

### 1. The database

In Supabase, open **Project Settings**, and note:

- the **Project URL** and the **publishable** (anon) key, under API;
- the **secret** (service_role) key, under API: only the Web Machine gets it;
- the **connection string**, under Database.

Then make Omicron's tables (run it again after updating Omicron; it only
applies what's new). On self-hosted Supabase, port 5432 is its connection
pooler, which wants the user as `postgres.<POOLER_TENANT_ID>` (from its
`.env`):

```sh
bash scripts/migrate.sh "postgresql://postgres:<password>@<host>:5432/postgres"
```

### 2. Build and install

```sh
bash dev/build.sh                                  # prints the program's path
install -m 755 target/release/omicron ~/.local/bin/omicron
```

Make sure `~/.local/bin` is on your `PATH`.

### 3. The Web Machine (shows the web page)

Pick one computer to serve the web page. It's the only one with the secret
key, since it signs people in and makes API keys.

```sh
omicron setup --url https://<project>.supabase.co --key <publishable key> --secret-key <secret key>
omicron machines register <its name> --all-projects   # its own API key, saved here
omicron serve --port 8787                              # the web page, on this computer only
tailscale serve --bg 8787                              # on your tailnet, with people's identity
```

Open `https://<this computer's Tailscale name>` from any device on your
tailnet. You're signed in as your Tailscale login. Start a Project with **+**.

Visits from this computer itself sign in as the person who owns it in
Tailscale. If anything else runs on this computer (VMs, containers), put a
secret in `~/.omicron/gate-secret` and have whatever sits in front of the page
send it as the `Omicron-Gate-Secret` header; then logins that don't carry it
are refused.

### 4. Every other computer

On the Web Machine, make a key for it: **Settings › API keys › +** on the web
page (pick its Projects), or `omicron machines register <name> --print`.
Then on the new computer:

```sh
omicron setup --url https://<project>.supabase.co --key <publishable key>
omicron machines use-key <the key>
omicron daemon start-at-login     # shows it as awake; runs Dispatch and loops
```

On any computer, `omicron doctor` lists what's set up and what isn't, with
the command for each missing piece.

### 5. Claude sessions

On a machine that's in a Project:

```sh
omicron open parser --project <Project> --folder ~/code/app
```

That records the session and starts Claude Code right here in your
terminal, with Omicron's hooks and add-on. `omicron open parser` later
picks the same conversation back up, and `omicron sessions pick` lists them
all. Give it a task from the web page and press **Dispatch**: the add-on
puts it into the window as if you'd typed it (once Claude is free), or the
task waits until the session is next opened. Loops and `omicron sessions
send` arrive the same way.

Already in a Claude conversation you started with plain `claude`? Quit it
and run `omicron open <name> --resume <its session id>`.

Claude Code options for every session, like `["--permission-mode",
"auto"]`, go in `claude_args` in `~/.omicron/config.json`.

### Everyday commands

`omicron --help` lists everything; the command can do all the web page can.

```sh
omicron tasks list <Project>             # the board, by status (--by-topic for rows)
omicron tasks add <Project> "Fix the gate" --label outside
omicron tasks mine                       # inside a session: its tasks
omicron loops start "Keep going" --every 15m --times 10   # inside a session
omicron machines pick                    # ssh to another awake machine
```

## Developing

See `CLAUDE.md` ("Running tests"). `scripts/test.sh` and `scripts/e2e.sh`
run the tests against the Supabase in `~/.omicron/config.json`, in their own
throwaway people, machines and Projects, and clean them up afterwards; your
own Projects are never touched.
