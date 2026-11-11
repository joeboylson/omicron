//! End-to-end tests for `omicron accounts`, against a made-up Claude Code
//! home folder (never the real one). Uses the files Claude Code uses on
//! Linux; the Keychain is switched off.

use serde_json::{json, Value};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

struct Home {
    omicron: PathBuf,
    claude: PathBuf,
}

fn new_home() -> Home {
    let root = std::env::temp_dir().join(format!("omicron-accounts-{}", Uuid::new_v4().simple()));
    let h = Home { omicron: root.join("omicron"), claude: root.join("claude") };
    std::fs::create_dir_all(h.claude.join(".claude")).unwrap();
    h
}

fn run(h: &Home, args: &[&str]) -> (bool, String, String) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_omicron"));
    for (k, _) in std::env::vars() {
        if k.starts_with("OMICRON_") {
            cmd.env_remove(k);
        }
    }
    let out = cmd
        .env("OMICRON_HOME", &h.omicron)
        .env("OMICRON_CLAUDE_HOME", &h.claude)
        .env("OMICRON_KEYCHAIN", "off")
        .args(args)
        .output()
        .unwrap();
    (out.status.success(), String::from_utf8_lossy(&out.stdout).into(), String::from_utf8_lossy(&out.stderr).into())
}

fn ok(h: &Home, args: &[&str]) -> String {
    let (good, out, err) = run(h, args);
    assert!(good, "omicron {args:?} failed: {err}");
    out
}

fn read(p: &Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn write(p: &Path, v: Value) {
    std::fs::write(p, v.to_string()).unwrap();
}

/// Claude Code logging in as someone: what /login writes.
fn log_in(h: &Home, id: &str, email: &str, token: &str) {
    let creds = h.claude.join(".claude/.credentials.json");
    let mut c = if creds.exists() { read(&creds) } else { json!({ "mcpOAuth": { "github": "kept" } }) };
    c["claudeAiOauth"] = json!({ "accessToken": token, "refreshToken": format!("r-{token}") });
    write(&creds, c);
    std::fs::set_permissions(&creds, std::fs::Permissions::from_mode(0o600)).unwrap();
    let config = h.claude.join(".claude.json");
    let mut c = if config.exists() { read(&config) } else { json!({ "theme": "dark", "projects": { "x": 1 } }) };
    c["oauthAccount"] = json!({ "accountUuid": id, "emailAddress": email });
    write(&config, c);
}

fn tokens(h: &Home) -> String {
    read(&h.claude.join(".claude/.credentials.json"))["claudeAiOauth"]["accessToken"].as_str().unwrap().to_string()
}

#[test]
fn accounts_are_saved_and_switched_keeping_everything_else() {
    let h = new_home();
    assert!(ok(&h, &["accounts", "list"]).starts_with("No saved accounts yet."));

    log_in(&h, "a", "joe@personal.example", "P1");
    assert_eq!(ok(&h, &["accounts", "add", "personal"]).trim(), "Saved joe@personal.example as personal.");
    log_in(&h, "b", "joe@work.example", "W1");
    assert!(ok(&h, &["accounts", "list"]).contains("isn't saved"));
    ok(&h, &["accounts", "add", "work"]);
    let (good, _, err) = run(&h, &["accounts", "add", "again"]);
    assert!(!good && err.contains("already saved as work"), "{err}");

    // Claude Code renews the work tokens while it's in use.
    log_in(&h, "b", "joe@work.example", "W2");

    assert_eq!(ok(&h, &["accounts", "use", "personal"]).trim(), "Claude Code is now on personal (joe@personal.example).");
    assert_eq!(tokens(&h), "P1");
    let config = read(&h.claude.join(".claude.json"));
    assert_eq!(config["oauthAccount"]["accountUuid"], "a");
    assert_eq!((config["theme"].as_str(), config["projects"]["x"].as_i64()), (Some("dark"), Some(1)), "other settings stay");
    let creds_path = h.claude.join(".claude/.credentials.json");
    assert_eq!(read(&creds_path)["mcpOAuth"]["github"], "kept", "MCP logins stay");
    assert_eq!(std::fs::metadata(&creds_path).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(
        ok(&h, &["accounts", "list"]),
        "personal\tjoe@personal.example  (in use)\nwork\tjoe@work.example\n"
    );

    // Back to work: the renewed tokens were kept, not the stale ones.
    ok(&h, &["accounts", "use", "work"]);
    assert_eq!(tokens(&h), "W2");

    let saved = h.omicron.join("accounts/work.json");
    assert_eq!(std::fs::metadata(&saved).unwrap().permissions().mode() & 0o777, 0o600, "saved logins are private");
    assert!(!run(&h, &["accounts", "use", "nope"]).0);
    assert!(!run(&h, &["accounts", "add", "../evil"]).0, "names can't be paths");
    ok(&h, &["accounts", "remove", "personal"]);
    assert_eq!(ok(&h, &["accounts", "list"]), "work\tjoe@work.example  (in use)\n");
    assert_eq!(tokens(&h), "W2", "removing a saved account leaves Claude Code alone");
}

#[test]
fn adding_needs_claude_code_logged_in() {
    let h = new_home();
    let (good, _, err) = run(&h, &["accounts", "add", "personal"]);
    assert!(!good && err.contains("isn't logged in"), "{err}");
}
