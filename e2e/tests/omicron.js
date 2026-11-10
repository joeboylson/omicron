// Start a real `omicron serve` for a test file, with its own settings folder
// and a made-up Tailscale identity for "this machine".
const { spawn } = require("node:child_process");
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
 * Start `omicron serve` on a free port. Returns { url, me, stop }, where `me`
 * is the person this machine belongs to.
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
    stop: () => {
      child.kill();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

module.exports = { startOmicron, unique, need };
