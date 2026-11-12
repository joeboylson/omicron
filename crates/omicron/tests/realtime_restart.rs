//! When Supabase's live updates go away for a while (Omicron's own Realtime
//! container restarts), the daemon reconnects and catches up. In a file of
//! its own: test files run one after another, so the restart can't disturb
//! other tests.
//!
//! Runs only when the test Supabase is set up (see `scripts/test.sh`).
#![allow(dead_code)]

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
    // A machine "on Tailscale" has a status file in its home.
    let status = home.join("tailscale.json");
    if status.exists() {
        cmd.env("OMICRON_TAILSCALE_STATUS", &status);
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
fn when_live_updates_drop_the_daemon_reconnects_and_catches_up() {
    let s = supabase_or_skip!();
    if std::env::var("OMICRON_TEST_PSQL").is_err() {
        eprintln!("skipped: needs the local Supabase (scripts/test.sh)");
        return;
    }
    let (home, id) = registered_machine(&s, &unique("flaky"));
    let me = person(&s, "owner");
    let project = start_project(&s, &me, &unique("Flaky"));
    s.request_as(&me, "POST", "/rest/v1/project_machines", Some(json!({ "project_id": project, "machine_id": id }))).unwrap();
    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();
    s.request_as(&me, "PATCH", &format!("/rest/v1/projects?id=eq.{project}"), Some(json!({ "name": format!("{project}-before") }))).unwrap();
    daemon.wait_for("a change before", |c| c["record"]["name"].as_str().is_some_and(|n| n.ends_with("-before")));

    // Supabase's live updates go away for a few seconds (Omicron's own
    // Realtime container restarts). A change made meanwhile isn't lost.
    let restart = std::process::Command::new("docker").args(["restart", "-t", "1", "realtime-dev.omicron-realtime"]).output().unwrap();
    assert!(restart.status.success(), "{}", String::from_utf8_lossy(&restart.stderr));
    s.request_as(&me, "PATCH", &format!("/rest/v1/projects?id=eq.{project}"), Some(json!({ "name": format!("{project}-during") }))).unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut got = Vec::new();
    while Instant::now() < deadline && !got.iter().any(|c: &Value| c["record"]["name"].as_str().is_some_and(|n| n.ends_with("-during"))) {
        if let Ok(line) = daemon.lines.recv_timeout(Duration::from_millis(500)) {
            got.push(line);
        }
    }
    assert!(got.iter().any(|c| c["record"]["name"].as_str().is_some_and(|n| n.ends_with("-during"))), "the change made while live updates were down never arrived");
    // And it keeps hearing new ones live.
    s.request_as(&me, "PATCH", &format!("/rest/v1/projects?id=eq.{project}"), Some(json!({ "name": format!("{project}-after") }))).unwrap();
    daemon.wait_for("a change after", |c| c["record"]["name"].as_str().is_some_and(|n| n.ends_with("-after")));
    let during = got.iter().filter(|c| c["record"]["name"].as_str().is_some_and(|n| n.ends_with("-during"))).count();
    assert_eq!(during, 1, "the missed change arrived once");
}
