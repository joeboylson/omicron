//! End-to-end tests for `omicron projects`, `statuses` and `tasks`: run the
//! real command as a person (a machine with the secret key and a Tailscale
//! owner) and as a machine, the way they'd be used in a terminal.
//!
//! Runs only when the test Supabase is set up (see `scripts/test.sh`).

use omicron::supa::Supabase;
use serde_json::{json, Value};
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

#[test]
fn topics_group_tasks_into_rows() {
    let s = supabase_or_skip!();
    let (pat, project) = person_with_project(&s, "Pat");
    assert!(ok(&pat, &["topics", "list", &project]).contains("has no topics yet"));
    ok(&pat, &["topics", "add", &project, "Joe's to-do"]);
    ok(&pat, &["topics", "add", &project, "Claire's to-do"]);
    assert!(fails(&pat, &["topics", "add", &project, "joe's TO-DO"]).contains("already has a topic called"));
    assert_eq!(ok(&pat, &["topics", "list", &project]), "Joe's to-do\nClaire's to-do\n");

    ok(&pat, &["tasks", "add", &project, "Buy milk", "--topic", "Joe's to-do"]);
    ok(&pat, &["tasks", "add", &project, "Book flights", "--status", "Done", "--topic", "claire's to-do"]);
    ok(&pat, &["tasks", "add", &project, "Water plants"]);
    assert!(ok(&pat, &["tasks", "show", &project, "1"]).contains("  Topic: Joe's to-do\n"));

    // One row per topic, in order, each with the statuses; tasks with no
    // topic last.
    let rows = ok(&pat, &["tasks", "list", &project, "--by-topic"]);
    assert_eq!(
        rows,
        "== Joe's to-do ==\nTo do\n  #1  Buy milk\nDone\n  (nothing)\n\n\
         == Claire's to-do ==\nTo do\n  (nothing)\nDone\n  #2  Book flights\n\n\
         == No topic ==\nTo do\n  #3  Water plants\nDone\n  (nothing)\n"
    );

    // Moved to another topic (made on the way), taken off, renamed, removed.
    ok(&pat, &["tasks", "topic", &project, "3", "Garden"]);
    assert_eq!(ok(&pat, &["topics", "list", &project]), "Joe's to-do\nClaire's to-do\nGarden\n");
    ok(&pat, &["tasks", "topic", &project, "3", "none"]);
    assert!(!ok(&pat, &["tasks", "show", &project, "3"]).contains("Topic:"));
    ok(&pat, &["topics", "rename", &project, "Joe's to-do", "Joe"]);
    assert!(ok(&pat, &["tasks", "show", &project, "1"]).contains("  Topic: Joe\n"));
    ok(&pat, &["topics", "remove", &project, "Joe"]);
    assert!(!ok(&pat, &["tasks", "show", &project, "1"]).contains("Topic:"));
    assert!(fails(&pat, &["topics", "remove", &project, "Joe"]).contains("has no topic called Joe"));

    // A topic from another Project can't be used.
    let (_, other) = person_with_project(&s, "Sam");
    let theirs = s.admin_request("POST", "/rest/v1/topics?select=id", Some(serde_json::json!({
        "project_id": s.admin_request("GET", &format!("/rest/v1/projects?name=eq.{other}&select=id"), None).unwrap()[0]["id"],
        "name": "Theirs",
    }))).unwrap();
    let task = s.admin_request("GET", &format!("/rest/v1/tasks?title=eq.Buy milk&select=id,projects!inner(name)&projects.name=eq.{project}"), None).unwrap();
    let err = s.admin_request("PATCH", &format!("/rest/v1/tasks?id=eq.{}", task[0]["id"].as_str().unwrap()), Some(serde_json::json!({ "topic_id": theirs[0]["id"] })));
    assert!(err.unwrap_err().to_string().contains("another Project"));
}

/// A real (tiny) PNG.
const PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00,
    0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63,
    0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
];

#[test]
fn comments_can_hold_images() {
    let s = supabase_or_skip!();
    let (pat, project) = person_with_project(&s, "Pat");
    ok(&pat, &["tasks", "add", &project, "Fix the gate"]);
    let shot = pat.home.join("gate photo.png");
    std::fs::write(&shot, PNG).unwrap();
    let notes = pat.home.join("notes.txt");
    std::fs::write(&notes, "hi").unwrap();

    // Images only, no text, is fine; other files aren't images.
    assert!(fails(&pat, &["tasks", "comment", &project, "1", ""]).contains("write something, or add an image"));
    assert!(fails(&pat, &["tasks", "comment", &project, "1", "x", "--image", notes.to_str().unwrap()]).contains("isn't an image"));
    let shown = ok(&pat, &["tasks", "comment", &project, "1", "", "--image", shot.to_str().unwrap(), "--image", shot.to_str().unwrap()]);
    assert!(shown.contains("[images: gate_photo.png, gate_photo.png]"), "{shown}");

    // A Claude session in the Project saves them to look at.
    let (mac, mac_id) = machine(&s);
    let pid = s.admin_request("GET", &format!("/rest/v1/projects?name=eq.{project}&select=id"), None).unwrap()[0]["id"].clone();
    s.admin_request("POST", "/rest/v1/project_machines", Some(json!({ "project_id": pid, "machine_id": mac_id }))).unwrap();
    let to = mac.home.join("seen");
    let saved = ok(&mac, &["tasks", "images", &project, "1", "--to", to.to_str().unwrap(), "--as-machine"]);
    let files: Vec<&str> = saved.lines().collect();
    assert_eq!(files.len(), 2);
    assert!(files[0].ends_with("1-gate_photo.png"));
    assert_eq!(std::fs::read(files[0]).unwrap(), PNG);

    // Someone outside the Project can't read them.
    let (outsider, _) = machine(&s);
    let path = s.admin_request("GET", &format!("/rest/v1/comments?project_id=eq.{}&select=images", pid.as_str().unwrap()), None).unwrap()[0]["images"][0]
        .as_str()
        .unwrap()
        .to_string();
    let config: Value = serde_json::from_str(&std::fs::read_to_string(outsider.home.join("config.json")).unwrap()).unwrap();
    let key: omicron::supa::MachineKey = config["machine_key"].as_str().unwrap().parse().unwrap();
    let login = s.sign_in_machine(&key).unwrap();
    assert!(s.download_as(&login, "comment-images", &path).is_err());
    // Nor file one under this Project.
    assert!(s.upload_as(&login, "comment-images", &format!("{}/x.png", pid.as_str().unwrap()), PNG, "image/png").is_err());

    // A comment can't point at images filed under another Project.
    let mac_login = {
        let config: Value = serde_json::from_str(&std::fs::read_to_string(mac.home.join("config.json")).unwrap()).unwrap();
        s.sign_in_machine(&config["machine_key"].as_str().unwrap().parse().unwrap()).unwrap()
    };
    let mine = s.admin_request("GET", &format!("/rest/v1/tasks?title=eq.Fix the gate&select=id,projects!inner(name)&projects.name=eq.{project}"), None).unwrap();
    let err = s.request_as(&mac_login, "POST", "/rest/v1/comments", Some(json!({ "task_id": mine[0]["id"], "body": "x", "images": [format!("{}/y.png", Uuid::new_v4())] })));
    assert!(err.unwrap_err().to_string().contains("its own Project"));
}

#[test]
fn tasks_can_be_placed_within_a_status() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    for t in ["One", "Two", "Three", "Four"] {
        ok(&me, &["tasks", "add", &project, t]);
    }
    let order = || -> Vec<String> {
        ok(&me, &["tasks", "list", &project]).lines().filter(|l| l.starts_with("  #")).map(|l| l.trim().to_string()).collect()
    };
    ok(&me, &["tasks", "move", &project, "4", "--top"]);
    assert_eq!(order(), ["#4  Four", "#1  One", "#2  Two", "#3  Three"]);
    ok(&me, &["tasks", "move", &project, "4", "--after", "2"]);
    assert_eq!(order(), ["#1  One", "#2  Two", "#4  Four", "#3  Three"]);
    ok(&me, &["tasks", "move", &project, "3", "--before", "1"]);
    assert_eq!(order(), ["#3  Three", "#1  One", "#2  Two", "#4  Four"]);
    // To another status: the bottom of it, unless told otherwise.
    ok(&me, &["tasks", "move", &project, "1", "Done"]);
    ok(&me, &["tasks", "move", &project, "2", "Done", "--top"]);
    assert_eq!(order(), ["#3  Three", "#4  Four", "#2  Two", "#1  One"]);
    assert!(fails(&me, &["tasks", "move", &project, "3", "--after", "1"]).contains("#1 isn't in that status"));
    assert!(fails(&me, &["tasks", "move", &project, "3", "--top", "--bottom"]).contains("cannot be used with"));
}

#[test]
fn labels_are_renamed_and_removed() {
    let s = supabase_or_skip!();
    let (me, project) = person_with_project(&s, "Pat");
    ok(&me, &["tasks", "add", &project, "Buy milk", "--label", "shop", "--label", "food"]);
    ok(&me, &["tasks", "add", &project, "Buy bread", "--label", "shop"]);
    assert!(fails(&me, &["labels", "rename", &project, "shop", "FOOD"]).contains("already has a label called FOOD"));
    assert_eq!(ok(&me, &["labels", "rename", &project, "shop", "shopping"]).trim(), "Renamed the label shop to shopping.");
    assert!(ok(&me, &["tasks", "show", &project, "2"]).starts_with("#2  Buy bread  [shopping]"));
    assert_eq!(ok(&me, &["labels", "remove", &project, "Shopping"]).trim(), "Removed the label Shopping (it was on 2 tasks).");
    assert!(ok(&me, &["tasks", "show", &project, "1"]).starts_with("#1  Buy milk  [food]\n"));
    assert_eq!(ok(&me, &["labels", "list", &project]), "food\n");
    assert!(fails(&me, &["labels", "remove", &project, "shopping"]).contains("has no label called shopping"));
}
