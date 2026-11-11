//! End-to-end tests for `omicron sessions` and the Claude Code hooks. A
//! sleeping process stands in for a Claude Code window, and the hooks get
//! the same JSON Claude Code sends them.
//!
//! Runs only when the test Supabase is set up (see `dev/supabase/test.sh`).

use omicron::supa::Supabase;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use uuid::Uuid;

fn admin() -> Option<Supabase> {
    let s = Supabase::from_env().ok()?;
    s.secret_key.as_ref()?;
    Some(s)
}

macro_rules! supabase_or_skip {
    () => {
        match admin() {
            Some(s) => s,
            None => {
                eprintln!("skipped: no test Supabase set up");
                return;
            }
        }
    };
}

fn unique(name: &str) -> String {
    format!("{name}-{}", &Uuid::new_v4().simple().to_string()[..8])
}

fn new_home() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("omicron-test-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

struct Computer {
    home: PathBuf,
    tailscale: Option<PathBuf>,
}

fn person(s: &Supabase, name: &str) -> Computer {
    let home = new_home();
    std::fs::write(
        home.join("config.json"),
        json!({ "supabase_url": s.url, "supabase_key": s.key, "supabase_secret_key": s.secret_key }).to_string(),
    )
    .unwrap();
    let status = home.join("tailscale.json");
    let login = format!("{}@example.com", unique(&name.to_lowercase()));
    std::fs::write(
        &status,
        json!({ "Self": { "UserID": 1 }, "User": { "1": { "LoginName": login, "DisplayName": name } } }).to_string(),
    )
    .unwrap();
    Computer { home, tailscale: Some(status) }
}

/// A registered machine without the secret key. Returns it and its name.
fn machine(s: &Supabase) -> (Computer, String) {
    let home = new_home();
    let name = unique("box");
    let key = s.register_machine(&name, false).unwrap();
    std::fs::write(
        home.join("config.json"),
        json!({ "supabase_url": s.url, "supabase_key": s.key, "machine_key": key.to_string() }).to_string(),
    )
    .unwrap();
    (Computer { home, tailscale: None }, name)
}

fn command(c: &Computer, window: Option<u32>, args: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_omicron"));
    for (k, _) in std::env::vars() {
        if k.starts_with("OMICRON_") {
            cmd.env_remove(k);
        }
    }
    cmd.env("OMICRON_HOME", &c.home);
    if let Some(t) = &c.tailscale {
        cmd.env("OMICRON_TAILSCALE_STATUS", t);
    }
    if let Some(pid) = window {
        cmd.env("OMICRON_CLAUDE_PID", pid.to_string());
    }
    cmd.args(args);
    cmd
}

fn run(c: &Computer, window: Option<u32>, args: &[&str]) -> Output {
    command(c, window, args).output().unwrap()
}

fn ok(c: &Computer, window: Option<u32>, args: &[&str]) -> String {
    let o = run(c, window, args);
    assert!(o.status.success(), "omicron {args:?} failed: {}", String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).to_string()
}

/// Run a hook the way Claude Code does: JSON on stdin. Returns what it
/// printed to stderr (a hook always finishes cleanly).
fn hook(c: &Computer, window: u32, event: &str, input: Value) -> String {
    let mut child = command(c, Some(window), &["hook", event])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input.to_string().as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success(), "a hook must never fail");
    String::from_utf8_lossy(&out.stderr).to_string()
}

/// A stand-in for a Claude Code window: a process that's running.
fn window() -> Child {
    Command::new("sleep").arg("600").spawn().unwrap()
}

fn record(s: &Supabase, project: &str, name: &str) -> Value {
    let rows = s
        .admin_request("GET", &format!("/rest/v1/sessions?name=eq.{name}&select=state,claude_session_id,folder,projects!inner(name)&projects.name=eq.{project}"), None)
        .unwrap();
    rows[0].clone()
}

#[test]
fn a_session_is_recorded_and_follows_clear_close_resume_and_crash() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);

    // Claude Code starts in a window; the session adds itself.
    let mut first = window();
    let a = Uuid::new_v4().to_string();
    let said = hook(&mac, first.id(), "session-start", json!({ "session_id": a, "cwd": "/work/app", "source": "startup" }));
    assert_eq!(said, "");
    assert_eq!(ok(&mac, Some(first.id()), &["sessions", "add", "parser", "--project", &project]).trim(), format!("Added session parser to {project}."));
    let listed = ok(&pat, None, &["sessions", "list", "--project", &project]);
    assert_eq!(listed, format!("parser\t{project}\t{mac_name}\topen\t/work/app\n"));
    assert_eq!(record(&s, &project, "parser")["claude_session_id"], json!(a));

    // /clear: a new Claude conversation in the same window, same session.
    let b = Uuid::new_v4().to_string();
    hook(&mac, first.id(), "session-end", json!({ "session_id": a, "reason": "clear" }));
    assert_eq!(record(&s, &project, "parser")["state"], "open");
    hook(&mac, first.id(), "session-start", json!({ "session_id": b, "cwd": "/work/app", "source": "clear" }));
    assert_eq!(record(&s, &project, "parser")["claude_session_id"], json!(b));

    // Closed normally.
    hook(&mac, first.id(), "session-end", json!({ "session_id": b, "reason": "prompt_input_exit" }));
    assert_eq!(record(&s, &project, "parser")["state"], "closed");
    first.kill().unwrap();
    first.wait().unwrap();

    // `claude --resume` of that conversation in a new window: open again.
    let mut second = window();
    hook(&mac, second.id(), "session-start", json!({ "session_id": b, "cwd": "/work/app2", "source": "resume" }));
    let r = record(&s, &project, "parser");
    assert_eq!((r["state"].as_str(), r["folder"].as_str()), (Some("open"), Some("/work/app2")));

    // The window dies without saying so. The next hook on this machine, from
    // any window, notices.
    second.kill().unwrap();
    second.wait().unwrap();
    let mut other = window();
    hook(&mac, other.id(), "session-start", json!({ "session_id": Uuid::new_v4().to_string(), "cwd": "/tmp", "source": "startup" }));
    assert_eq!(record(&s, &project, "parser")["state"], "gone");
    other.kill().unwrap();

    // A member removes the record.
    assert!(ok(&pat, None, &["sessions", "remove", "parser", "--project", &project]).contains("Removed session parser"));
    assert!(ok(&pat, None, &["sessions", "list", "--project", &project]).starts_with("No sessions yet."));
}

#[test]
fn windows_omicron_doesnt_track_never_reach_supabase() {
    // Settings that would fail if used: nothing listens on port 9.
    let home = new_home();
    std::fs::write(
        home.join("config.json"),
        json!({ "supabase_url": "http://127.0.0.1:9", "supabase_key": "x", "machine_key": format!("omk_{}_x", Uuid::new_v4().simple()) }).to_string(),
    )
    .unwrap();
    let c = Computer { home: home.clone(), tailscale: None };
    let mut w = window();
    let id = Uuid::new_v4().to_string();
    assert_eq!(hook(&c, w.id(), "session-start", json!({ "session_id": id, "cwd": "/x", "source": "startup" })), "");
    assert_eq!(hook(&c, w.id(), "session-end", json!({ "session_id": id, "reason": "other" })), "");
    w.kill().unwrap();
    // Bad input is reported, not fatal.
    assert!(hook(&c, 1, "session-start", json!({})).contains("session_id"));
}

#[test]
fn adding_needs_a_window_omicron_has_heard_from() {
    let s = supabase_or_skip!();
    let (mac, _) = machine(&s);
    let mut w = window();
    let o = run(&mac, Some(w.id()), &["sessions", "add", "x", "--project", "Anything"]);
    assert!(!o.status.success());
    assert!(String::from_utf8_lossy(&o.stderr).contains("setup-claude"), "{}", String::from_utf8_lossy(&o.stderr));
    w.kill().unwrap();
}

#[test]
fn only_the_sessions_machine_can_change_it() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    let (other, other_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    ok(&pat, None, &["machines", "add", &other_name, &project]);
    let mut w = window();
    hook(&mac, w.id(), "session-start", json!({ "session_id": Uuid::new_v4().to_string(), "cwd": "/w", "source": "startup" }));
    ok(&mac, Some(w.id()), &["sessions", "add", "mine", "--project", &project]);

    // The other machine sees it but can't close it: the update matches no rows.
    let key = std::fs::read_to_string(other.home.join("config.json")).unwrap();
    let key: omicron::supa::MachineKey = serde_json::from_str::<Value>(&key).unwrap()["machine_key"].as_str().unwrap().parse().unwrap();
    let login = s.sign_in_machine(&key).unwrap();
    let rows = s.request_as(&login, "PATCH", "/rest/v1/sessions?name=eq.mine", Some(json!({ "state": "closed" }))).unwrap();
    assert_eq!(rows, json!([]));
    assert_eq!(record(&s, &project, "mine")["state"], "open");
    w.kill().unwrap();
}

#[test]
fn a_task_sent_to_a_session_is_handed_over_once() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let mut w = window();
    let claude = Uuid::new_v4().to_string();
    hook(&mac, w.id(), "session-start", json!({ "session_id": claude, "cwd": "/w", "source": "startup" }));
    ok(&mac, Some(w.id()), &["sessions", "add", "parser", "--project", &project]);

    // Nothing sent yet: the Stop hook says nothing, so Claude stops as usual.
    let stop = |m: &Computer| {
        let mut child = command(m, Some(w.id()), &["hook", "stop"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        child.stdin.take().unwrap().write_all(json!({ "session_id": claude, "stop_hook_active": false }).to_string().as_bytes()).unwrap();
        let out = child.wait_with_output().unwrap();
        assert!(out.status.success());
        String::from_utf8_lossy(&out.stdout).to_string()
    };
    assert_eq!(stop(&mac), "");

    ok(&pat, None, &["tasks", "add", &project, "Write the parser"]);
    ok(&pat, None, &["tasks", "add", &project, "Already finished"]);
    ok(&pat, None, &["tasks", "done", &project, "2"]);
    let sent = ok(&pat, None, &["tasks", "send", &project, "1", "parser"]);
    assert!(sent.contains("sent to session parser"), "{sent}");
    ok(&pat, None, &["tasks", "send", &project, "2", "parser"]);

    // At the end of its turn, the session is told, and carries on.
    let out: Value = serde_json::from_str(&stop(&mac)).unwrap();
    assert_eq!(out["decision"], "block");
    let reason = out["reason"].as_str().unwrap();
    assert!(reason.contains(&format!("#1 in {project}: Write the parser")), "{reason}");
    assert!(reason.contains("needs-review"), "{reason}");
    assert!(!reason.contains("Already finished"), "finished tasks aren't handed over: {reason}");
    // Only once.
    assert_eq!(stop(&mac), "");

    // Sent again: new again. This time a new conversation (/clear) gets it
    // when it starts.
    let (other, other_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &other_name, &project]);
    let mut w2 = window();
    hook(&other, w2.id(), "session-start", json!({ "session_id": Uuid::new_v4().to_string(), "cwd": "/w", "source": "startup" }));
    ok(&other, Some(w2.id()), &["sessions", "add", "helper", "--project", &project]);
    ok(&pat, None, &["tasks", "send", &project, "1", "helper"]);
    ok(&pat, None, &["tasks", "send", &project, "1", "parser"]);
    hook(&mac, w.id(), "session-end", json!({ "session_id": claude, "reason": "clear" }));
    let mut child = command(&mac, Some(w.id()), &["hook", "session-start"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(json!({ "session_id": Uuid::new_v4().to_string(), "cwd": "/w", "source": "clear" }).to_string().as_bytes())
        .unwrap();
    let out: Value = serde_json::from_slice(&child.wait_with_output().unwrap().stdout).unwrap();
    assert_eq!(out["hookSpecificOutput"]["hookEventName"], "SessionStart");
    assert!(out["hookSpecificOutput"]["additionalContext"].as_str().unwrap().contains("Write the parser"));

    // Another machine can't take a session's tasks.
    ok(&pat, None, &["tasks", "send", &project, "1", "helper"]);
    ok(&pat, None, &["tasks", "send", &project, "1", "parser"]);
    let key: omicron::supa::MachineKey = serde_json::from_str::<Value>(&std::fs::read_to_string(other.home.join("config.json")).unwrap()).unwrap()
        ["machine_key"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let login = s.sign_in_machine(&key).unwrap();
    let parser_id = s.admin_request("GET", &format!("/rest/v1/sessions?name=eq.parser&select=id,projects!inner(name)&projects.name=eq.{project}"), None).unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let taken = s.request_as(&login, "POST", "/rest/v1/rpc/pick_up_tasks", Some(json!({ "session": parser_id }))).unwrap();
    assert_eq!(taken, json!([]));
    assert!(stop(&mac).contains("Write the parser"));
    w.kill().unwrap();
    w2.kill().unwrap();
}
