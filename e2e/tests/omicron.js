// Start a real `omicron serve` for a test file, with its own settings folder
// and a made-up Tailscale identity for "this machine".
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} isn't set. Run the browser tests with dev/e2e.sh.`);
  return v;
}

function unique(name) {
  return `${name}-${crypto.randomBytes(4).toString("hex")}`;
}

/** A Tailscale status file saying this machine belongs to `login`. */
function tailscaleStatus(dir, login, displayName) {
  const file = path.join(dir, "tailscale-status.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      Self: { HostName: "test", UserID: 1, Online: true },
      User: { 1: { ID: 1, LoginName: login, DisplayName: displayName } },
    }),
  );
  return file;
}

/**
 * Start `omicron serve` on a free port. Returns { url, me, cli, stop }, where
 * `me` is the person this machine belongs to and `cli(...args)` runs the
 * `omicron` command with the same settings.
 */
async function startOmicron() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "omicron-e2e-"));
  const me = { login: `${unique("me")}@example.com`, name: "Pat Example" };
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({
      supabase_url: need("OMICRON_SUPABASE_URL"),
      supabase_key: need("OMICRON_SUPABASE_KEY"),
      supabase_secret_key: need("OMICRON_SUPABASE_SECRET_KEY"),
    }),
  );
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    OMICRON_HOME: home,
    // Claude Code's own folder (transcripts), just for this test machine.
    CLAUDE_CONFIG_DIR: path.join(home, "claude-code"),
    OMICRON_TAILSCALE_STATUS: tailscaleStatus(home, me.login, me.name),
  };

  const child = spawn(need("OMICRON_BIN"), ["serve", "--port", "0"], { env });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const url = await new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`omicron serve didn't start: ${stderr}`)), 10_000);
    child.stdout.on("data", (d) => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${m[1]}`);
      }
    });
    child.on("exit", (code) => reject(new Error(`omicron serve stopped (${code}): ${stderr}`)));
  });
  return {
    url,
    me,
    /** What `omicron serve` has printed to its error output so far. */
    log: () => stderr,
    cli: (...args) => execFileSync(need("OMICRON_BIN"), args, { env, encoding: "utf8" }),
    /**
     * Run a Claude Code hook as if from the window with process id `window`.
     * The hook gets `input` as JSON, like Claude Code sends it.
     */
    hook: (window, event, input) =>
      execFileSync(need("OMICRON_BIN"), ["hook", event], {
        env: { ...env, OMICRON_CLAUDE_PID: String(window) },
        input: JSON.stringify(input),
        encoding: "utf8",
      }),
    /** Any `omicron` command, run from inside the window with process id `window`. */
    cliIn: (window, ...args) =>
      execFileSync(need("OMICRON_BIN"), args, {
        env: { ...env, OMICRON_CLAUDE_PID: String(window) },
        encoding: "utf8",
      }),
    /** `omicron sessions add` from inside the window with process id `window`. */
    addSession: (window, name, project) =>
      execFileSync(need("OMICRON_BIN"), ["sessions", "add", name, "--project", project], {
        env: { ...env, OMICRON_CLAUDE_PID: String(window) },
        encoding: "utf8",
      }),
    /**
     * Start this machine's daemon, with a stand-in for `claude` on its PATH
     * (it runs the start hook as Claude Code does, then waits). Resolves
     * once it's listening; call `stop()` on what it returns.
     */
    daemon: () => startDaemon(home, env),
    /** Write Claude Code's transcript for a conversation, as Claude Code does. */
    transcript: (claudeId) => {
      const dir = path.join(home, "claude-code", "projects", "work");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${claudeId}.jsonl`), "");
    },
    /** A folder on this machine for a session to work in. */
    folder: () => fs.mkdtempSync(path.join(home, "work-")),
    stop: () => {
      child.kill();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

function startDaemon(home, env) {
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, "claude"),
    [
      "#!/bin/sh",
      'id=; source=startup',
      'while [ $# -gt 0 ]; do case "$1" in --session-id) id="$2"; shift;; --resume) id="$2"; source=resume; shift;; esac; shift; done',
      'mkdir -p "$CLAUDE_CONFIG_DIR/projects/work" && touch "$CLAUDE_CONFIG_DIR/projects/work/$id.jsonl"',
      `printf '{"session_id":"%s","cwd":"%s","source":"%s"}' "$id" "$PWD" "$source" | "${need("OMICRON_BIN")}" hook session-start`,
      "exec cat",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const child = spawn(need("OMICRON_BIN"), ["daemon"], { env: { ...env, PATH: `${bin}:${env.PATH}` } });
  let stderr = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the daemon didn't start: ${stderr}`)), 15_000);
    child.stderr.on("data", (d) => {
      stderr += d;
      if (stderr.includes("is listening for changes")) {
        clearTimeout(timer);
        resolve({ log: () => stderr, stop: () => child.kill() });
      }
    });
    child.stdout.resume();
    child.on("exit", (code) => reject(new Error(`the daemon stopped (${code}): ${stderr}`)));
  });
}

/** A running process to stand in for a Claude Code window. Kill it when done. */
function fakeWindow() {
  return spawn("sleep", ["600"]);
}

/** A Supabase login for `login`, as the Web Machine hands one out. */
async function sessionFor(request, omicron, login, name) {
  const res = await request.post(`${omicron.url}/api/session`, {
    headers: { "tailscale-user-login": login, "tailscale-user-name": name },
  });
  if (!res.ok()) throw new Error(`no session for ${login}: ${await res.text()}`);
  return res.json();
}

/** Call Supabase's REST API as the person in `session`. */
async function rest(request, session, method, path, data) {
  const res = await request.fetch(`${need("OMICRON_SUPABASE_URL")}${path}`, {
    method,
    headers: {
      apikey: need("OMICRON_SUPABASE_KEY"),
      Authorization: `Bearer ${session.access_token}`,
      Prefer: "return=representation",
    },
    data,
  });
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
  return res.json();
}

/**
 * Make requests to the omicron server look like they came through
 * `tailscale serve`. Only requests to omicron get the headers, not the ones
 * the page makes to Supabase.
 */
async function visitAs(page, omicron, login, name) {
  await page.route(`${omicron.url}/**`, (route) =>
    route.continue({
      headers: { ...route.request().headers(), "tailscale-user-login": login, "tailscale-user-name": name },
    }),
  );
}

module.exports = { startOmicron, unique, need, sessionFor, rest, visitAs, fakeWindow };
