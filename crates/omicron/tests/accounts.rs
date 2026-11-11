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
    run_with(h, args, &[])
}

fn run_with(h: &Home, args: &[&str], env: &[(&str, &str)]) -> (bool, String, String) {
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
        .envs(env.iter().copied())
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
    let in_an_hour = (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() + 3_600_000) as i64;
    c["claudeAiOauth"] = json!({ "accessToken": token, "refreshToken": format!("r-{token}"), "expiresAt": in_an_hour });
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

/// A stand-in for Anthropic's usage endpoint: answers by token.
fn fake_usage() -> (String, std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, Value>>>) {
    use std::sync::{Arc, Mutex};
    let answers: Arc<Mutex<std::collections::HashMap<String, Value>>> = Arc::default();
    let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
    let url = format!("http://{}/usage", server.server_addr().to_ip().unwrap());
    let a = answers.clone();
    std::thread::spawn(move || {
        for req in server.incoming_requests() {
            let token = req
                .headers()
                .iter()
                .find(|h| h.field.equiv("Authorization"))
                .map(|h| h.value.as_str().trim_start_matches("Bearer ").to_string())
                .unwrap_or_default();
            let body = a.lock().unwrap().get(&token).cloned();
            let _ = match body {
                Some(b) => req.respond(tiny_http::Response::from_string(b.to_string())),
                None => req.respond(tiny_http::Response::from_string("{}").with_status_code(401)),
            };
        }
    });
    (url, answers)
}

fn usage(five: f64, five_reset_mins: i64, weekly: f64) -> Value {
    let at = |mins: i64| (chrono::Utc::now() + chrono::Duration::minutes(mins)).to_rfc3339();
    json!({ "five_hour": { "utilization": five, "resets_at": at(five_reset_mins) }, "seven_day": { "utilization": weekly, "resets_at": at(3 * 1440) } })
}

#[test]
fn it_switches_on_its_own_at_a_limit_and_back_when_it_resets() {
    let h = new_home();
    let (url, answers) = fake_usage();
    let go = |args: &[&str]| {
        let (good, out, err) = run_with(&h, args, &[("OMICRON_USAGE_URL", url.as_str())]);
        assert!(good, "omicron {args:?} failed: {err}");
        out
    };
    log_in(&h, "a", "joe@personal.example", "P1");
    go(&["accounts", "add", "personal"]);
    log_in(&h, "b", "joe@work.example", "W1");
    go(&["accounts", "add", "work"]);
    go(&["accounts", "use", "personal"]);
    assert!(go(&["accounts", "auto", "on", "--primary", "personal", "--secondary", "work", "--five-hour", "90"]).starts_with("On: from personal to work at 90%"));

    answers.lock().unwrap().insert("P1".into(), usage(40.0, 120, 20.0));
    answers.lock().unwrap().insert("W1".into(), usage(5.0, 120, 10.0));
    assert_eq!(go(&["accounts", "auto", "check"]).trim(), "Nothing to do.");
    let shown = go(&["accounts", "usage"]);
    assert!(shown.contains("personal (in use)\n  5-hour  [####......]  40%  resets in 1h 59m"), "{shown}");

    // Personal reaches the limit: over to work.
    answers.lock().unwrap().insert("P1".into(), usage(95.0, 120, 20.0));
    assert_eq!(go(&["accounts", "auto", "check"]).trim(), "Switched Claude Code to work: 5-hour limit at 95%.");
    assert_eq!(tokens(&h), "W1");

    // Personal's window resets: back to personal.
    answers.lock().unwrap().insert("P1".into(), usage(95.0, -1, 20.0));
    assert_eq!(go(&["accounts", "auto", "check"]).trim(), "Switched Claude Code to personal: personal is free again.");
    assert_eq!(tokens(&h), "P1");

    // Picked by hand: held there, even at a limit, until resume.
    answers.lock().unwrap().insert("P1".into(), usage(99.0, 120, 20.0));
    assert!(go(&["accounts", "use", "personal"]).contains("stays on personal until"));
    assert_eq!(go(&["accounts", "auto", "check"]).trim(), "Nothing to do.");
    go(&["accounts", "resume"]);
    assert!(go(&["accounts", "auto", "check"]).contains("Switched Claude Code to work"));
}
