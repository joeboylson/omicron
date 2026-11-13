//! End-to-end tests for `omicron sessions` and the Claude Code hooks. A
//! sleeping process stands in for a Claude Code window, and the hooks get
//! the same JSON Claude Code sends them.
//!
//! Runs only when the test Supabase is set up (see `scripts/test.sh`).

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

/// A settings folder with a short path: the background runner's socket
/// paths have a length limit.
fn new_home() -> PathBuf {
    let dir = PathBuf::from(format!("/tmp/os-{}", &Uuid::new_v4().simple().to_string()[..10]));
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
    let key = s.register_machine(&name, false, None).unwrap();
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
        if k.starts_with("OMICRON_") || k.starts_with("CLAUDE_CODE_") || k == "CLAUDECODE" {
            cmd.env_remove(k);
        }
    }
    cmd.env("OMICRON_HOME", &c.home);
    // Claude Code's own folder (transcripts), one per test machine.
    cmd.env("CLAUDE_CONFIG_DIR", c.home.join("claude-code"));
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

/// A Claude window `omicron open` started in the background runner: the
/// stand-in claude's process, to run hooks for, or to kill like a crash.
struct Win {
    pid: u32,
}

impl Win {
    fn id(&self) -> u32 {
        self.pid
    }
    fn kill(&mut self) -> std::io::Result<()> {
        Command::new("kill").args(["-9", &self.pid.to_string()]).status().map(|_| ())
    }
    fn wait(&mut self) -> std::io::Result<()> {
        wait_for("the window gone", || !Command::new("kill").args(["-0", &self.pid.to_string()]).stderr(Stdio::null()).status().unwrap().success());
        Ok(())
    }
}

/// `omicron open` a session with a stand-in claude that only waits: a
/// window whose hooks the test runs itself. Returns the window and the
/// conversation it was opened with.
fn opened(s: &Supabase, c: &Computer, name: &str, project: &str) -> (Win, String) {
    let bin = c.home.join("quiet-bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(bin.join("claude"), "#!/bin/sh\necho $$ > \"$OMICRON_HOME/pid-$OMICRON_SESSION\"\nexec sleep 600\n").unwrap();
    Command::new("chmod").args(["+x", bin.join("claude").to_str().unwrap()]).status().unwrap();
    let folder = c.home.join("work");
    std::fs::create_dir_all(&folder).unwrap();
    let o = command(c, None, &["open", name, "--project", project, "--folder", folder.to_str().unwrap()])
        .env("PATH", format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()))
        .stdin(Stdio::null())
        .output()
        .unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let pid_file = c.home.join(format!("pid-{name}"));
    wait_for("claude started", || std::fs::read_to_string(&pid_file).is_ok_and(|p| !p.trim().is_empty()));
    let pid = std::fs::read_to_string(&pid_file).unwrap().trim().parse().unwrap();
    let conversation = record(s, project, name)["claude_session_id"].as_str().unwrap().to_string();
    (Win { pid }, conversation)
}

fn record(s: &Supabase, project: &str, name: &str) -> Value {
    let rows = s
        .admin_request("GET", &format!("/rest/v1/sessions?name=eq.{name}&select=state,claude_session_id,folder,projects!inner(name)&projects.name=eq.{project}"), None)
        .unwrap();
    rows[0].clone()
}

#[test]
fn a_session_is_recorded_while_it_runs_and_ends_when_it_closes_or_crashes() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);

    // `omicron open` records the session and starts Claude Code, whose
    // start hook ties the window to it.
    let (mut first, a) = opened(&s, &mac, "parser", &project);
    let said = hook(&mac, first.id(), "session-start", json!({ "session_id": a, "cwd": "/work/app", "source": "startup" }));
    assert_eq!(said, "");
    let listed = ok(&pat, None, &["sessions", "list", "--project", &project]);
    assert_eq!(listed, format!("parser\t{project}\t{mac_name}\topen\t/work/app\n"));
    assert_eq!(record(&s, &project, "parser")["claude_session_id"], json!(a));

    // /clear: a new Claude conversation in the same window, same session.
    let b = Uuid::new_v4().to_string();
    hook(&mac, first.id(), "session-end", json!({ "session_id": a, "reason": "clear" }));
    assert!(record(&s, &project, "parser").is_object());
    hook(&mac, first.id(), "session-start", json!({ "session_id": b, "cwd": "/work/app", "source": "clear" }));
    assert_eq!(record(&s, &project, "parser")["claude_session_id"], json!(b));

    // Closed: the session ends, and the change log says so.
    let id = s.admin_request("GET", &format!("/rest/v1/sessions?select=id&claude_session_id=eq.{b}"), None).unwrap()[0]["id"].as_str().unwrap().to_string();
    hook(&mac, first.id(), "session-end", json!({ "session_id": b, "reason": "prompt_input_exit" }));
    assert!(record(&s, &project, "parser").is_null());
    let logged = s.admin_request("GET", &format!("/rest/v1/changes?select=kind&table_name=eq.sessions&kind=eq.DELETE&old_record->>id=eq.{id}"), None).unwrap();
    assert_eq!(logged.as_array().map(Vec::len), Some(1), "{logged}");
    first.kill().unwrap();
    first.wait().unwrap();

    // Crashed (it stops without saying): the next hook on this machine,
    // from any window, notices, and it ends.
    let (mut second, c) = opened(&s, &mac, "docs", &project);
    hook(&mac, second.id(), "session-start", json!({ "session_id": c, "cwd": "/work", "source": "startup" }));
    second.kill().unwrap();
    second.wait().unwrap();
    let mut other = window();
    hook(&mac, other.id(), "session-start", json!({ "session_id": Uuid::new_v4().to_string(), "cwd": "/tmp", "source": "startup" }));
    assert!(record(&s, &project, "docs").is_null());
    other.kill().unwrap();
    assert!(ok(&pat, None, &["sessions", "list", "--project", &project]).starts_with("No sessions yet."));

    // A member removes one by hand.
    let (mut third, _) = opened(&s, &mac, "build", &project);
    assert!(ok(&pat, None, &["sessions", "remove", "build", "--project", &project]).contains("Removed session build"));
    assert!(ok(&pat, None, &["sessions", "list", "--project", &project]).starts_with("No sessions yet."));
    third.kill().unwrap();
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
fn only_the_sessions_machine_can_change_it() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    let (other, other_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    ok(&pat, None, &["machines", "add", &other_name, &project]);
    let (mut w, conversation) = opened(&s, &mac, "mine", &project);
    hook(&mac, w.id(), "session-start", json!({ "session_id": conversation, "cwd": "/w", "source": "startup" }));

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
    let (mut w, claude) = opened(&s, &mac, "parser", &project);
    hook(&mac, w.id(), "session-start", json!({ "session_id": claude, "cwd": "/w", "source": "startup" }));

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

    // Given from elsewhere (Pat, not this computer) with the gate closed:
    // only to read, not handed over (ref/BRAINSTORM.md, "The gate").
    let mine = ok(&mac, Some(w.id()), &["tasks", "mine"]);
    assert!(mine.starts_with("Given to this session from elsewhere, only to read"), "{mine}");
    assert!(mine.contains(&format!("#1 in {project}: Write the parser\n")) && !mine.contains("(new)"), "{mine}");
    assert!(!mine.contains("--review"), "no instructions to work on it: {mine}");

    // Handed over on its own computer: it goes straight in.
    let sent = ok(&mac, None, &["tasks", "send", &project, "1", "parser", "--as-machine"]);
    assert!(sent.contains("sent to session parser"), "{sent}");

    // Told to get its tasks: it gets the open ones, new ones marked.
    let mine = ok(&mac, Some(w.id()), &["tasks", "mine"]);
    assert!(mine.contains(&format!("#1 in {project}: Write the parser (new)")), "{mine}");
    assert!(!mine.contains("only to read"), "{mine}");
    assert!(mine.contains("comment") && mine.contains("--review"), "{mine}");
    // With how to write the report.
    assert!(mine.contains("No jargon and no made-up terms") && mine.contains("At most 500 words"), "{mine}");
    // And the Project's run rules, once set (#90).
    assert!(mine.contains(&format!("{project} has no run rules; follow this folder's CLAUDE.md.")), "{mine}");
    ok(&pat, None, &["projects", "rules", &project, "Run the tests. Commit and push."]);
    assert_eq!(ok(&pat, None, &["projects", "rules", &project]).trim(), "Run the tests. Commit and push.");
    let again = ok(&mac, Some(w.id()), &["tasks", "mine"]);
    assert!(again.contains(&format!("Run rules for {project} (how to work on its tasks; this folder's CLAUDE.md applies too):\nRun the tests. Commit and push.")), "{again}");
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

    // With the gate open, work given from elsewhere comes in too.
    open_gate(&mac, &pat);

    // Given to another session and back: new again.
    let (other, other_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &other_name, &project]);
    let (mut w2, conversation) = opened(&s, &other, "helper", &project);
    hook(&other, w2.id(), "session-start", json!({ "session_id": conversation, "cwd": "/w", "source": "startup" }));
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
    let (mut w, conversation) = opened(&s, &mac, "parser", &project);
    hook(&mac, w.id(), "session-start", json!({ "session_id": conversation, "cwd": "/w", "source": "startup" }));
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
    let (mut w, a) = opened(&s, &mac, "parser", &project);
    hook(&mac, w.id(), "session-start", json!({ "session_id": a, "cwd": "/w", "source": "startup" }));

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
    // Its session has ended, so the note no longer names it.
    assert!(shown.starts_with(&format!("Handoff note #3 in {project}, written ")), "{shown}");
    assert!(shown.contains("Stopped at the tests."));
    assert!(ok(&pat, None, &["handoff", "list", "--project", &project]).lines().next().unwrap().contains("picked up"));

    // Outside a tracked session there's nothing to write a note for.
    let o = run(&pat, None, &["handoff", "write", "x"]);
    assert!(!o.status.success());
    w.kill().unwrap();
}

#[test]
fn the_stop_hook_passes_nothing_on() {
    // No chat, no tasks: anything typed into a session comes from its own
    // computer (ref/BRAINSTORM.md, "Drop chat").
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let (mut w, claude) = opened(&s, &mac, "parser", &project);
    hook(&mac, w.id(), "session-start", json!({ "session_id": claude, "cwd": "/w", "source": "startup" }));
    assert_eq!(hook_out(&mac, w.id(), "stop", json!({ "session_id": claude, "stop_hook_active": false })), "");
    w.kill().unwrap();
}

#[test]
fn open_runs_claude_in_the_background_records_it_and_jumps_back_in() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name, path) = machine_with_claude(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);

    // A new session: recorded, then Claude Code starts in the background
    // with Omicron's hooks and add-on, under a new conversation.
    let w = open_window(&mac, &path, &["parser", "--project", &project]);
    let args = w.args.clone();
    assert_eq!(args[0], "--session-id");
    let id = args[1].clone();
    assert_eq!(args[2..4], ["--name".to_string(), "parser".into()]);
    let at = |flag: &str| PathBuf::from(&args[args.iter().position(|a| a == flag).unwrap() + 1]);
    assert_eq!(at("--settings"), mac.home.join("claude/settings.json"));
    let settings: Value = serde_json::from_str(&std::fs::read_to_string(at("--settings")).unwrap()).unwrap();
    assert!(settings["hooks"]["SessionStart"].is_array(), "Omicron's hooks are in its own settings file");
    let register = std::fs::read_to_string(at("--plugin-dir").join("hooks/register.ts")).unwrap();
    let exe = std::fs::canonicalize(env!("CARGO_BIN_EXE_omicron")).unwrap();
    assert!(register.contains(&format!("const OMICRON = '{}'", exe.display())), "the add-on runs this program: {register}");
    let r = record(&s, &project, "parser");
    assert_eq!((r["state"].as_str(), r["claude_session_id"].as_str()), (Some("open"), Some(id.as_str())));
    assert_eq!(ok(&mac, None, &["sessions", "hosted"]).trim(), "parser");
    let windows: Value = serde_json::from_str(&std::fs::read_to_string(mac.home.join("windows.json")).unwrap()).unwrap();
    assert!(windows["windows"].as_object().unwrap().values().any(|w| w["claude_session_id"] == json!(id) && w["session_id"].is_string()), "{windows}");

    // Opened again by name: the same one (no second Claude).
    let o = command(&mac, None, &["open", "parser"]).env("PATH", &path).stdin(Stdio::null()).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&o.stdout).trim(), "parser is running. Jump in with `omicron open parser`.");
    assert_eq!(ok(&mac, None, &["sessions", "hosted"]).trim(), "parser");
    // Inside it, `omicron open` says to let go instead.
    let o = command(&mac, None, &["open"]).env("CLAUDE_CODE_SESSION_ID", &id).env("OMICRON_SESSION", "parser").output().unwrap();
    assert!(String::from_utf8_lossy(&o.stderr).contains("this is already the session parser. `omicron detach`"));

    // Quit: it ends. Opened by name later, it's a new session.
    close_window(&mac, w);
    assert!(record(&s, &project, "parser").is_null());
    let w = open_window(&mac, &path, &["parser", "--project", &project]);
    assert_eq!(w.args[0], "--session-id");
    assert_ne!(w.args[1], id);
    close_window(&mac, w);

    // No name: named after its folder.
    let w = open_window(&mac, &path, &["--project", &project]);
    assert_eq!(w.name, "work");
    close_window(&mac, w);

    // An existing Claude conversation, brought in by its id.
    assert!(open_refused(&mac, &path, &["build", "--resume", &Uuid::new_v4().to_string()]).contains("there's no conversation"));
    let old = Uuid::new_v4().to_string();
    std::fs::write(mac.home.join(format!("claude-code/projects/work/{old}.jsonl")), "").unwrap();
    let w = open_window(&mac, &path, &["build", "--resume", &old]);
    assert_eq!(w.args[..4], ["--resume".to_string(), old.clone(), "--name".into(), "build".into()]);
    assert_eq!(record(&s, &project, "build")["claude_session_id"].as_str(), Some(old.as_str()));
    // By its conversation again: the same session.
    let o = command(&mac, None, &["open", "--resume", &old]).env("PATH", &path).stdin(Stdio::null()).output().unwrap();
    assert_eq!(String::from_utf8_lossy(&o.stdout).trim(), "build is running. Jump in with `omicron open build`.");

    // Its Claude dies without saying: opening it says so, and it ends.
    let pid = Command::new("pgrep").args(["-f", "--", &format!("--resume {old}")]).output().unwrap();
    for p in String::from_utf8_lossy(&pid.stdout).split_whitespace() {
        Command::new("kill").args(["-9", p]).status().unwrap();
    }
    wait_for("it stopped", || !ok(&mac, None, &["sessions", "hosted"]).contains("build"));
    assert!(open_refused(&mac, &path, &["build"]).contains("build had stopped, so it's ended"));
    assert!(record(&s, &project, "build").is_null());
    let _ = w;
}

#[test]
fn open_inside_a_claude_window_says_what_to_run_once_its_closed() {
    let home = new_home();
    let c = Computer { home: home.clone(), tailscale: None };
    let conversation = Uuid::new_v4().to_string();
    let folder = home.join("my app");
    std::fs::create_dir_all(&folder).unwrap();
    let o = command(&c, None, &["open"]).env("CLAUDE_CODE_SESSION_ID", &conversation).current_dir(&folder).output().unwrap();
    assert!(!o.status.success());
    let said = String::from_utf8_lossy(&o.stderr);
    assert!(said.contains("Quit this window (/exit)"), "{said}");
    assert!(said.contains(&format!("omicron open 'my app' --resume {conversation}")), "{said}");
    let o = command(&c, None, &["open", "parser", "--project", "Code"]).env("CLAUDE_CODE_SESSION_ID", &conversation).output().unwrap();
    assert!(String::from_utf8_lossy(&o.stderr).contains(&format!("omicron open parser --project Code --resume {conversation}")));
}

#[test]
fn open_says_which_project_when_the_machine_is_in_several() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let (code, docs) = (unique("Code"), unique("Docs"));
    ok(&pat, None, &["projects", "new", &code]);
    ok(&pat, None, &["projects", "new", &docs]);
    let (mac, mac_name, path) = machine_with_claude(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &code]);
    ok(&pat, None, &["machines", "add", &mac_name, &docs]);
    let said = open_refused(&mac, &path, &["parser"]);
    assert!(said.contains("--project") && said.contains(&code) && said.contains(&docs), "{said}");
    let w = open_window(&mac, &path, &["parser", "--project", &docs]);
    // One name runs once on a machine, whatever its Project.
    assert!(open_refused(&mac, &path, &["parser", "--project", &code]).contains("something called parser is already running"));

    // Its folder is remembered as Docs's: the next one there needs no --project.
    let work = mac.home.join("work").canonicalize().unwrap();
    let listed = ok(&pat, None, &["folders", "list", "--project", &docs]);
    assert_eq!(listed, format!("{mac_name}  {}  {docs}\n", work.display()));
    let helper = open_window(&mac, &path, &["helper"]);
    assert!(ok(&pat, None, &["sessions", "list"]).lines().any(|l| l.contains("helper") && l.contains(&docs)), "helper is Docs's");
    close_window(&mac, helper);
    close_window(&mac, w);

    // Added here for Code instead: it moves. Taken off, nothing else changes.
    let said = command(&mac, None, &["folders", "add", "--project", &code]).current_dir(&work).output().unwrap();
    assert!(String::from_utf8_lossy(&said.stdout).contains(&format!("for {code}")), "{}", String::from_utf8_lossy(&said.stderr));
    assert!(ok(&pat, None, &["folders", "list", "--project", &docs]).starts_with("No folders yet"));
    let said = command(&mac, None, &["folders", "remove"]).current_dir(&work).output().unwrap();
    assert!(said.status.success() && String::from_utf8_lossy(&said.stdout).starts_with("Took "), "{}", String::from_utf8_lossy(&said.stderr));
    assert!(work.exists());
    assert!(ok(&pat, None, &["folders", "list"]).starts_with("No folders yet"));
    // A person can't add one: only the computer it's on can.
    let o = command(&pat, None, &["folders", "add", "--project", &code]).current_dir(&work).output().unwrap();
    assert!(!o.status.success());
    // A machine taken out of a Project loses its folders there.
    command(&mac, None, &["folders", "add", "--project", &code]).current_dir(&work).output().unwrap();
    ok(&pat, None, &["machines", "remove", &mac_name, &code]);
    assert!(ok(&pat, None, &["folders", "list", "--project", &code]).starts_with("No folders yet"));
}

/// A machine with a stand-in for claude on its PATH, which acts like a
/// Claude window with Omicron's hooks and add-on: it writes its options to
/// `claude-args` (one per line), runs the start hook, follows its inbox as
/// the add-on does (each message it gets goes to `typed`, one JSON line
/// each), and when its input closes runs the end hook and stops. Returns
/// the machine, its name, and the PATH to use.
fn machine_with_claude(s: &Supabase) -> (Computer, String, String) {
    let (mac, mac_name) = machine(s);
    let bin = mac.home.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let o = env!("CARGO_BIN_EXE_omicron");
    std::fs::write(
        bin.join("claude"),
        format!(
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$OMICRON_HOME/claude-args\"\nid=\nsource=startup\nwhile [ $# -gt 0 ]; do case \"$1\" in --session-id) id=\"$2\"; shift;; --resume) id=\"$2\"; source=resume; shift;; esac; shift; done\nmkdir -p \"$CLAUDE_CONFIG_DIR/projects/work\" && touch \"$CLAUDE_CONFIG_DIR/projects/work/$id.jsonl\"\nprintf '{{\"session_id\":\"%s\",\"cwd\":\"%s\",\"source\":\"%s\"}}' \"$id\" \"$PWD\" \"$source\" | {o} hook session-start\n{o} sessions inbox \"$id\" >> \"$OMICRON_HOME/typed\" &\nf=$!\necho $f > \"$OMICRON_HOME/follower\"\ncat > /dev/null\nkill $f\nprintf '{{\"session_id\":\"%s\",\"reason\":\"prompt_input_exit\"}}' \"$id\" | {o} hook session-end\n"
        ),
    )
    .unwrap();
    Command::new("chmod").args(["+x", bin.join("claude").to_str().unwrap()]).status().unwrap();
    let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap());
    (mac, mac_name, path)
}

/// A session `omicron open` started with `machine_with_claude`'s stand-in,
/// in the machine's `work` folder: its name and claude's options.
struct Opened {
    name: String,
    args: Vec<String>,
}

/// `omicron open` with `machine_with_claude`'s stand-in: Claude starts in
/// the background, following its inbox.
fn open_window(c: &Computer, path: &str, args: &[&str]) -> Opened {
    for f in ["claude-args", "follower"] {
        let _ = std::fs::remove_file(c.home.join(f));
    }
    let folder = c.home.join("work");
    std::fs::create_dir_all(&folder).unwrap();
    let mut all = vec!["open"];
    all.extend_from_slice(args);
    let o = command(c, None, &all).env("PATH", path).current_dir(&folder).stdin(Stdio::null()).output().unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let said = String::from_utf8_lossy(&o.stdout).to_string();
    let name = said.split(" is running.").next().unwrap().trim().to_string();
    assert!(said.contains(&format!("Jump in with `omicron open {name}`")), "{said}");
    wait_for("claude started", || c.home.join("follower").exists());
    let args: Vec<String> = std::fs::read_to_string(c.home.join("claude-args")).unwrap().lines().map(String::from).collect();
    let id = args[1].clone();
    wait_for("its add-on following", || c.home.join(format!("inbox/{id}/listener")).exists());
    Opened { name, args }
}



/// Quit a session from `open_window` (Claude's input ends): it ends.
fn close_window(c: &Computer, w: Opened) {
    ok(c, None, &["sessions", "send", &w.name, "\u{4}", "--no-enter"]);
    wait_for("it ended", || !ok(c, None, &["sessions", "hosted"]).lines().any(|l| l == w.name));
}

/// `omicron open` that's refused: what it said.
fn open_refused(c: &Computer, path: &str, args: &[&str]) -> String {
    let mut all = vec!["open"];
    all.extend_from_slice(args);
    let o = command(c, None, &all).env("PATH", path).current_dir(&c.home).stdin(Stdio::null()).output().unwrap();
    assert!(!o.status.success(), "it opened: {:?}", args);
    String::from_utf8_lossy(&o.stderr).to_string()
}

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    // Generous: every request goes over the internet to the hosted Supabase.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
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
fn dispatch_reaches_the_session_and_fails_when_it_ended_or_its_machine_is_asleep() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name, path) = machine_with_claude(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let w = open_window(&mac, &path, &["parser", "--project", &project]);

    ok(&pat, None, &["tasks", "add", &project, "Fix the parser"]);
    // Not given to a session yet.
    let o = run(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert!(!o.status.success() && String::from_utf8_lossy(&o.stderr).contains("give the task to a Claude session first"));
    ok(&pat, None, &["tasks", "send", &project, "1", "parser"]);

    let mut d = daemon(&mac, &path);
    let told = format!("Omicron dispatched task #1 \"Fix the parser\" ({project}) to you. Run `omicron tasks mine` to get it, then work on it and report as it says.");

    // Pat doesn't own it: refused, plainly, gate or no gate.
    let o = run(&pat, None, &["tasks", "dispatch", &project, "1"]);
    let said = String::from_utf8_lossy(&o.stderr);
    assert!(!o.status.success() && said.contains("only takes orders from its owner") && said.contains("no owner yet"), "{said}");
    // Pat owns it, but its gate is closed: refused, plainly.
    open_gate(&mac, &pat);
    ok(&mac, None, &["gate", "close"]);
    let o = run(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert!(!o.status.success() && String::from_utf8_lossy(&o.stderr).contains("gate is closed"), "{}", String::from_utf8_lossy(&o.stderr));
    assert!(typed_lines(&mac).is_empty());
    open_gate(&mac, &pat);

    // It reaches the session's window, whole.
    let said = ok(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert_eq!(said.trim(), format!("Sent the task to parser on {mac_name}."));
    wait_for("the task in the window", || typed_lines(&mac).len() == 1);
    assert_eq!(typed_lines(&mac), [told.clone()]);
    // So does a message sent by name, and each only once.
    assert_eq!(ok(&mac, None, &["sessions", "send", "parser", "hello there"]).trim(), "Sent it to parser.");
    wait_for("the message in the window", || typed_lines(&mac).len() == 2);
    std::thread::sleep(std::time::Duration::from_secs(2));
    assert_eq!(typed_lines(&mac), [told.clone(), "hello there".into()]);
    let rows = s.admin_request("GET", "/rest/v1/dispatches?select=state,result&order=created_at", None).unwrap();
    assert!(rows.as_array().unwrap().iter().any(|r| r["state"] == "done" && r["result"].as_str().is_some_and(|t| t.contains(&mac_name))));

    // It ended: the task is flagged, and can't be dispatched until it's
    // given to someone again.
    close_window(&mac, w);
    let o = run(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert!(!o.status.success() && String::from_utf8_lossy(&o.stderr).contains("give the task to a Claude session first"));
    let o = run(&mac, None, &["sessions", "send", "parser", "anyone?"]);
    assert!(String::from_utf8_lossy(&o.stderr).contains("no session called parser"));

    // Asleep: fails at once, and nothing is asked for.
    let w = open_window(&mac, &path, &["parser", "--project", &project]);
    ok(&pat, None, &["tasks", "send", &project, "1", "parser"]);
    d.kill().unwrap();
    d.wait().unwrap();
    // The Supabase takes a moment to notice the daemon went away.
    wait_for("the machine to show as asleep", || !ok(&mac, None, &["machines", "awake"]).lines().any(|l| l == mac_name));
    let started = std::time::Instant::now();
    let o = run(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert!(!o.status.success());
    assert!(String::from_utf8_lossy(&o.stderr).contains(&format!("{mac_name} is asleep")), "{}", String::from_utf8_lossy(&o.stderr));
    assert!(started.elapsed() < std::time::Duration::from_secs(15));
    close_window(&mac, w);
}

#[test]
fn an_old_dispatch_is_never_taken_and_can_be_given_up() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name, path) = machine_with_claude(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let (mut w, conversation) = opened(&s, &mac, "parser", &project);
    hook(&mac, w.id(), "session-start", json!({ "session_id": conversation, "cwd": "/tmp", "source": "startup" }));
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
    // Only the functions change a request: a direct edit changes nothing
    // (refused, or no rows, depending on the database's default grants).
    let _ = s.request_as(&login, "PATCH", &format!("/rest/v1/dispatches?id=eq.{id}"), Some(json!({ "state": "done" })));
    let still = s.admin_request("GET", &format!("/rest/v1/dispatches?id=eq.{id}&select=state"), None).unwrap();
    assert_eq!(still[0]["state"], "pending");

    // Given up: failed, with the reason, and it can't be given up twice.
    let gave = s.request_as(&login, "POST", "/rest/v1/rpc/give_up_dispatch", Some(json!({ "dispatch": id, "why": "nobody took it" }))).unwrap();
    assert_eq!((gave[0]["state"].as_str(), gave[0]["error"].as_str()), (Some("failed"), Some("nobody took it")));
    let again = s.request_as(&login, "POST", "/rest/v1/rpc/give_up_dispatch", Some(json!({ "dispatch": id, "why": "x" }))).unwrap();
    assert_eq!(again, json!([]));

    // Its window doesn't follow its inbox (no add-on): the task waits for
    // the next time it's opened, and Dispatch says so.
    let mut d = daemon(&mac, &path);
    open_gate(&mac, &pat);
    let said = ok(&pat, None, &["tasks", "dispatch", &project, "1"]);
    assert!(said.starts_with("parser isn't open"), "{said}");
    d.kill().unwrap();
    w.kill().unwrap();
}

#[test]
fn a_session_ends_when_its_machine_leaves_and_its_tasks_are_flagged_until_given_out() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let (mut w, conversation) = opened(&s, &mac, "parser", &project);
    hook(&mac, w.id(), "session-start", json!({ "session_id": conversation, "cwd": "/work", "source": "startup" }));
    ok(&pat, None, &["tasks", "add", &project, "Fix the parser"]);
    ok(&pat, None, &["tasks", "add", &project, "Write the docs"]);
    ok(&pat, None, &["tasks", "send", &project, "1", "parser"]);
    ok(&pat, None, &["tasks", "send", &project, "2", "parser"]);
    let tasks = || {
        s.admin_request("GET", &format!("/rest/v1/tasks?select=number,assignee_session_id,ended_session,projects!inner(name)&projects.name=eq.{project}&order=number"), None)
            .unwrap()
    };

    // The machine is taken out of the Project: its session there ends, and
    // its tasks say whose they were.
    ok(&pat, None, &["machines", "remove", &mac_name, &project]);
    assert!(ok(&pat, None, &["sessions", "list", "--project", &project]).starts_with("No sessions yet."));
    let t = tasks();
    assert!(t.as_array().unwrap().iter().all(|t| t["assignee_session_id"].is_null() && t["ended_session"] == "parser"), "{t}");

    // Given to someone again: no longer flagged.
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let (mut helper, _) = opened(&s, &mac, "helper", &project);
    ok(&pat, None, &["tasks", "send", &project, "1", "helper"]);
    let t = tasks();
    assert_eq!((t[0]["ended_session"].is_null(), t[1]["ended_session"].as_str()), (true, Some("parser")), "{t}");
    w.kill().unwrap();
    helper.kill().unwrap();
}

#[test]
fn the_daemon_ends_sessions_that_stopped_while_it_was_away() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name, path) = machine_with_claude(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    // One keeps running; the other's Claude is killed while nothing watches.
    let running = open_window(&mac, &path, &["parser", "--project", &project]);
    let (mut gone, conversation) = opened(&s, &mac, "docs", &project);
    hook(&mac, gone.id(), "session-start", json!({ "session_id": conversation, "cwd": "/work", "source": "startup" }));
    gone.kill().unwrap();
    gone.wait().unwrap();
    assert!(record(&s, &project, "docs").is_object());
    let mut d = daemon(&mac, &path);
    assert!(record(&s, &project, "docs").is_null());
    assert!(record(&s, &project, "parser").is_object());
    close_window(&mac, running);
    d.kill().unwrap();
}

/// What reached a `machine_with_claude` window, in order.
fn typed_lines(c: &Computer) -> Vec<String> {
    std::fs::read_to_string(c.home.join("typed")).unwrap_or_default().lines().map(|l| serde_json::from_str::<String>(l).unwrap()).collect()
}

#[test]
fn a_loop_types_its_prompt_in_when_due_waits_while_busy_and_ends() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name, path) = machine_with_claude(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let w = open_window(&mac, &path, &["parser", "--project", &project]);
    let mut d = daemon(&mac, &path);

    // Bad starts are refused.
    let o = run(&pat, None, &["loops", "start", "x", "--every", "30s", "--session", "parser", "--project", &project]);
    assert!(String::from_utf8_lossy(&o.stderr).contains("at most once a minute"));

    // Started from elsewhere: it only runs while the gate is open.
    open_gate(&mac, &pat);
    let started = ok(&pat, None, &["loops", "start", "Keep going\nwith the next task", "--every", "10m", "--times", "2", "--session", "parser", "--project", &project]);
    assert!(started.starts_with("Started a loop for parser: every 10m, 0 of 2 runs done."), "{started}");
    let o = run(&pat, None, &["loops", "start", "again", "--every", "10m", "--session", "parser", "--project", &project]);
    assert!(String::from_utf8_lossy(&o.stderr).contains("already has a loop running"));
    let listed = ok(&pat, None, &["loops", "list", "--project", &project]);
    assert!(listed.starts_with(&format!("parser\t{project}\tevery 10m\t0 of 2 runs done\tnext ")), "{listed}");
    assert!(listed.trim_end().ends_with("Keep going with the next task"), "{listed}");

    // Make it due now (instead of waiting 10 minutes): it reaches the window.
    let loop_id = s.admin_request("GET", "/rest/v1/loops?prompt=eq.Keep going with the next task&state=eq.running&select=id,sessions!inner(name,projects!inner(name))", None)
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["sessions"]["projects"]["name"] == json!(project))
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let due_now = || {
        s.admin_request("PATCH", &format!("/rest/v1/loops?id=eq.{loop_id}"), Some(json!({ "next_run_at": "2020-01-01T00:00:00Z" }))).unwrap();
    };
    due_now();
    wait_for("the first run", || typed_lines(&mac).len() == 1);
    assert_eq!(typed_lines(&mac), ["Keep going with the next task"]);
    wait_for("the run recorded", || ok(&pat, None, &["loops", "list", "--project", &project]).contains("1 of 2 runs done"));

    // Busy (a turn in progress): the due run waits, then goes in when the turn ends.
    let sid = s.admin_request("GET", &format!("/rest/v1/loops?id=eq.{loop_id}&select=session_id"), None).unwrap()[0]["session_id"].as_str().unwrap().to_string();
    let busy = mac.home.join("run/busy").join(&sid);
    std::fs::create_dir_all(busy.parent().unwrap()).unwrap();
    std::fs::write(&busy, "").unwrap();
    due_now();
    std::thread::sleep(std::time::Duration::from_secs(3));
    assert_eq!(typed_lines(&mac).len(), 1, "it waits while the session is busy");
    std::fs::remove_file(&busy).unwrap();
    wait_for("the second run", || typed_lines(&mac).len() == 2);
    // That was the last of 2: finished.
    wait_for("the loop finished", || ok(&pat, None, &["loops", "list", "--project", &project]).starts_with("No loops are running."));
    let l = s.admin_request("GET", &format!("/rest/v1/loops?id=eq.{loop_id}&select=state,runs"), None).unwrap();
    assert_eq!((l[0]["state"].as_str(), l[0]["runs"].as_i64()), (Some("finished"), Some(2)));

    // Another loop; the session is quit: it ends, and its loop with it.
    ok(&pat, None, &["loops", "start", "Check in", "--every", "1h", "--session", "parser", "--project", &project]);
    assert!(ok(&pat, None, &["loops", "list", "--project", &project]).starts_with("parser\t"));
    close_window(&mac, w);
    assert!(ok(&pat, None, &["loops", "list", "--project", &project]).starts_with("No loops are running."));
    d.kill().unwrap();
}

#[test]
fn the_prompt_and_stop_hooks_mark_a_session_busy_and_free() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let (mut w, claude) = opened(&s, &mac, "parser", &project);
    hook(&mac, w.id(), "session-start", json!({ "session_id": claude, "cwd": "/work", "source": "startup" }));
    let sid = s.admin_request("GET", &format!("/rest/v1/sessions?name=eq.parser&select=id,projects!inner(name)&projects.name=eq.{project}"), None).unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let busy = mac.home.join("run/busy").join(&sid);
    hook(&mac, w.id(), "prompt", json!({ "session_id": claude, "prompt": "hi" }));
    assert!(busy.exists(), "a prompt marks it busy");
    hook(&mac, w.id(), "stop", json!({ "session_id": claude, "stop_hook_active": false }));
    assert!(!busy.exists(), "the end of the turn marks it free");
    // Inside the session, loops start and stop for it without naming it.
    assert!(ok(&mac, Some(w.id()), &["loops", "start", "Keep going", "--every", "10m"]).starts_with("Started a loop for parser"));
    assert!(ok(&mac, Some(w.id()), &["loops", "stop"]).starts_with("Stopped parser's loop"));
    w.kill().unwrap();
}

#[test]
fn rename_in_claude_renames_the_session_and_it_still_gets_messages() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name, path) = machine_with_claude(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let w = open_window(&mac, &path, &["parser", "--project", &project]);
    let claude_id = w.args[1].clone();
    let mut d = daemon(&mac, &path);

    // /rename writes a custom-title line into the transcript.
    let transcript = mac.home.join(format!("claude-code/projects/work/{claude_id}.jsonl"));
    let mut t = std::fs::OpenOptions::new().append(true).open(&transcript).unwrap();
    writeln!(t, "{}", json!({ "type": "custom-title", "customTitle": "Parser Work", "sessionId": claude_id })).unwrap();
    drop(t);
    wait_for("renamed", || ok(&pat, None, &["sessions", "list", "--project", &project]).starts_with("parser-work\t"));
    // Still running in the background under its new name, and messages
    // under that name reach it.
    wait_for("its runner renamed", || ok(&mac, None, &["sessions", "hosted"]).trim() == "parser-work");
    assert_eq!(ok(&mac, None, &["sessions", "send", "parser-work", "hello"]).trim(), "Sent it to parser-work.");
    wait_for("the message under the new name", || typed_lines(&mac) == ["hello"]);
    close_window(&mac, Opened { name: "parser-work".into(), args: w.args });
    d.kill().unwrap();
}

/// A stand-in claude for team sessions: writes how it was started to
/// `claude/<worker>.args` (one per line) and each line typed into it to
/// `claude/<worker>.typed`; ends on /exit.
fn team_claude(c: &Computer) -> String {
    let bin = c.home.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(
        bin.join("claude"),
        "#!/bin/sh\nd=\"$OMICRON_HOME/claude\"; mkdir -p \"$d\"\nprintf '%s\\n' \"$@\" > \"$d/$OMICRON_WORKER.args\"\npwd -P > \"$d/$OMICRON_WORKER.pwd\"\nwhile read -r line; do echo \"$line\" >> \"$d/$OMICRON_WORKER.typed\"; [ \"$line\" = \"/exit\" ] && exit 0; done\n",
    )
    .unwrap();
    Command::new("chmod").args(["+x", bin.join("claude").to_str().unwrap()]).status().unwrap();
    format!("{}:{}", bin.display(), std::env::var("PATH").unwrap())
}

fn read(c: &Computer, file: &str) -> String {
    std::fs::read_to_string(c.home.join("claude").join(file)).unwrap_or_default()
}

#[test]
fn a_team_runs_a_job_from_start_to_finish() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    let short = PathBuf::from(format!("/tmp/ot-{}", &Uuid::new_v4().simple().to_string()[..8]));
    std::fs::rename(&mac.home, &short).unwrap();
    let mac = Computer { home: short, tailscale: None };
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let path = team_claude(&mac);

    // A git folder for the team.
    let folder = mac.home.join("app");
    std::fs::create_dir_all(&folder).unwrap();
    let git = |dir: &std::path::Path, args: &[&str]| {
        let o = Command::new("git").arg("-C").arg(dir).args(["-c", "user.email=t@x", "-c", "user.name=T"]).args(args).output().unwrap();
        assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
        String::from_utf8_lossy(&o.stdout).to_string()
    };
    git(&folder, &["init", "-q", "-b", "main"]);
    git(&folder, &["config", "user.email", "t@x"]);
    git(&folder, &["config", "user.name", "T"]);
    std::fs::write(folder.join("README.md"), "app\n").unwrap();
    git(&folder, &["add", "."]);
    git(&folder, &["commit", "-qm", "start"]);

    let team = format!("web{}", &Uuid::new_v4().simple().to_string()[..4]);
    let run = |args: &[&str], worker: Option<&str>, team_id: Option<&str>| {
        let mut c = command(&mac, None, args);
        c.env("PATH", &path).current_dir(&folder);
        if let (Some(w), Some(t)) = (worker, team_id) {
            c.env("OMICRON_TEAM", t).env("OMICRON_WORKER", w);
        }
        let o = c.output().unwrap();
        (o.status.success(), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)))
    };
    assert!(run(&["teams", "init", "--name", &team], None, None).0);
    let mut d = daemon(&mac, &path);
    let (okay, out) = run(&["teams", "start", "--project", &project], None, None);
    assert!(okay, "{out}");

    // The daemon starts the lead, with its instructions, having told Claude
    // Code to trust the folder (nobody is there to answer that question).
    wait_for("the lead started", || !read(&mac, "lead.args").is_empty());
    let trust: Value = serde_json::from_str(&std::fs::read_to_string(mac.home.join("claude-code/.claude.json")).unwrap()).unwrap();
    assert_eq!(trust["projects"][folder.canonicalize().unwrap().to_string_lossy().as_ref()]["hasTrustDialogAccepted"], json!(true));
    assert!(read(&mac, "lead.args").contains(&format!("You are the lead of the team {team}")));
    let tid = s.admin_request("GET", &format!("/rest/v1/teams?name=eq.{team}&select=id"), None).unwrap()[0]["id"].as_str().unwrap().to_string();
    let t = Some(tid.as_str());

    // A new job: the lead is told.
    assert!(run(&["teams", "add-job", &team, "Add a login page"], None, None).0);
    wait_for("the lead told about the job", || read(&mac, "lead.typed").contains("New job #1: Add a login page"));

    // Only the lead starts workers.
    let (okay, out) = run(&["teams", "start-worker", "planner", "--job", "1"], Some("builder"), t);
    assert!(!okay && out.contains("only the lead can start workers"), "{out}");
    let (okay, out) = run(&["teams", "start-worker", "planner", "--job", "1"], Some("lead"), t);
    assert!(okay && out.trim() == "Started planner on job #1.", "{out}");
    wait_for("the planner started", || read(&mac, "planner.args").contains("Job #1: Add a login page"));
    // One per job and role.
    let (okay, out) = run(&["teams", "start-worker", "planner", "--job", "1"], Some("lead"), t);
    assert!(!okay && out.contains("planner is already on job #1"), "{out}");
    let (_, jobs) = run(&["teams", "jobs", &team], None, None);
    assert_eq!(jobs, "#1\tworking (planner)\tAdd a login page\n");

    // The planner asks a person: a task given to Pat (who added the job),
    // the job blocked; Pat's answer goes back to the planner.
    let (okay, out) = run(&["teams", "ask", "Email login, or Google too?"], Some("planner"), t);
    assert!(okay && out.starts_with("Asked (task #"), "{out}");
    let (_, jobs) = run(&["teams", "jobs", &team], None, None);
    assert!(jobs.starts_with("#1\tblocked"), "{jobs}");
    let n = out.trim_start_matches("Asked (task #").split(')').next().unwrap().to_string();
    let shown = ok(&pat, None, &["tasks", "show", &project, &n]);
    assert!(shown.contains(&format!("{team}: planner asks about job #1")) && shown.contains("Email login, or Google too?"), "{shown}");
    ok(&pat, None, &["tasks", "comment", &project, &n, "Email only for now."]);
    // From elsewhere, with the gate closed: it waits, and isn't dropped.
    std::thread::sleep(std::time::Duration::from_secs(3));
    assert!(!read(&mac, "planner.typed").contains("Email only for now."), "the answer waits for the gate");
    assert!(run(&["teams", "jobs", &team], None, None).1.starts_with("#1\tblocked"));
    // Pat owns the machine and opens its gate: passed on then.
    open_gate(&mac, &pat);
    wait_for("the answer reached the planner", || read(&mac, "planner.typed").contains("Email only for now."));
    wait_for("the job working again", || run(&["teams", "jobs", &team], None, None).1.starts_with("#1\tworking"));

    // A heads-up goes to everyone running, and into the folder.
    let (okay, out) = run(&["teams", "heads-up", "npm test takes 3 minutes; don't kill it."], Some("planner"), t);
    assert!(okay, "{out}");
    wait_for("the lead got the heads-up", || read(&mac, "lead.typed").contains("Heads-up from planner: npm test takes 3 minutes"));
    assert!(std::fs::read_to_string(folder.join(".omicron-team/heads-ups.md")).unwrap().contains("(planner): npm test takes 3 minutes"));

    // The planner hands it to the builder; the lead is told.
    let (okay, out) = run(&["teams", "handoff", "builder", "--note", "Plan: one form, one route."], Some("planner"), t);
    assert!(okay, "{out}");
    wait_for("the lead told about the handoff", || read(&mac, "lead.typed").contains("planner handed job #1 to builder"));
    assert!(run(&["teams", "start-worker", "builder", "--job", "1"], Some("lead"), t).0);
    wait_for("the builder started", || read(&mac, "builder.args").contains("Notes so far: Plan: one form, one route."));

    // The builder works in the job's own worktree, on its branch, and says it's done.
    let worktree = mac.home.join("teams").join(format!("{team}-{}", &tid[..8])).join("job-1");
    assert_eq!(git(&worktree, &["branch", "--show-current"]).trim(), "job/1-add-a-login-page");
    std::fs::write(worktree.join("login.html"), "<form></form>\n").unwrap();
    git(&worktree, &["add", "."]);
    git(&worktree, &["commit", "-qm", "Login page"]);
    assert!(run(&["teams", "handoff", "done", "--note", "Built and tested."], Some("builder"), t).0);
    wait_for("the lead told it's done", || read(&mac, "lead.typed").contains("builder says job #1 is done"));

    // The lead finishes it: merged onto main, workers stopped.
    let (okay, out) = run(&["teams", "finish", "1"], Some("lead"), t);
    assert!(okay, "{out}");
    assert!(folder.join("login.html").exists(), "merged onto the base branch");
    assert!(git(&folder, &["log", "--oneline", "-1"]).contains("Job #1: Add a login page"));
    wait_for("its workers stopped", || read(&mac, "builder.typed").contains("/exit") && read(&mac, "planner.typed").contains("/exit"));
    let (_, jobs) = run(&["teams", "jobs", &team], None, None);
    assert!(jobs.starts_with("#1\tdone"), "{jobs}");

    // Stopping the team stops the lead.
    run(&["teams", "stop", &team], None, None);
    wait_for("the lead stopped", || read(&mac, "lead.typed").contains("/exit"));
    d.kill().unwrap();
}

/// Parts, being blocked, the advisor, handing over a long conversation,
/// stopping a worker, and the team and its daemon coming back: the rest of
/// what a team does, with a stand-in for Claude.
#[test]
fn a_team_splits_a_job_into_parts_and_comes_back_after_restarts() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    let short = PathBuf::from(format!("/tmp/op-{}", &Uuid::new_v4().simple().to_string()[..8]));
    std::fs::rename(&mac.home, &short).unwrap();
    let mac = Computer { home: short, tailscale: None };
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let path = team_claude(&mac);

    let folder = mac.home.join("app");
    std::fs::create_dir_all(&folder).unwrap();
    let git = |dir: &std::path::Path, args: &[&str]| {
        let o = Command::new("git").arg("-C").arg(dir).args(["-c", "user.email=t@x", "-c", "user.name=T"]).args(args).output().unwrap();
        (o.status.success(), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)))
    };
    git(&folder, &["init", "-q", "-b", "main"]);
    git(&folder, &["config", "user.email", "t@x"]);
    git(&folder, &["config", "user.name", "T"]);
    std::fs::write(folder.join("app.txt"), "app\n").unwrap();
    git(&folder, &["add", "."]);
    git(&folder, &["commit", "-qm", "start"]);

    let team = format!("pt{}", &Uuid::new_v4().simple().to_string()[..4]);
    let run = |args: &[&str], worker: Option<&str>, team_id: Option<&str>, part: Option<&str>| {
        let mut c = command(&mac, None, args);
        c.env("PATH", &path).env("OMICRON_NO_GUIDE", "1").current_dir(&folder);
        if let (Some(w), Some(t)) = (worker, team_id) {
            c.env("OMICRON_TEAM", t).env("OMICRON_WORKER", w).env("OMICRON_TEAM_FOLDER", &folder);
        }
        if let Some(p) = part {
            c.env("OMICRON_PART", p);
        }
        let o = c.output().unwrap();
        (o.status.success(), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)))
    };
    assert!(run(&["teams", "init", "--name", &team], None, None, None).0);
    // With the advisor on.
    let setup = folder.join(".omicron-team/team.json");
    let text = std::fs::read_to_string(&setup).unwrap().replace("\"advisor\": false", "\"advisor\": true");
    std::fs::write(&setup, text).unwrap();
    git(&folder, &["add", "."]);
    git(&folder, &["commit", "-qm", "team"]);
    let mut d = daemon(&mac, &path);
    assert!(run(&["teams", "start", "--project", &project], None, None, None).0);
    wait_for("the lead and the advisor started", || !read(&mac, "lead.args").is_empty() && !read(&mac, "advisor.args").is_empty());
    assert!(read(&mac, "advisor.args").contains(&format!("You are the advisor of the team {team}")));
    let rows = s.admin_request("GET", &format!("/rest/v1/teams?name=eq.{team}&select=id"), None).unwrap();
    let tid = rows[0]["id"].as_str().unwrap().to_string();
    let t = Some(tid.as_str());

    // A job, split into two parts that two builders work at once, each in
    // its own checkout off the job's branch.
    assert!(run(&["teams", "add-job", &team, "Login and sign-up"], None, None, None).0);
    let (okay, out) = run(&["teams", "start-worker", "builder", "--job", "1", "--part", "the login form"], Some("lead"), t, None);
    assert!(okay && out.contains("Started builder on a part of job #1: the login form"), "{out}");
    let (okay, out) = run(&["teams", "start-worker", "builder", "--job", "1", "--part", "the sign-up form"], Some("lead"), t, None);
    assert!(okay && out.contains("Started builder-2 on a part of job #1"), "{out}");
    wait_for("both builders started", || !read(&mac, "builder.pwd").is_empty() && !read(&mac, "builder-2.pwd").is_empty());
    let one = PathBuf::from(read(&mac, "builder.pwd").trim());
    let two = PathBuf::from(read(&mac, "builder-2.pwd").trim());
    assert!(one.ends_with("job-1-part-1") && two.ends_with("job-1-part-2"), "{one:?} {two:?}");
    assert!(read(&mac, "builder.args").contains("Your part (part 1): the login form"));
    assert!(read(&mac, "builder-2.args").contains("Only do your part"));

    // Being blocked: the job says so and the lead hears.
    let (okay, out) = run(&["teams", "blocked", "Which login library?"], Some("builder"), t, Some("1"));
    assert!(okay, "{out}");
    assert!(run(&["teams", "jobs", &team], None, None, None).1.starts_with("#1\tblocked"));
    wait_for("the lead heard it's blocked", || read(&mac, "lead.typed").contains("builder is blocked on job #1: Which login library?"));

    // Both parts change the same file: the first merges, the second clashes
    // and goes back to its builder.
    std::fs::write(one.join("app.txt"), "app\nlogin\n").unwrap();
    git(&one, &["commit", "-qam", "login"]);
    // Uncommitted work is refused first.
    std::fs::write(two.join("app.txt"), "app\nsignup\n").unwrap();
    let (okay, out) = run(&["teams", "handoff", "done", "--note", "Sign-up done."], Some("builder-2"), t, Some("2"));
    assert!(!okay && out.contains("commit your part's work first"), "{out}");
    git(&two, &["commit", "-qam", "signup"]);

    let (okay, out) = run(&["teams", "handoff", "done", "--note", "Login done."], Some("builder"), t, Some("1"));
    assert!(okay && out.contains("Your part is merged into job #1's branch"), "{out}");
    wait_for("the lead heard part 1 is in", || read(&mac, "lead.typed").contains("finished part 1 of job #1 (the login form)"));
    assert!(read(&mac, "lead.typed").contains("Parts still going: 2."));
    // The advisor hears things moved (at most every ten minutes).
    wait_for("the advisor was nudged", || read(&mac, "advisor.typed").contains("Since you last looked"));

    // Finishing waits for every part.
    let (okay, out) = run(&["teams", "finish", "1"], Some("lead"), t, None);
    assert!(!okay && out.contains("has parts still going (2)"), "{out}");

    let (okay, out) = run(&["teams", "handoff", "done", "--note", "Sign-up done."], Some("builder-2"), t, Some("2"));
    assert!(!okay && out.contains("your part clashes with the job's branch"), "{out}");
    // The builder fixes the clash in its part, and hands off again.
    let (_, merged) = git(&two, &["merge", "job/1-login-and-sign-up"]);
    assert!(merged.contains("CONFLICT"), "{merged}");
    std::fs::write(two.join("app.txt"), "app\nlogin\nsignup\n").unwrap();
    git(&two, &["commit", "-qam", "both forms"]);
    let (okay, out) = run(&["teams", "handoff", "done", "--note", "Sign-up done, clash fixed."], Some("builder-2"), t, Some("2"));
    assert!(okay, "{out}");
    wait_for("the lead heard every part is in", || read(&mac, "lead.typed").contains("All its parts are in"));

    // The advisor suggests; only the advisor can.
    let (okay, _) = run(&["teams", "suggest", "Split sign-up email into its own job."], Some("advisor"), t, None);
    assert!(okay);
    wait_for("the lead got the suggestion", || read(&mac, "lead.typed").contains("The advisor suggests: Split sign-up email"));
    let (okay, out) = run(&["teams", "suggest", "x"], Some("builder"), t, None);
    assert!(!okay && out.contains("only the advisor"), "{out}");

    // A long conversation is handed over: the builder starts again, fresh,
    // as itself, on its part, with the note.
    let first_args = read(&mac, "builder.args");
    let (okay, out) = run(&["teams", "handover", "--note", "Login form done; tests next."], Some("builder"), t, Some("1"));
    assert!(okay && out.contains("Handover saved"), "{out}");
    wait_for("a fresh builder started", || {
        let a = read(&mac, "builder.args");
        a != first_args && a.contains("Login form done; tests next.")
    });
    assert!(read(&mac, "builder.args").contains("Your part (part 1): the login form"));

    // The lead stops a worker; only the lead can.
    let (okay, out) = run(&["teams", "stop-worker", "builder-2"], Some("builder"), t, None);
    assert!(!okay && out.contains("only the lead"), "{out}");
    assert!(run(&["teams", "stop-worker", "builder-2"], Some("lead"), t, None).0);
    wait_for("builder-2 stopped", || !run(&["sessions", "hosted"], None, None, None).1.contains(&format!("{team}.builder-2")));

    // Finished: both parts on main, and their checkouts and branches gone.
    let (okay, out) = run(&["teams", "finish", "1"], Some("lead"), t, None);
    assert!(okay, "{out}");
    assert_eq!(std::fs::read_to_string(folder.join("app.txt")).unwrap(), "app\nlogin\nsignup\n");
    assert!(!one.exists() && !two.exists());
    assert!(!git(&folder, &["branch"]).1.contains("part-"));

    // The daemon restarting brings the lead back.
    d.kill().unwrap();
    let _ = d.wait();
    run(&["sessions", "send", &format!("{team}.lead"), "/exit"], None, None, None);
    wait_for("the lead ended", || !run(&["sessions", "hosted"], None, None, None).1.contains(&format!("{team}.lead")));
    std::fs::remove_file(mac.home.join("claude/lead.args")).unwrap();
    let mut d = daemon(&mac, &path);
    wait_for("the lead came back", || !read(&mac, "lead.args").is_empty());

    // Stopped, then started again: the same team; everyone stops.
    assert!(run(&["teams", "stop", &team], None, None, None).0);
    wait_for("the team's sessions stopped", || {
        let hosted = run(&["sessions", "hosted"], None, None, None).1;
        !hosted.contains(&format!("{team}.lead")) && !hosted.contains(&format!("{team}.advisor"))
    });
    std::fs::remove_file(mac.home.join("claude/lead.args")).unwrap();
    assert!(run(&["teams", "start", "--project", &project], None, None, None).0);
    wait_for("the lead started again", || !read(&mac, "lead.args").is_empty());
    run(&["teams", "stop", &team], None, None, None);
    for w in ["lead", "advisor", "builder"] {
        run(&["sessions", "send", &format!("{team}.{w}"), "/exit"], None, None, None);
    }
    d.kill().unwrap();
    let _ = d.wait();
}

/// Loops when things go wrong: two daemons for one machine (each run typed
/// once), the daemon restarting (the loop carries on), and an end time that
/// passed while nothing ran (it ends without typing).
#[test]
fn a_loop_runs_once_with_two_daemons_survives_a_restart_and_ends_on_time() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name, path) = machine_with_claude(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);
    let w = open_window(&mac, &path, &["parser", "--project", &project]);
    // Started from elsewhere: it only runs while the gate is open.
    open_gate(&mac, &pat);
    ok(&pat, None, &["loops", "start", "Next task please", "--every", "10m", "--session", "parser", "--project", &project]);
    let loop_id = s
        .admin_request("GET", "/rest/v1/loops?prompt=eq.Next task please&state=eq.running&select=id,sessions!inner(projects!inner(name))", None)
        .unwrap()
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["sessions"]["projects"]["name"] == json!(project))
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let due_now = || {
        s.admin_request("PATCH", &format!("/rest/v1/loops?id=eq.{loop_id}"), Some(json!({ "next_run_at": "2020-01-01T00:00:00Z" }))).unwrap();
    };
    let sid = s.admin_request("GET", &format!("/rest/v1/loops?id=eq.{loop_id}&select=session_id"), None).unwrap()[0]["session_id"].as_str().unwrap().to_string();
    let not_busy = || {
        let _ = std::fs::remove_file(mac.home.join("run/busy").join(&sid));
    };

    // Two daemons for the same machine: each due run goes in once.
    let mut d1 = daemon(&mac, &path);
    let mut d2 = daemon(&mac, &path);
    for round in 1..=3 {
        not_busy();
        due_now();
        wait_for("the run", || typed_lines(&mac).len() == round);
        std::thread::sleep(std::time::Duration::from_secs(2));
        assert_eq!(typed_lines(&mac).len(), round, "sent twice with two daemons running: {:?}", typed_lines(&mac));
    }
    let runs = s.admin_request("GET", &format!("/rest/v1/loops?id=eq.{loop_id}&select=runs"), None).unwrap()[0]["runs"].as_i64();
    assert_eq!(runs, Some(3));

    // The daemon restarts: the loop carries on.
    let _ = d1.kill();
    let _ = d2.kill();
    let _ = d1.wait();
    let _ = d2.wait();
    let mut d3 = daemon(&mac, &path);
    not_busy();
    due_now();
    wait_for("a run after the restart", || typed_lines(&mac).len() == 4);

    // Its end time passed while it wasn't due: it ends, and nothing more is typed.
    s.admin_request(
        "PATCH",
        &format!("/rest/v1/loops?id=eq.{loop_id}"),
        Some(json!({ "until": "2020-06-01T00:00:00Z", "next_run_at": "2020-07-01T00:00:00Z" })),
    )
    .unwrap();
    not_busy();
    wait_for("the loop ended", || {
        s.admin_request("GET", &format!("/rest/v1/loops?id=eq.{loop_id}&select=state"), None).unwrap()[0]["state"] != json!("running")
    });
    std::thread::sleep(std::time::Duration::from_secs(2));
    assert_eq!(typed_lines(&mac).len(), 4, "nothing sent after its end time");

    let _ = d3.kill();
    let _ = d3.wait();
    close_window(&mac, w);
}

/// Make a person a machine's owner and open its gate for two hours: then
/// it takes their orders (ref/BRAINSTORM.md, "The gate").
fn open_gate(mac: &Computer, owner: &Computer) {
    let status: Value = serde_json::from_str(&std::fs::read_to_string(owner.tailscale.as_ref().unwrap()).unwrap()).unwrap();
    let login = status["User"]["1"]["LoginName"].as_str().unwrap();
    let said = ok(mac, None, &["machines", "owner", login]);
    assert!(said.contains("owns this machine now"), "{said}");
    let later = std::process::Command::new("date").args(["-v+2H", "+%H:%M"]).output().unwrap();
    ok(mac, None, &["gate", "open", "--until", String::from_utf8_lossy(&later.stdout).trim()]);
}

/// Linking (ref/BRAINSTORM.md, "Linking"): a Claude started in one of the
/// machine's folders links itself; any other chat links with `omicron link`
/// typed into it, without quitting.
#[test]
fn a_chat_in_a_folder_links_itself_and_any_other_links_in_place() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    ok(&pat, None, &["machines", "add", &mac_name, &project]);

    // A folder: Omicron's hooks go in its own local settings, kept out of git.
    let app = mac.home.join("app");
    std::fs::create_dir_all(&app).unwrap();
    let app = app.canonicalize().unwrap();
    Command::new("git").arg("-C").arg(&app).args(["init", "-q"]).status().unwrap();
    let o = command(&mac, None, &["folders", "add"]).current_dir(&app).output().unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let settings = std::fs::read_to_string(app.join(".claude/settings.local.json")).unwrap();
    assert!(settings.contains("hook session-start") && settings.contains("hook session-end"), "{settings}");
    let ignored = Command::new("git").arg("-C").arg(&app).args(["check-ignore", "-q", ".claude/settings.local.json"]).status().unwrap();
    assert!(ignored.success(), "kept out of git");

    // A plain Claude started there (in a folder inside it too): linked at
    // start, named after the folder, and told so.
    let mut w = window();
    let chat = Uuid::new_v4().to_string();
    let said = hook_out(&mac, w.id(), "session-start", json!({ "session_id": chat, "cwd": app.to_str().unwrap(), "source": "startup" }));
    assert!(said.contains(&format!("this chat is the session app in the Project {project}")), "{said}");
    let mut w2 = window();
    let sub = app.join("web");
    std::fs::create_dir_all(&sub).unwrap();
    hook_out(&mac, w2.id(), "session-start", json!({ "session_id": Uuid::new_v4().to_string(), "cwd": sub.to_str().unwrap(), "source": "startup" }));
    let listed = ok(&pat, None, &["sessions", "list"]);
    assert!(listed.lines().any(|l| l.contains("app") && !l.contains("web")) && listed.contains("web"), "{listed}");
    // It ends when it closes.
    hook(&mac, w.id(), "session-end", json!({ "session_id": chat, "reason": "prompt_input_exit" }));
    hook(&mac, w2.id(), "session-end", json!({ "session_id": Uuid::new_v4().to_string(), "reason": "prompt_input_exit" }));
    w.kill().unwrap();
    w2.kill().unwrap();

    // A chat anywhere else: typed into it, `omicron link` brings it in.
    let notes = mac.home.join("notes");
    std::fs::create_dir_all(&notes).unwrap();
    let notes = notes.canonicalize().unwrap();
    let mut w3 = window();
    let chat = Uuid::new_v4().to_string();
    let link = |args: &[&str]| {
        let mut all = vec!["link"];
        all.extend_from_slice(args);
        command(&mac, Some(w3.id()), &all).env("CLAUDE_CODE_SESSION_ID", &chat).current_dir(&notes).output().unwrap()
    };
    let o = link(&[]);
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    assert!(String::from_utf8_lossy(&o.stdout).starts_with(&format!("This chat is now the session notes in {project}")));
    let o = link(&[]);
    assert!(!o.status.success() && String::from_utf8_lossy(&o.stderr).contains("already linked"));
    // Its folder is remembered: the next chat there links itself.
    assert!(ok(&pat, None, &["folders", "list", "--project", &project]).contains(notes.to_str().unwrap()));
    // Outside a chat there's nothing to link.
    let o = command(&mac, None, &["link"]).output().unwrap();
    assert!(!o.status.success() && String::from_utf8_lossy(&o.stderr).contains("! omicron link"));
    hook(&mac, w3.id(), "session-end", json!({ "session_id": chat, "reason": "prompt_input_exit" }));
    w3.kill().unwrap();
    assert!(!ok(&pat, None, &["sessions", "list"]).contains("notes"));
}

/// A run (ref/BRAINSTORM.md, "Runs"): the daemon gives the session the top
/// To do task, and when it's finished has it hand off and clear, then gives
/// it the next; paused, it stops after the task it's on.
#[test]
fn a_run_works_down_to_do_one_task_at_a_time() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    let short = PathBuf::from(format!("/tmp/or-{}", &Uuid::new_v4().simple().to_string()[..8]));
    std::fs::rename(&mac.home, &short).unwrap();
    let mac = Computer { home: short, tailscale: None };
    ok(&pat, None, &["machines", "add", &mac_name, &project]);

    // A stand-in for Claude: runs the start hook, then writes down what's typed in.
    let bin = mac.home.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let o = env!("CARGO_BIN_EXE_omicron");
    std::fs::write(
        bin.join("claude"),
        format!(
            "#!/bin/sh\nd=\"$OMICRON_HOME/claude\"; mkdir -p \"$d\"\nid=\nwhile [ $# -gt 0 ]; do case \"$1\" in --session-id) id=\"$2\"; shift;; esac; shift; done\necho $$ > \"$d/run.pid\"\nprintf '{{\"session_id\":\"%s\",\"cwd\":\"%s\",\"source\":\"startup\"}}' \"$id\" \"$PWD\" | {o} hook session-start > /dev/null\nwhile read -r line; do echo \"$line\" >> \"$d/run.typed\"; done\n"
        ),
    )
    .unwrap();
    Command::new("chmod").args(["+x", bin.join("claude").to_str().unwrap()]).status().unwrap();
    let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap());
    let folder = mac.home.join("app");
    std::fs::create_dir_all(&folder).unwrap();
    let o = command(&mac, None, &["open", "runner", "--project", &project]).env("PATH", &path).current_dir(&folder).stdin(Stdio::null()).output().unwrap();
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    wait_for("claude started", || read(&mac, "run.pid").trim().parse::<u32>().is_ok());
    let pid: u32 = read(&mac, "run.pid").trim().parse().unwrap();

    ok(&pat, None, &["tasks", "add", &project, "First thing"]);
    ok(&pat, None, &["tasks", "add", &project, "Second thing"]);
    let mut d = daemon(&mac, &path);

    // Started on the machine: it gives the session the top task.
    let said = ok(&mac, None, &["runs", "start", &project, "--session", "runner"]);
    assert!(said.starts_with("Started a run in runner"), "{said}");
    wait_for("the first task typed in", || read(&mac, "run.typed").contains("Omicron run: your next task is #1 \"First thing\""));
    let mine = ok(&mac, Some(pid), &["tasks", "mine"]);
    assert!(mine.contains(&format!("#1 in {project}: First thing (new)")), "handed over here: {mine}");
    assert!(ok(&pat, None, &["runs", "list", &project]).contains("running\t0 done\ton #1: First thing"));

    // Done with it: it's asked for its handoff note, cleared once it's
    // saved, then given the next.
    ok(&pat, None, &["tasks", "done", &project, "1"]);
    wait_for("asked for its note", || read(&mac, "run.typed").contains("Omicron: write your handoff note now"));
    ok(&mac, Some(pid), &["handoff", "write", "# First thing done\nOn to the next."]);
    wait_for("cleared", || read(&mac, "run.typed").contains("/clear"));
    wait_for("the second task typed in", || read(&mac, "run.typed").contains("your next task is #2 \"Second thing\""));

    // Paused: it stops after the task it's on, with nothing more typed in.
    ok(&pat, None, &["runs", "pause", &project]);
    ok(&pat, None, &["tasks", "done", &project, "2"]);
    wait_for("stopped after #2", || ok(&pat, None, &["runs", "list", &project]).contains("stopped\t2 done\tpaused after #2"));
    assert!(!read(&mac, "run.typed").contains("write your handoff note now\nOmicron: write"), "no second handoff");

    // A new run with nothing left in To do finishes at once.
    ok(&mac, None, &["runs", "start", &project, "--session", "runner"]);
    wait_for("finished", || ok(&pat, None, &["runs", "list", &project]).lines().next().unwrap_or("").contains("finished\t0 done\tfinished: To do is empty (0 done)"));
    d.kill().unwrap();
    ok(&mac, None, &["sessions", "send", "runner", "\u{4}", "--no-enter"]);
    let _ = Command::new("kill").arg(pid.to_string()).status();
}

/// In a run, a task labelled "team" goes to a team running here as a
/// linked job, and the run carries on; when the job finishes, the session
/// checks it, and the run finishes once nothing's left (#92).
#[test]
fn a_run_gives_big_tasks_to_a_team_and_checks_them_after() {
    let s = supabase_or_skip!();
    let pat = person(&s, "Pat");
    let project = unique("Code");
    ok(&pat, None, &["projects", "new", &project]);
    let (mac, mac_name) = machine(&s);
    let short = PathBuf::from(format!("/tmp/oq-{}", &Uuid::new_v4().simple().to_string()[..8]));
    std::fs::rename(&mac.home, &short).unwrap();
    let mac = Computer { home: short, tailscale: None };
    ok(&pat, None, &["machines", "add", &mac_name, &project]);

    // One stand-in for Claude: a team member writes what's typed to
    // <worker>.typed; the run's session also runs the start hook.
    let bin = mac.home.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let o = env!("CARGO_BIN_EXE_omicron");
    std::fs::write(
        bin.join("claude"),
        format!(
            "#!/bin/sh\nd=\"$OMICRON_HOME/claude\"; mkdir -p \"$d\"\nif [ -n \"$OMICRON_WORKER\" ]; then while read -r line; do echo \"$line\" >> \"$d/$OMICRON_WORKER.typed\"; [ \"$line\" = \"/exit\" ] && exit 0; done; exit 0; fi\nid=\nwhile [ $# -gt 0 ]; do case \"$1\" in --session-id) id=\"$2\"; shift;; esac; shift; done\necho $$ > \"$d/run.pid\"\nprintf '{{\"session_id\":\"%s\",\"cwd\":\"%s\",\"source\":\"startup\"}}' \"$id\" \"$PWD\" | {o} hook session-start > /dev/null\nwhile read -r line; do echo \"$line\" >> \"$d/run.typed\"; done\n"
        ),
    )
    .unwrap();
    Command::new("chmod").args(["+x", bin.join("claude").to_str().unwrap()]).status().unwrap();
    let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap());
    let run = |args: &[&str], dir: &std::path::Path| {
        let o = command(&mac, None, args).env("PATH", &path).current_dir(dir).stdin(Stdio::null()).output().unwrap();
        assert!(o.status.success(), "{args:?}: {}", String::from_utf8_lossy(&o.stderr));
        String::from_utf8_lossy(&o.stdout).to_string()
    };

    // A team here for the Project, and the run's session.
    let folder = mac.home.join("app");
    std::fs::create_dir_all(&folder).unwrap();
    for args in [&["init", "-q", "-b", "main"][..], &["-c", "user.email=t@x", "-c", "user.name=T", "commit", "-q", "--allow-empty", "-m", "start"][..]] {
        assert!(Command::new("git").arg("-C").arg(&folder).args(args).status().unwrap().success());
    }
    let team = format!("web{}", &Uuid::new_v4().simple().to_string()[..4]);
    let mut d = daemon(&mac, &path);
    run(&["teams", "init", "--name", &team], &folder);
    run(&["teams", "start", "--project", &project], &folder);
    run(&["open", "runner", "--project", &project], &folder);
    wait_for("claude started", || read(&mac, "run.pid").trim().parse::<u32>().is_ok());
    let pid: u32 = read(&mac, "run.pid").trim().parse().unwrap();

    ok(&pat, None, &["tasks", "add", &project, "Big feature", "--label", "team", "--notes", "Login with email."]);
    ok(&pat, None, &["tasks", "add", &project, "Small fix"]);
    run(&["runs", "start", &project, "--session", "runner"], &folder);

    // The big one goes to the team, linked; the session gets the small one.
    wait_for("the small task typed in", || read(&mac, "run.typed").contains("your next task is #2 \"Small fix\""));
    let jobs = ok(&pat, None, &["teams", "jobs", &team]);
    assert!(jobs.contains("#1\twaiting") && jobs.contains("Big feature"), "{jobs}");
    assert!(ok(&pat, None, &["tasks", "show", &project, "1"]).contains(&format!("Job: {team} #1 Big feature")));
    wait_for("the lead told", || read(&mac, "lead.typed").contains("New job #1: Big feature"));

    // Small one done: hand off, then it waits for the team.
    ok(&pat, None, &["tasks", "done", &project, "2"]);
    wait_for("asked for its note", || read(&mac, "run.typed").contains("Omicron: write your handoff note now"));
    ok(&mac, Some(pid), &["handoff", "write", "# Small fix done"]);
    wait_for("waiting for the team", || ok(&pat, None, &["runs", "list", &project]).contains(&format!("waiting for the team: #1 ({team} job #1)")));

    // The team's job finishes: the session checks it.
    let job = s.admin_request("GET", &format!("/rest/v1/jobs?title=eq.Big%20feature&select=id,teams!inner(name)&teams.name=eq.{team}"), None).unwrap();
    s.admin_request("PATCH", &format!("/rest/v1/jobs?id=eq.{}", job[0]["id"].as_str().unwrap()), Some(json!({ "state": "done" }))).unwrap();
    wait_for("asked to check it", || read(&mac, "run.typed").contains(&format!("the team {team} finished job #1 for task #1 \"Big feature\"")));
    ok(&pat, None, &["tasks", "done", &project, "1"]);
    wait_for("asked for its note again", || read(&mac, "run.typed").matches("write your handoff note now").count() == 2);
    ok(&mac, Some(pid), &["handoff", "write", "# Big feature checked"]);
    wait_for("finished", || ok(&pat, None, &["runs", "list", &project]).contains("finished\t2 done\tfinished: To do is empty (2 done)"));

    run(&["teams", "stop", &team], &folder);
    d.kill().unwrap();
    ok(&mac, None, &["sessions", "send", "runner", "\u{4}", "--no-enter"]);
    let _ = Command::new("kill").arg(pid.to_string()).status();
}
