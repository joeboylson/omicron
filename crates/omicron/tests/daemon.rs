//! End-to-end tests for `omicron daemon`: run the real program as a
//! registered machine, change things in Supabase, and read what it prints.
//!
//! Runs only when the test Supabase is set up (see `dev/supabase/test.sh`).

use omicron::identity::TailscalePerson;
use omicron::supa::{Session, Supabase};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};
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

/// A settings folder for a machine registered as `name`. Returns the folder
/// and the machine's id.
fn registered_machine(s: &Supabase, name: &str) -> (PathBuf, Uuid) {
    let home = std::env::temp_dir().join(format!("omicron-test-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&home).unwrap();
    let key = s.register_machine(name, false).unwrap();
    std::fs::write(
        home.join("config.json"),
        json!({ "supabase_url": s.url, "supabase_key": s.key, "machine_key": key.to_string() }).to_string(),
    )
    .unwrap();
    (home, key.machine_id)
}

/// A running `omicron daemon`, with its output arriving on channels.
struct Daemon {
    child: Child,
    lines: Receiver<Value>,
    errors: Receiver<String>,
}

impl Drop for Daemon {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start_daemon(home: &Path, args: &[&str]) -> Daemon {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_omicron"));
    for (k, _) in std::env::vars() {
        if k.starts_with("OMICRON_") {
            cmd.env_remove(k);
        }
    }
    let mut child = cmd
        .env("OMICRON_HOME", home)
        .arg("daemon")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let (line_tx, lines) = channel();
    let stdout = child.stdout.take().unwrap();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let _ = line_tx.send(serde_json::from_str(&line).unwrap_or(Value::String(line)));
        }
    });
    let (err_tx, errors) = channel();
    let stderr = child.stderr.take().unwrap();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = err_tx.send(line);
        }
    });
    Daemon { child, lines, errors }
}

impl Daemon {
    /// Wait until it says it's listening.
    fn wait_until_listening(&self) {
        let deadline = Instant::now() + Duration::from_secs(15);
        let mut seen = Vec::new();
        while Instant::now() < deadline {
            if let Ok(line) = self.errors.recv_timeout(Duration::from_millis(200)) {
                if line.contains("listening for changes") {
                    return;
                }
                seen.push(line);
            }
        }
        panic!("the daemon never started listening. It said: {seen:?}");
    }

    /// The next change matching `want`, skipping others.
    fn wait_for(&self, what: &str, want: impl Fn(&Value) -> bool) -> Value {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut seen = Vec::new();
        while Instant::now() < deadline {
            if let Ok(line) = self.lines.recv_timeout(Duration::from_millis(200)) {
                if want(&line) {
                    return line;
                }
                seen.push(line);
            }
        }
        panic!("no change for {what} arrived. Got: {seen:?}");
    }

    /// Every change printed so far.
    fn drain(&self) -> Vec<Value> {
        self.lines.try_iter().collect()
    }
}

fn person(s: &Supabase, name: &str) -> Session {
    s.sign_in_person(&TailscalePerson { login: format!("{}@example.com", unique(name)), display_name: name.into() }).unwrap()
}

fn start_project(s: &Supabase, as_: &Session, name: &str) -> String {
    let row = s.request_as(as_, "POST", "/rest/v1/rpc/start_project", Some(json!({ "name": name }))).unwrap();
    row["id"].as_str().unwrap().to_string()
}

#[test]
fn the_daemon_checks_in_when_it_starts() {
    let s = supabase_or_skip!();
    let name = unique("checkin");
    let (home, id) = registered_machine(&s, &name);
    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();
    let row = s.admin_request("GET", &format!("/rest/v1/machines?id=eq.{id}&select=last_seen"), None).unwrap();
    assert!(row[0]["last_seen"].is_string(), "{row}");
}

#[test]
fn the_daemon_hears_when_its_machine_is_added_to_a_project() {
    let s = supabase_or_skip!();
    let (home, id) = registered_machine(&s, &unique("added"));
    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();

    let me = person(&s, "owner");
    let project = start_project(&s, &me, "Work");
    s.request_as(&me, "POST", "/rest/v1/project_machines", Some(json!({ "project_id": project, "machine_id": id }))).unwrap();

    let change = daemon.wait_for("being added to the project", |c| c["table"] == "project_machines" && c["type"] == "INSERT");
    assert_eq!(change["record"]["project_id"], project.as_str());
    assert_eq!(change["record"]["machine_id"], id.to_string());
}

#[test]
fn the_daemon_only_hears_about_its_own_projects() {
    let s = supabase_or_skip!();
    let (home, id) = registered_machine(&s, &unique("private"));
    let me = person(&s, "owner");
    let mine = start_project(&s, &me, "Mine");
    let other = start_project(&s, &me, "Not mine");
    s.request_as(&me, "POST", "/rest/v1/project_machines", Some(json!({ "project_id": mine, "machine_id": id }))).unwrap();

    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();

    // Rename the other Project first, then this machine's. Changes arrive in
    // order, so by the time the second shows up the first would have too.
    s.request_as(&me, "PATCH", &format!("/rest/v1/projects?id=eq.{other}"), Some(json!({ "name": "Renamed other" }))).unwrap();
    s.request_as(&me, "PATCH", &format!("/rest/v1/projects?id=eq.{mine}"), Some(json!({ "name": "Renamed mine" }))).unwrap();

    // Realtime can still deliver changes made just before the daemon started
    // (here, the Project being created), so wait for the rename itself.
    daemon.wait_for("its own Project being renamed", |c| {
        c["table"] == "projects" && c["type"] == "UPDATE" && c["record"]["id"] == mine.as_str() && c["record"]["name"] == "Renamed mine"
    });
    std::thread::sleep(Duration::from_millis(500));
    let leaked: Vec<Value> = daemon.drain().into_iter().filter(|c| c["record"]["id"] == other.as_str()).collect();
    assert!(leaked.is_empty(), "heard about a Project it isn't in: {leaked:?}");
}

#[test]
fn the_daemon_keeps_checking_in() {
    let s = supabase_or_skip!();
    let (home, id) = registered_machine(&s, &unique("beat"));
    let daemon = start_daemon(&home, &["--check-in-every", "1"]);
    daemon.wait_until_listening();
    let seen = |s: &Supabase| s.admin_request("GET", &format!("/rest/v1/machines?id=eq.{id}&select=last_seen"), None).unwrap()[0]["last_seen"].clone();
    let first = seen(&s);
    std::thread::sleep(Duration::from_millis(2500));
    assert_ne!(seen(&s), first);
}

#[test]
fn the_daemon_stops_on_a_bad_key() {
    let s = supabase_or_skip!();
    let home = std::env::temp_dir().join(format!("omicron-test-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&home).unwrap();
    let wrong = format!("omk_{}_{}", Uuid::new_v4().simple(), "0".repeat(64));
    std::fs::write(home.join("config.json"), json!({ "supabase_url": s.url, "supabase_key": s.key, "machine_key": wrong }).to_string()).unwrap();
    let mut daemon = start_daemon(&home, &[]);
    let status = daemon.child.wait().unwrap();
    assert!(!status.success());
    // Read until the program's error output closes, so nothing is missed.
    let said: Vec<String> = daemon.errors.iter().collect();
    assert!(said.iter().any(|l| l.contains("doesn't work")), "{said:?}");
}
