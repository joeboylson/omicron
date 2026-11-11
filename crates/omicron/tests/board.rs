//! End-to-end tests for `omicron projects`, `statuses` and `tasks`: run the
//! real command as a person (a machine with the secret key and a Tailscale
//! owner) and as a machine, the way they'd be used in a terminal.
//!
//! Runs only when the test Supabase is set up (see `dev/supabase/test.sh`).

use omicron::supa::Supabase;
use serde_json::json;
use std::path::PathBuf;
use std::process::{Command, Output};
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

/// A pretend computer: its settings folder, and (for a person's computer)
/// who Tailscale says owns it.
struct Computer {
    home: PathBuf,
    tailscale: Option<PathBuf>,
}

fn new_home() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("omicron-test-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A person's computer: it has the secret key, and Tailscale says `name` owns it.
fn persons_computer(s: &Supabase, name: &str) -> Computer {
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

/// A registered machine without the secret key (how a Claude session acts).
fn machine(s: &Supabase) -> (Computer, Uuid) {
    let home = new_home();
    let key = s.register_machine(&unique("box"), false).unwrap();
    std::fs::write(
        home.join("config.json"),
        json!({ "supabase_url": s.url, "supabase_key": s.key, "machine_key": key.to_string() }).to_string(),
    )
    .unwrap();
    (Computer { home, tailscale: None }, key.machine_id)
}

fn omicron(c: &Computer, args: &[&str]) -> Output {
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
    cmd.args(args).output().unwrap()
}

fn ok(c: &Computer, args: &[&str]) -> String {
    let o = omicron(c, args);
    assert!(o.status.success(), "omicron {args:?} failed: {}", String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).to_string()
}

fn fails(c: &Computer, args: &[&str]) -> String {
    let o = omicron(c, args);
    assert!(!o.status.success(), "omicron {args:?} should have failed: {}", String::from_utf8_lossy(&o.stdout));
    String::from_utf8_lossy(&o.stderr).to_string()
}

/// A person with a fresh Project of their own. Returns (computer, project name).
fn person_with_project(s: &Supabase, name: &str) -> (Computer, String) {
    let me = persons_computer(s, name);
    let project = unique("House");
    assert_eq!(ok(&me, &["projects", "new", &project]).trim(), format!("Started {project}."));
    (me, project)
}

#[test]
fn a_new_project_starts_with_to_do_and_done() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    assert!(ok(&me, &["projects", "list"]).lines().any(|l| l == project));
    assert_eq!(ok(&me, &["statuses", "list", &project]), "To do\nDone (Done)\n");
}

#[test]
fn adding_and_listing_tasks() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    let added = ok(&me, &["tasks", "add", &project, "Buy milk", "--label", "shop", "--label", "food", "--due", "2026-11-30"]);
    assert!(added.starts_with("#1  Buy milk  [food, shop]  due 2026-11-30"), "{added}");
    ok(&me, &["tasks", "add", &project, "Fix the gate"]);

    let list = ok(&me, &["tasks", "list", &project]);
    assert_eq!(list, "To do\n  #1  Buy milk  [food, shop]  due 2026-11-30\n  #2  Fix the gate\nDone\n  (nothing)\n");
}

#[test]
fn moving_and_finishing_tasks() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    ok(&me, &["statuses", "add", &project, "Doing"]);
    ok(&me, &["statuses", "add", &project, "Review"]);
    assert_eq!(ok(&me, &["statuses", "list", &project]), "To do\nDoing\nReview\nDone (Done)\n", "new statuses go before Done");
    ok(&me, &["tasks", "add", &project, "Paint"]);
    assert!(ok(&me, &["tasks", "move", &project, "1", "doing"]).contains("Status: Doing"));
    assert!(ok(&me, &["tasks", "done", &project, "1"]).contains("Status: Done"));
}

#[test]
fn checklists() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    ok(&me, &["tasks", "add", &project, "Pack"]);
    ok(&me, &["tasks", "check", &project, "1", "Socks"]);
    ok(&me, &["tasks", "check", &project, "1", "Charger"]);
    let shown = ok(&me, &["tasks", "tick", &project, "1", "2"]);
    assert!(shown.contains("checklist 1/2"), "{shown}");
    assert!(shown.contains("1. [ ] Socks\n  2. [x] Charger"), "{shown}");
    // Ticking again unticks it.
    assert!(ok(&me, &["tasks", "tick", &project, "1", "2"]).contains("2. [ ] Charger"));
    assert!(fails(&me, &["tasks", "tick", &project, "1", "3"]).contains("no checklist item 3"));
}

#[test]
fn only_a_claude_session_can_ask_for_review_and_anyone_can_clear_it() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    ok(&me, &["tasks", "add", &project, "Write the report"]);
    assert!(fails(&me, &["tasks", "needs-review", &project, "1"]).contains("only a Claude session"));

    // Add a machine (where the Claude session runs) to the Project.
    let (session, machine_id) = machine(&s);
    let me_admin = s.admin_request("GET", &format!("/rest/v1/projects?name=eq.{project}&select=id"), None).unwrap();
    s.admin_request(
        "POST",
        "/rest/v1/project_machines",
        Some(json!({ "project_id": me_admin[0]["id"], "machine_id": machine_id })),
    )
    .unwrap();
    assert!(ok(&session, &["tasks", "needs-review", &project, "1"]).contains("needs review"));
    assert!(ok(&me, &["tasks", "list", &project]).contains("#1  Write the report  needs review"));

    let cleared = ok(&me, &["tasks", "reviewed", &project, "1"]);
    assert!(!cleared.contains("needs review"), "{cleared}");
}

#[test]
fn tasks_can_only_go_to_members() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    assert!(ok(&me, &["tasks", "add", &project, "Call the plumber", "--to", "pat"]).contains("to Pat"));
    assert!(fails(&me, &["tasks", "add", &project, "Cook", "--to", "Nobody"]).contains("nobody called Nobody"));
}

#[test]
fn a_new_done_status_takes_over_the_done_mark() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    ok(&me, &["statuses", "add", &project, "Shipped", "--done"]);
    assert_eq!(ok(&me, &["statuses", "list", &project]), "To do\nDone\nShipped (Done)\n");
    ok(&me, &["tasks", "add", &project, "Release"]);
    assert!(ok(&me, &["tasks", "done", &project, "1"]).contains("Status: Shipped"));
}

#[test]
fn helpful_errors() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    assert!(fails(&me, &["tasks", "add", &project, "x", "--due", "tomorrow"]).contains("dates look like"));
    let err = fails(&me, &["tasks", "add", &project, "x", "--status", "Someday"]);
    assert!(err.contains("no status called Someday") && err.contains("To do, Done"), "{err}");
    assert!(fails(&me, &["tasks", "show", &project, "99"]).contains("no task #99"));
}

#[test]
fn task_numbers_count_up_within_each_project() {
    let s = supabase_or_skip!();
    let (me, first) = person_with_project(&s, "Pat");
    let second = unique("Work");
    ok(&me, &["projects", "new", &second]);
    assert!(ok(&me, &["tasks", "add", &first, "a"]).starts_with("#1 "));
    assert!(ok(&me, &["tasks", "add", &first, "b"]).starts_with("#2 "));
    assert!(ok(&me, &["tasks", "add", &second, "c"]).starts_with("#1 "));
}

#[test]
fn other_people_cant_see_your_project() {
    let s = supabase_or_skip!();
    let (_me, project) = person_with_project(&s, "Pat");
    let stranger = persons_computer(&s, "Stranger");
    assert!(fails(&stranger, &["tasks", "list", &project]).contains("no Project called"));
}

#[test]
fn as_machine_acts_as_the_machine_even_on_a_persons_computer() {
    let s = supabase_or_skip!();
    let (mut me, project) = person_with_project(&s, "Pat");
    let key = s.register_machine(&unique("laptop"), false).unwrap();
    let mut config: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(me.home.join("config.json")).unwrap()).unwrap();
    config["machine_key"] = json!(key.to_string());
    std::fs::write(me.home.join("config.json"), config.to_string()).unwrap();
    // The machine isn't in the Project, so it can't see it.
    assert!(fails(&me, &["--as-machine", "tasks", "list", &project]).contains("no Project called"));
    me.tailscale = None;
    assert!(fails(&me, &["projects", "list"]).contains("couldn't tell who you are"));
}


/// The Tailscale login a person's computer belongs to.
fn login_of(c: &Computer) -> String {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(c.tailscale.as_ref().unwrap()).unwrap()).unwrap();
    v["User"]["1"]["LoginName"].as_str().unwrap().to_string()
}

#[test]
fn the_people_table_adds_and_removes_people() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    let wife = persons_computer(&s, "Sam");
    // Sam signs in once (as the web page would), so they exist.
    let sam_login = login_of(&wife);
    assert_eq!(ok(&wife, &["projects", "list"]), "No Projects yet.\n");

    let table = ok(&me, &["people", "list"]);
    assert!(table.lines().any(|l| l.starts_with("Sam  (") && l.ends_with("no Projects")), "{table}");

    assert_eq!(ok(&me, &["people", "add", &sam_login, &project]).trim(), format!("Added Sam to {project}."));
    assert!(ok(&wife, &["projects", "list"]).lines().any(|l| l == project));
    // Now Sam is in a Project, Sam sees the people table too.
    assert!(ok(&wife, &["people", "list"]).lines().any(|l| l.starts_with("Pat  (")));

    assert_eq!(ok(&me, &["people", "remove", &sam_login, &project]).trim(), format!("Took Sam out of {project}."));
    assert_eq!(ok(&wife, &["projects", "list"]), "No Projects yet.\n");
    assert!(fails(&me, &["people", "remove", &sam_login, &project]).contains("isn't in"));
    assert!(fails(&me, &["people", "add", "nobody@example.com", &project]).contains("nobody called"));
}

#[test]
fn machines_are_added_to_projects_from_the_terminal() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    let name = unique("mini");
    s.register_machine(&name, false).unwrap();

    assert_eq!(ok(&me, &["machines", "add", &name, &project]).trim(), format!("Added {name} to {project}."));
    assert!(ok(&me, &["machines", "list"]).lines().any(|l| l == format!("{name}  {project}")));
    assert_eq!(ok(&me, &["machines", "remove", &name, &project]).trim(), format!("Took {name} out of {project}."));
    assert!(fails(&me, &["machines", "remove", &name, &project]).contains("isn't in"));
}

#[test]
fn statuses_and_labels_get_colors() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    assert_eq!(ok(&me, &["statuses", "color", &project, "to do", "Blue"]).trim(), format!("to do is blue in {project}."));
    assert_eq!(ok(&me, &["statuses", "list", &project]), "To do [blue]\nDone (Done)\n");
    ok(&me, &["labels", "color", &project, "urgent", "red"]);
    ok(&me, &["tasks", "add", &project, "Pay the bill", "--label", "bills"]);
    assert_eq!(ok(&me, &["labels", "list", &project]), "bills\nurgent [red]\n");
    assert!(fails(&me, &["statuses", "color", &project, "Done", "magenta"]).contains("isn't one of the colors"));
}
