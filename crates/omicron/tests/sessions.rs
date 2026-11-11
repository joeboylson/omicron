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
fn a_session_gets_its_tasks_only_when_told() {
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

    // Sessions don't start tasks on their own: the end of a turn, and a new
    // conversation, say nothing about it.
    assert_eq!(stop(&mac), "", "the end of a turn doesn't hand tasks over");
    hook(&mac, w.id(), "session-end", json!({ "session_id": claude, "reason": "clear" }));
    let mut child = command(&mac, Some(w.id()), &["hook", "session-start"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(json!({ "session_id": Uuid::new_v4().to_string(), "cwd": "/w", "source": "clear" }).to_string().as_bytes())
        .unwrap();
    assert_eq!(String::from_utf8_lossy(&child.wait_with_output().unwrap().stdout), "", "nor does a new conversation");

    // Told to get its tasks: it gets the open ones, new ones marked.
    let mine = ok(&mac, Some(w.id()), &["tasks", "mine"]);
    assert!(mine.contains(&format!("#1 in {project}: Write the parser (new)")), "{mine}");
    assert!(mine.contains("comment") && mine.contains("--review"), "{mine}");
    // With how to write the report.
    assert!(mine.contains("No jargon and no made-up terms") && mine.contains("At most 500 words"), "{mine}");
    // A report over 500 words is refused, and nothing is saved.
    let long = vec!["word"; 501].join(" ");
    let o = run(&mac, Some(w.id()), &["tasks", "comment", &project, "1", &long, "--review"]);
    assert!(!o.status.success() && String::from_utf8_lossy(&o.stderr).contains("at most 500 words; this one is 501"));
    assert!(!mine.contains("Already finished"), "finished tasks aren't listed: {mine}");
    // Asked again: still its task, no longer new.
    let again = ok(&mac, Some(w.id()), &["tasks", "mine"]);
    assert!(again.contains(&format!("#1 in {project}: Write the parser\n")), "{again}");
    // Outside a tracked session there's no "mine".
    assert!(!run(&mac, None, &["tasks", "mine"]).status.success());

    // Given to another session and back: new again.
    let (other, other_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &other_name, &project]);
    let mut w2 = window();
    hook(&other, w2.id(), "session-start", json!({ "session_id": Uuid::new_v4().to_string(), "cwd": "/w", "source": "startup" }));
    ok(&other, Some(w2.id()), &["sessions", "add", "helper", "--project", &project]);
    ok(&pat, None, &["tasks", "send", &project, "1", "helper"]);
    assert!(ok(&mac, Some(w.id()), &["tasks", "mine"]).starts_with("Nothing is given to this session"));
    ok(&pat, None, &["tasks", "send", &project, "1", "parser"]);
    assert!(ok(&mac, Some(w.id()), &["tasks", "mine"]).contains("Write the parser (new)"));

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
    assert!(ok(&mac, Some(w.id()), &["tasks", "mine"]).contains("Write the parser (new)"));
    w.kill().unwrap();
    w2.kill().unwrap();
}

#[test]
fn a_session_reports_on_its_task_and_a_person_answers() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let mut w = window();
    hook(&mac, w.id(), "session-start", json!({ "session_id": Uuid::new_v4().to_string(), "cwd": "/w", "source": "startup" }));
    ok(&mac, Some(w.id()), &["sessions", "add", "parser", "--project", &project]);
    ok(&pat, None, &["tasks", "add", &project, "Write the parser"]);

    // The session reports, from inside its window, and asks for review.
    let shown = ok(&mac, Some(w.id()), &["tasks", "comment", &project, "1", "Done: parser plus 12 tests.", "--review"]);
    assert!(shown.contains("needs review"), "{shown}");
    assert!(shown.contains(&format!("{mac_name} (session parser), ")), "{shown}");
    assert!(shown.contains(": Done: parser plus 12 tests."), "{shown}");

    // Pat answers and takes the mark off.
    ok(&pat, None, &["tasks", "comment", &project, "1", "Looks good."]);
    ok(&pat, None, &["tasks", "reviewed", &project, "1"]);
    let shown = ok(&pat, None, &["tasks", "show", &project, "1"]);
    let lines: Vec<&str> = shown.lines().filter(|l| l.contains(": Done:") || l.contains("Looks good")).collect();
    assert_eq!(lines.len(), 2, "{shown}");
    assert!(lines[0].contains("session parser") && lines[1].starts_with("  Pat, "), "{shown}");
    assert!(!shown.contains("needs review"), "{shown}");

    // A machine can't sign a comment as another machine's session.
    let (other, other_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &other_name, &project]);
    let key: omicron::supa::MachineKey = serde_json::from_str::<Value>(&std::fs::read_to_string(other.home.join("config.json")).unwrap()).unwrap()
        ["machine_key"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let login = s.sign_in_machine(&key).unwrap();
    let ids = s
        .admin_request("GET", &format!("/rest/v1/tasks?select=id,sessions(id),projects!inner(name)&projects.name=eq.{project}&number=eq.1"), None)
        .unwrap();
    let parser = s.admin_request("GET", &format!("/rest/v1/sessions?name=eq.parser&select=id,projects!inner(name)&projects.name=eq.{project}"), None).unwrap();
    let forged = s.request_as(
        &login,
        "POST",
        "/rest/v1/comments",
        Some(json!({ "task_id": ids[0]["id"], "body": "Not mine", "session_id": parser[0]["id"] })),
    );
    assert!(forged.is_err(), "{forged:?}");
    w.kill().unwrap();
}

/// Run a hook and return what it printed for Claude Code.
fn hook_out(c: &Computer, window: u32, event: &str, input: Value) -> String {
    let mut child = command(c, Some(window), &["hook", event]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(input.to_string().as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(out.status.success());
    String::from_utf8_lossy(&out.stdout).to_string()
}

#[test]
fn a_handoff_note_reaches_the_next_conversation_in_the_window() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let mut w = window();
    let a = Uuid::new_v4().to_string();
    hook(&mac, w.id(), "session-start", json!({ "session_id": a, "cwd": "/w", "source": "startup" }));
    ok(&mac, Some(w.id()), &["sessions", "add", "parser", "--project", &project]);

    // Written, then replaced by a newer one (piped in, as a skill would).
    assert!(ok(&mac, Some(w.id()), &["handoff", "write", "First try."]).contains("Saved handoff note #1 for session parser"));
    let mut child = command(&mac, Some(w.id()), &["handoff", "write"]).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(b"Parser half done.\nNext: error messages.\n").unwrap();
    assert!(child.wait_with_output().unwrap().status.success());
    let list = ok(&pat, None, &["handoff", "list", "--project", &project]);
    assert_eq!(
        list.lines().map(|l| l.split('\t').filter(|f| !f.contains(':')).collect::<Vec<_>>()).collect::<Vec<_>>(),
        vec![
            vec!["#2", project.as_str(), "parser", "waiting", "Parser half done."],
            vec!["#1", project.as_str(), "parser", "replaced", "First try."]
        ],
        "{list}"
    );

    // /clear: the new conversation starts with the note, once.
    hook(&mac, w.id(), "session-end", json!({ "session_id": a, "reason": "clear" }));
    let out: Value = serde_json::from_str(&hook_out(&mac, w.id(), "session-start", json!({ "session_id": Uuid::new_v4().to_string(), "cwd": "/w", "source": "clear" }))).unwrap();
    let context = out["hookSpecificOutput"]["additionalContext"].as_str().unwrap();
    assert!(context.contains("Handoff note #2") && context.contains("Next: error messages."), "{context}");
    assert!(ok(&pat, None, &["handoff", "list", "--project", &project]).lines().next().unwrap().contains("picked up"));
    let b = Uuid::new_v4().to_string();
    hook(&mac, w.id(), "session-end", json!({ "session_id": "x", "reason": "clear" }));
    assert_eq!(hook_out(&mac, w.id(), "session-start", json!({ "session_id": b, "cwd": "/w", "source": "clear" })), "");

    // A note left when the window closes is cancelled, but can still be
    // picked up by hand, by anyone in the Project.
    ok(&mac, Some(w.id()), &["handoff", "write", "Stopped at the tests."]);
    hook(&mac, w.id(), "session-end", json!({ "session_id": b, "reason": "prompt_input_exit" }));
    assert!(ok(&pat, None, &["handoff", "list", "--project", &project]).lines().next().unwrap().contains("cancelled"));
    let shown = ok(&pat, None, &["handoff", "show", &project, "3", "--pickup"]);
    assert!(shown.starts_with(&format!("Handoff note #3 in {project} from session parser, written ")), "{shown}");
    assert!(shown.contains("Stopped at the tests."));
    assert!(ok(&pat, None, &["handoff", "list", "--project", &project]).lines().next().unwrap().contains("picked up"));

    // Outside a tracked session there's nothing to write a note for.
    let o = run(&pat, None, &["handoff", "write", "x"]);
    assert!(!o.status.success());
    w.kill().unwrap();
}

#[test]
fn a_projects_chat_reaches_the_sessions_it_names() {
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
    let stop = || hook_out(&mac, w.id(), "stop", json!({ "session_id": claude, "stop_hook_active": false }));

    // Off until someone turns it on.
    let o = run(&pat, None, &["chat", "send", &project, "hello"]);
    assert!(String::from_utf8_lossy(&o.stderr).contains("chat is off"), "{}", String::from_utf8_lossy(&o.stderr));
    assert_eq!(ok(&pat, None, &["chat", "on", &project]).trim(), format!("Chat is on for {project}."));

    ok(&pat, None, &["chat", "send", &project, "Morning all."]);
    assert_eq!(stop(), "", "a message that doesn't name the session isn't sent to it");
    ok(&pat, None, &["chat", "send", &project, "@parser can you check the error messages?"]);
    let out: Value = serde_json::from_str(&stop()).unwrap();
    let reason = out["reason"].as_str().unwrap();
    assert!(reason.contains(&format!("named in {project}'s chat")) && reason.contains("Pat: @parser can you check"), "{reason}");
    assert_eq!(stop(), "", "only once");

    // The session answers from its window; its own messages don't come back.
    ok(&mac, Some(w.id()), &["chat", "send", &project, "On it. @parser note to self.", "--as-machine"]);
    assert_eq!(stop(), "");
    let read = ok(&pat, None, &["chat", "read", &project]);
    let lines: Vec<&str> = read.lines().collect();
    assert_eq!(lines.len(), 3, "{read}");
    assert!(lines[2].contains(&format!("{mac_name} (session parser): On it.")), "{read}");

    ok(&pat, None, &["chat", "off", &project]);
    assert!(!run(&pat, None, &["chat", "send", &project, "x"]).status.success());
    w.kill().unwrap();
}

#[test]
fn a_new_session_starts_claude_in_the_host_and_records_it() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    // A short settings folder: the host's socket path has a length limit.
    let (mac, mac_name) = machine(&s);
    let short = PathBuf::from(format!("/tmp/os-{}", &Uuid::new_v4().simple().to_string()[..8]));
    std::fs::rename(&mac.home, &short).unwrap();
    let mac = Computer { home: short, tailscale: None };
    ok(&pat, None, &["machines", "add", &mac_name, &project]);

    // A stand-in for claude: runs Omicron's start hook as Claude Code does
    // (with the session id it was given), says it's ready, then waits.
    let bin = mac.home.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(
        bin.join("claude"),
        format!(
            "#!/bin/sh\necho \"$@\" > \"$OMICRON_HOME/claude-args\"\nid=\nwhile [ $# -gt 0 ]; do case \"$1\" in --session-id) id=\"$2\"; shift;; esac; shift; done\nprintf '{{\"session_id\":\"%s\",\"cwd\":\"%s\",\"source\":\"startup\"}}' \"$id\" \"$PWD\" | {} hook session-start\necho stand-in claude ready\nexec cat\n",
            env!("CARGO_BIN_EXE_omicron")
        ),
    )
    .unwrap();
    Command::new("chmod").args(["+x", bin.join("claude").to_str().unwrap()]).status().unwrap();
    let folder = mac.home.join("work");
    std::fs::create_dir_all(&folder).unwrap();
    let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap());
    let new = |name: &str| {
        command(&mac, None, &["sessions", "new", name, "--project", &project, "--folder", folder.to_str().unwrap(), "--no-attach"])
            .env("PATH", &path)
            .output()
            .unwrap()
    };

    let out = new("parser");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(String::from_utf8_lossy(&out.stdout).contains(&format!("Started parser in {project}")));

    // It runs in the host, with the right options.
    assert_eq!(ok(&mac, None, &["sessions", "hosted"]).trim(), "parser");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while !mac.home.join("claude-args").exists() {
        assert!(std::time::Instant::now() < deadline, "claude never started");
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    let args = std::fs::read_to_string(mac.home.join("claude-args")).unwrap();
    assert!(args.starts_with("--name parser --session-id "), "{args}");
    assert!(args.contains(&format!("--settings {}", mac.home.join("claude/settings.json").display())), "{args}");
    let settings: Value = serde_json::from_str(&std::fs::read_to_string(mac.home.join("claude/settings.json")).unwrap()).unwrap();
    assert!(settings["hooks"]["SessionStart"].is_array(), "Omicron's hooks are in its own settings file");

    // Recorded, with the session id it was started with, and the start hook
    // tied the window to the record.
    let id = args.split_whitespace().nth(3).unwrap().to_string();
    let r = record(&s, &project, "parser");
    assert_eq!((r["state"].as_str(), r["claude_session_id"].as_str()), (Some("open"), Some(id.as_str())));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        let w: Value = serde_json::from_str(&std::fs::read_to_string(mac.home.join("windows.json")).unwrap_or_default()).unwrap_or_default();
        if w["windows"].as_object().is_some_and(|m| m.values().any(|w| w["claude_session_id"] == json!(id) && w["session_id"].is_string())) {
            break;
        }
        assert!(std::time::Instant::now() < deadline, "the start hook never tied the window to the session: {w}");
        std::thread::sleep(std::time::Duration::from_millis(100));
    }

    // The same name again is refused while it runs; it ends cleanly.
    let again = new("parser");
    assert!(!again.status.success() && String::from_utf8_lossy(&again.stderr).contains("already running"));
    ok(&mac, None, &["sessions", "send", "parser", "\u{4}"]);
}

/// A machine with a short settings folder (the host's socket path has a
/// length limit) and a stand-in for claude on its PATH. The stand-in runs
/// Omicron's start hook as Claude Code does, writes its options to
/// `claude-args` (one per line), then writes each line typed into it to
/// `typed`. Returns the machine, its name, and the PATH to use.
fn machine_with_claude(s: &Supabase) -> (Computer, String, String) {
    let (mac, mac_name) = machine(s);
    let short = PathBuf::from(format!("/tmp/os-{}", &Uuid::new_v4().simple().to_string()[..8]));
    std::fs::rename(&mac.home, &short).unwrap();
    let mac = Computer { home: short, tailscale: None };
    let bin = mac.home.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(
        bin.join("claude"),
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$OMICRON_HOME/claude-args\"\nid=\nsource=startup\nwhile [ $# -gt 0 ]; do case \"$1\" in --session-id) id=\"$2\"; shift;; --resume) id=\"$2\"; source=resume; shift;; esac; shift; done\nprintf '{{\"session_id\":\"%s\",\"cwd\":\"%s\",\"source\":\"%s\"}}' \"$id\" \"$PWD\" \"$source\" | {} hook session-start\nwhile read -r line; do echo \"$line\" >> \"$OMICRON_HOME/typed\"; done\n",
            env!("CARGO_BIN_EXE_omicron")
        ),
    )
    .unwrap();
    Command::new("chmod").args(["+x", bin.join("claude").to_str().unwrap()]).status().unwrap();
    let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap());
    (mac, mac_name, path)
}

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
    while !done() {
        assert!(std::time::Instant::now() < deadline, "timed out waiting: {what}");
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
}

/// Start the machine's daemon and wait until it's listening.
fn daemon(c: &Computer, path: &str) -> Child {
    use std::io::BufRead;
    let mut child = command(c, None, &["daemon"]).env("PATH", path).stdout(Stdio::null()).stderr(Stdio::piped()).spawn().unwrap();
    let mut err = std::io::BufReader::new(child.stderr.take().unwrap());
    let mut line = String::new();
    loop {
        line.clear();
        assert!(err.read_line(&mut line).unwrap() > 0, "the daemon stopped");
        if line.contains("is listening for changes") {
            break;
        }
    }
    // Keep reading what it says, so it never blocks on a full pipe.
    std::thread::spawn(move || {
        let mut sink = String::new();
        while err.read_line(&mut sink).unwrap_or(0) > 0 {
            eprint!("daemon: {sink}");
            sink.clear();
        }
    });
    child
}

#[test]
fn dispatch_types_the_task_in_or_reopens_the_session_and_fails_when_asleep() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name, path) = machine_with_claude(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let folder = mac.home.join("work");
    std::fs::create_dir_all(&folder).unwrap();
    let out = command(&mac, None, &["sessions", "new", "parser", "--project", &project, "--folder", folder.to_str().unwrap(), "--no-attach"])
        .env("PATH", &path)
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    wait_for("claude started", || mac.home.join("claude-args").exists());
    let claude_id = std::fs::read_to_string(mac.home.join("claude-args")).unwrap().lines().nth(3).unwrap().to_string();

    ok(&pat, None, &["tasks", "add", &project, "Fix the parser"]);
    // Not given to a session yet.
    let o = run(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert!(!o.status.success() && String::from_utf8_lossy(&o.stderr).contains("give the task to a Claude session first"));
    ok(&pat, None, &["tasks", "send", &project, "1", "parser"]);

    let mut d = daemon(&mac, &path);

    // Running in the host: typed in, one line, Enter pressed.
    let said = ok(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert_eq!(said.trim(), format!("Typed the task into parser on {mac_name}."));
    wait_for("the task typed in", || std::fs::read_to_string(mac.home.join("typed")).is_ok_and(|t| t.contains("dispatched task #1")));
    let typed = std::fs::read_to_string(mac.home.join("typed")).unwrap();
    assert_eq!(
        typed.trim(),
        format!("Omicron dispatched task #1 \"Fix the parser\" ({project}) to you. Run `omicron tasks mine` to get it, then work on it and report as it says.")
    );

    // The session ends. Dispatch reopens it in the host, resuming the same
    // conversation, with the task as its first message.
    ok(&mac, None, &["sessions", "send", "parser", "\u{4}"]);
    wait_for("the session ended", || ok(&mac, None, &["sessions", "hosted"]).starts_with("No hosted sessions"));
    std::fs::remove_file(mac.home.join("claude-args")).unwrap();
    let said = ok(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert!(said.starts_with(&format!("Reopened parser on {mac_name} with the task.")), "{said}");
    wait_for("claude reopened", || mac.home.join("claude-args").exists());
    let args: Vec<String> = std::fs::read_to_string(mac.home.join("claude-args")).unwrap().lines().map(String::from).collect();
    assert_eq!(args[..4], ["--resume".to_string(), claude_id.clone(), "--name".into(), "parser".into()]);
    assert!(args.last().unwrap().starts_with("Omicron dispatched task #1"), "{args:?}");
    assert_eq!(ok(&mac, None, &["sessions", "hosted"]).trim(), "parser");
    wait_for("the session is open again", || record(&s, &project, "parser")["state"] == "open");

    // Each request is kept, with how it went.
    let rows = s.admin_request("GET", "/rest/v1/dispatches?select=state,result,error&order=created_at", None).unwrap();
    let mine: Vec<&Value> = rows.as_array().unwrap().iter().filter(|r| r["result"].as_str().is_some_and(|t| t.contains(&mac_name))).collect();
    assert_eq!(mine.len(), 2);
    assert!(mine.iter().all(|r| r["state"] == "done"));

    // Asleep: fails at once, and nothing is asked for.
    d.kill().unwrap();
    d.wait().unwrap();
    ok(&mac, None, &["sessions", "send", "parser", "\u{4}"]);
    let started = std::time::Instant::now();
    let o = run(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert!(!o.status.success());
    assert!(String::from_utf8_lossy(&o.stderr).contains(&format!("{mac_name} is asleep")), "{}", String::from_utf8_lossy(&o.stderr));
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
}

#[test]
fn an_old_dispatch_is_never_taken_and_can_be_given_up() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name, path) = machine_with_claude(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let mut w = window();
    hook(&mac, w.id(), "session-start", json!({ "session_id": Uuid::new_v4().to_string(), "cwd": "/tmp", "source": "startup" }));
    ok(&mac, Some(w.id()), &["sessions", "add", "parser", "--project", &project]);
    ok(&pat, None, &["tasks", "add", &project, "Fix the parser"]);
    ok(&pat, None, &["tasks", "send", &project, "1", "parser"]);

    let config: Value = serde_json::from_str(&std::fs::read_to_string(mac.home.join("config.json")).unwrap()).unwrap();
    let key: omicron::supa::MachineKey = config["machine_key"].as_str().unwrap().parse().unwrap();
    let login = s.sign_in_machine(&key).unwrap();
    let task = s.admin_request("GET", &format!("/rest/v1/tasks?title=eq.Fix the parser&select=id,projects!inner(name)&projects.name=eq.{project}"), None).unwrap();
    let task_id = task[0]["id"].as_str().unwrap();

    // The request names only the task; the database fills in the rest, and
    // a made-up machine is ignored.
    let other = Uuid::new_v4();
    let req = s.request_as(&login, "POST", "/rest/v1/dispatches", Some(json!({ "task_id": task_id, "machine_id": other, "state": "done" }))).unwrap();
    let id = req[0]["id"].as_str().unwrap().to_string();
    assert_eq!(req[0]["state"], "pending");
    assert_eq!(req[0]["machine_id"], json!(key.machine_id));

    // Too old to take.
    s.admin_request("PATCH", &format!("/rest/v1/dispatches?id=eq.{id}"), Some(json!({ "created_at": "2020-01-01T00:00:00Z" }))).unwrap();
    let claimed = s.request_as(&login, "POST", "/rest/v1/rpc/claim_dispatch", Some(json!({ "dispatch": id }))).unwrap();
    assert_eq!(claimed, json!([]));
    // Only the functions change a request.
    assert!(s.request_as(&login, "PATCH", &format!("/rest/v1/dispatches?id=eq.{id}"), Some(json!({ "state": "done" }))).is_err());

    // Given up: failed, with the reason, and it can't be given up twice.
    let gave = s.request_as(&login, "POST", "/rest/v1/rpc/give_up_dispatch", Some(json!({ "dispatch": id, "why": "nobody took it" }))).unwrap();
    assert_eq!((gave[0]["state"].as_str(), gave[0]["error"].as_str()), (Some("failed"), Some("nobody took it")));
    let again = s.request_as(&login, "POST", "/rest/v1/rpc/give_up_dispatch", Some(json!({ "dispatch": id, "why": "x" }))).unwrap();
    assert_eq!(again, json!([]));

    // Open in a window Omicron doesn't host: it can't be typed into, so it
    // fails and says how to hand it over instead.
    let mut d = daemon(&mac, &path);
    let o = run(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert!(!o.status.success());
    assert!(String::from_utf8_lossy(&o.stderr).contains("open in a window Omicron doesn't host"), "{}", String::from_utf8_lossy(&o.stderr));
    d.kill().unwrap();
    w.kill().unwrap();
}
