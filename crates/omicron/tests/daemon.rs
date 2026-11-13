//! End-to-end tests for `omicron daemon`: run the real program as a
//! registered machine, change things in Supabase, and read what it prints.
//!
//! Runs only when the test Supabase is set up (see `scripts/test.sh`).

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
        let deadline = Instant::now() + Duration::from_secs(20);
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

/// Run a one-off `omicron` command as the machine in `home`.
fn run(home: &Path, args: &[&str]) -> String {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_omicron"));
    for (k, _) in std::env::vars() {
        if k.starts_with("OMICRON_") {
            cmd.env_remove(k);
        }
    }
    let out = cmd.env("OMICRON_HOME", home).args(args).output().unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).to_string()
}

#[test]
fn a_running_daemon_shows_as_awake_and_drops_off_when_it_stops() {
    let s = supabase_or_skip!();
    let name = unique("awake");
    let (home, _) = registered_machine(&s, &name);
    let (other, _) = registered_machine(&s, &unique("asker"));

    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();
    assert!(run(&other, &["machines", "awake"]).lines().any(|l| l == name), "{name} should be awake");

    drop(daemon);
    // Supabase notices the closed connection right away; allow a moment.
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if !run(&other, &["machines", "awake"]).lines().any(|l| l == name) {
            break;
        }
        assert!(Instant::now() < deadline, "{name} still shows as awake after it stopped");
        std::thread::sleep(Duration::from_millis(300));
    }
}

#[test]
fn a_restarted_daemon_catches_up_on_what_it_missed_once() {
    let s = supabase_or_skip!();
    let (home, id) = registered_machine(&s, &unique("sleepy"));
    let me = person(&s, "owner");
    let project = start_project(&s, &me, "Shared");
    s.request_as(&me, "POST", "/rest/v1/project_machines", Some(json!({ "project_id": project, "machine_id": id }))).unwrap();

    // Start once so the machine knows where it is in the change list.
    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();
    s.request_as(&me, "PATCH", &format!("/rest/v1/projects?id=eq.{project}"), Some(json!({ "name": "While awake" }))).unwrap();
    let seen = daemon.wait_for("the rename while awake", |c| c["record"]["name"] == "While awake");
    drop(daemon);

    // Changed while the machine was off.
    s.request_as(&me, "PATCH", &format!("/rest/v1/projects?id=eq.{project}"), Some(json!({ "name": "While asleep" }))).unwrap();

    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();
    let missed = daemon.wait_for("the rename it missed", |c| c["record"]["name"] == "While asleep");
    assert!(missed["seq"].as_i64() > seen["seq"].as_i64());
    std::thread::sleep(Duration::from_millis(500));
    let repeats: Vec<Value> = daemon.drain().into_iter().filter(|c| c["record"]["name"] == "While awake").collect();
    assert!(repeats.is_empty(), "printed a change twice: {repeats:?}");
}

#[test]
fn changes_say_who_made_them() {
    let s = supabase_or_skip!();
    let (home, id) = registered_machine(&s, &unique("history"));
    let me = person(&s, "owner");
    let project = start_project(&s, &me, "Tracked");
    s.request_as(&me, "POST", "/rest/v1/project_machines", Some(json!({ "project_id": project, "machine_id": id }))).unwrap();
    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();
    s.request_as(&me, "PATCH", &format!("/rest/v1/projects?id=eq.{project}"), Some(json!({ "name": "Renamed" }))).unwrap();
    let change = daemon.wait_for("the rename", |c| c["record"]["name"] == "Renamed");
    assert_eq!(change["actor_id"], me.user.id.to_string());
    assert_eq!(change["old_record"]["name"], "Tracked");
    assert_eq!(change["project_id"], project.as_str());
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

#[test]
fn lines_older_than_30_days_are_cleared_out() {
    let s = supabase_or_skip!();
    let marker = unique("ancient");
    // Two old lines, written past the rules with the secret key.
    for (days, name) in [(31, marker.clone()), (29, format!("{marker}-recent"))] {
        let at = (chrono::Utc::now() - chrono::Duration::days(days)).to_rfc3339();
        s.admin_request("POST", "/rest/v1/changes", Some(json!({ "table_name": "projects", "kind": "INSERT", "at": at, "record": { "name": name } }))).unwrap();
    }

    // Cleanup runs every 100th line, so make a little over 100.
    let me = person(&s, "busy");
    for i in 0..30 {
        start_project(&s, &me, &format!("{marker}-{i}"));
    }
    let left = |name: &str| s.admin_request("GET", &format!("/rest/v1/changes?record->>name=eq.{name}&select=seq"), None).unwrap();
    assert_eq!(left(&marker), json!([]), "the 31-day-old line should be gone");
    assert_eq!(left(&format!("{marker}-recent")).as_array().unwrap().len(), 1, "the 29-day-old line should stay");
}

#[test]
fn machines_unseen_for_30_days_are_switched_off_until_switched_back_on() {
    let s = supabase_or_skip!();
    let name = unique("dusty");
    let (home, id) = registered_machine(&s, &name);
    let fresh = unique("fresh");
    let (_fresh_home, fresh_id) = registered_machine(&s, &fresh);
    // Last seen 31 days ago, written past the rules with the secret key.
    let long_ago = (chrono::Utc::now() - chrono::Duration::days(31)).to_rfc3339();
    let made = (chrono::Utc::now() - chrono::Duration::days(40)).to_rfc3339();
    s.admin_request("PATCH", &format!("/rest/v1/machines?id=eq.{id}"), Some(json!({ "last_seen": long_ago, "created_at": made }))).unwrap();

    // The switch-off happens with the change-list cleanup, every 100th line.
    let me = person(&s, "busy");
    for i in 0..30 {
        start_project(&s, &me, &format!("{name}-{i}"));
    }
    let active = |id: Uuid| s.admin_request("GET", &format!("/rest/v1/machines?id=eq.{id}&select=active"), None).unwrap()[0]["active"].clone();
    assert_eq!(active(id), json!(false), "the machine unseen for 31 days should be switched off");
    assert_eq!(active(fresh_id), json!(true), "a new machine should stay on");

    // Its daemon says why and how to fix it, and stops.
    let mut daemon = start_daemon(&home, &[]);
    assert!(!daemon.child.wait().unwrap().success());
    let said: Vec<String> = daemon.errors.iter().collect();
    assert!(said.iter().any(|l| l.contains("switched off") && l.contains("switch-on")), "{said:?}");

    // Started at login, the same stop is a normal finish, so the service
    // doesn't keep restarting it.
    let out = Command::new(env!("CARGO_BIN_EXE_omicron"))
        .env("OMICRON_HOME", &home)
        .env("OMICRON_DAEMON_SERVICE", "1")
        .arg("daemon")
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert!(String::from_utf8_lossy(&out.stderr).contains("switched off"));

    // Switched back on from a machine with the secret key, it runs again.
    let web = std::env::temp_dir().join(format!("omicron-test-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&web).unwrap();
    std::fs::write(web.join("config.json"), json!({ "supabase_url": s.url, "supabase_key": s.key, "supabase_secret_key": s.secret_key }).to_string()).unwrap();
    assert_eq!(run(&web, &["machines", "switch-on", &name]).trim(), format!("Switched {name} on."));
    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();
}

#[test]
fn picking_a_machine_opens_ssh_to_its_tailnet_name() {
    let s = supabase_or_skip!();
    let name = unique("studio");
    let (home, _) = registered_machine(&s, &name);
    std::fs::write(
        home.join("tailscale.json"),
        json!({ "Self": { "UserID": 1, "DNSName": format!("{name}.example.ts.net.") }, "User": { "1": { "LoginName": "tagged-devices" } } })
            .to_string(),
    )
    .unwrap();
    let (other, _) = registered_machine(&s, &unique("laptop"));
    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();

    // A stand-in for ssh that prints what it was asked to do.
    let bin = other.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(bin.join("ssh"), "#!/bin/sh\necho \"ssh $*\"\n").unwrap();
    std::process::Command::new("chmod").args(["+x", bin.join("ssh").to_str().unwrap()]).status().unwrap();
    let pick = |args: &[&str]| {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_omicron"));
        for (k, _) in std::env::vars() {
            if k.starts_with("OMICRON_") {
                cmd.env_remove(k);
            }
        }
        let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap());
        cmd.env("OMICRON_HOME", &other).env("PATH", path).args(["machines", "pick"]).args(args).stdin(Stdio::null()).output().unwrap()
    };

    // The hosted Supabase takes a moment to show a just-started daemon as awake.
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut out = pick(&[&name]);
    while !out.status.success() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(500));
        out = pick(&[&name]);
    }
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), format!("ssh {name}.example.ts.net"));

    // Without a name and no one to ask, it lists them and says to name one.
    let out = pick(&[]);
    let said = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success() && said.contains(&format!("{name}  {name}.example.ts.net")) && said.contains("name one"), "{said}");

    // A machine that isn't awake can't be picked.
    drop(daemon);
    std::thread::sleep(Duration::from_secs(2));
    assert!(!pick(&[&name]).status.success());
}

/// Every change for `project` that arrives within `wait`, as (seq, table).
fn collect(daemon: &Daemon, project: &str, wait: Duration) -> Vec<(i64, String)> {
    let deadline = Instant::now() + wait;
    let mut got = Vec::new();
    while Instant::now() < deadline {
        if let Ok(line) = daemon.lines.recv_timeout(Duration::from_millis(200)) {
            if line["project_id"] == json!(project) {
                got.push((line["seq"].as_i64().unwrap_or(0), line["table"].as_str().unwrap_or("").to_string()));
            }
        }
    }
    got
}

#[test]
fn a_burst_of_changes_all_arrive_once() {
    let s = supabase_or_skip!();
    let (home, id) = registered_machine(&s, &unique("busy"));
    let me = person(&s, "owner");
    let project = start_project(&s, &me, &unique("Busy"));
    s.request_as(&me, "POST", "/rest/v1/project_machines", Some(json!({ "project_id": project, "machine_id": id }))).unwrap();
    let status = s.request_as(&me, "GET", &format!("/rest/v1/statuses?project_id=eq.{project}&select=id&limit=1"), None).unwrap();
    let daemon = start_daemon(&home, &[]);
    daemon.wait_until_listening();

    // 300 tasks at once, in three requests.
    for b in 0..3 {
        let rows: Vec<Value> = (0..100).map(|i| json!({ "project_id": project, "status_id": status[0]["id"], "title": format!("Task {}", b * 100 + i) })).collect();
        s.request_as(&me, "POST", "/rest/v1/tasks", Some(Value::Array(rows))).unwrap();
    }
    let got = collect(&daemon, &project, Duration::from_secs(8));
    // Live updates may arrive slightly out of order (the hosted Realtime
    // doesn't promise order); what matters is that each arrives, once.
    let mut tasks: Vec<i64> = got.iter().filter(|(_, t)| t == "tasks").map(|(seq, _)| *seq).collect();
    assert_eq!(tasks.len(), 300, "every change arrives");
    tasks.sort();
    tasks.dedup();
    assert_eq!(tasks.len(), 300, "no change arrives twice");
}

