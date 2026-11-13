//! Nobody sees or changes what isn't theirs. One Project gets a row in
//! every table (and a file in storage) the way its member and its machine
//! would make them; then someone outside it tries everything: a person in no
//! Project, a machine in another Project, and a visitor with no login at all.
//! Each one reads, adds, changes and deletes every table, calls every
//! function, and tries the stored files. Afterwards the Project's rows must
//! be exactly as they were, and none of it may have been seen.
//!
//! Runs only when the test Supabase is set up (see `scripts/test.sh`).

use omicron::identity::TailscalePerson;
use omicron::supa::{Session, Supabase};
use serde_json::{json, Value};
use uuid::Uuid;

fn admin() -> Option<Supabase> {
    let s = Supabase::from_env().ok()?;
    s.secret_key.as_ref()?;
    Some(s)
}

fn unique(name: &str) -> String {
    format!("{name}-{}", &Uuid::new_v4().simple().to_string()[..8])
}

fn person(s: &Supabase, name: &str) -> Session {
    let login = format!("{}@example.com", unique(&name.to_lowercase()));
    s.sign_in_person(&TailscalePerson { login, display_name: name.into() }).unwrap()
}

fn machine(s: &Supabase) -> (Session, Uuid) {
    let key = s.register_machine(&unique("box"), false, None).unwrap();
    (s.sign_in_machine(&key).unwrap(), key.machine_id)
}

fn call(s: &Supabase, who: &Session, method: &str, path: &str, body: Value) -> Value {
    s.request_as(who, method, path, if body.is_null() { None } else { Some(body) })
        .unwrap_or_else(|e| panic!("{method} {path}: {e:#}"))
}

/// Someone trying something: their login (None for a visitor with none).
struct Outsider {
    name: &'static str,
    login: Option<Session>,
}

/// What happened when they tried: Ok with what came back, or Err (refused).
fn attempt(s: &Supabase, who: &Outsider, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    match &who.login {
        Some(login) => s.request_as(login, method, path, body).map_err(|e| format!("{e:#}")),
        None => {
            let url = format!("{}{path}", s.url);
            let req = ureq::request(method, &url)
                .set("apikey", &s.key)
                .set("Authorization", &format!("Bearer {}", s.key))
                .set("Prefer", "return=representation");
            let res = match body {
                Some(b) => req.send_json(b),
                None => req.call(),
            };
            match res {
                Ok(r) => {
                    let text = r.into_string().unwrap_or_default();
                    Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) })
                }
                Err(e) => Err(e.to_string()),
            }
        }
    }
}

/// Nothing came back: refused, or an empty list.
fn nothing(r: &Result<Value, String>) -> bool {
    match r {
        Err(_) => true,
        Ok(v) => v.is_null() || v.as_array().is_some_and(|a| a.is_empty()),
    }
}

/// Rows read with the secret key (past every rule), as the database has them.
fn rows(s: &Supabase, path: &str) -> Vec<Value> {
    s.admin_request("GET", path, None).unwrap().as_array().cloned().unwrap_or_default()
}

/// Every table a Project's things live in (each has project_id).
const PROJECT_TABLES: &[&str] = &[
    "projects",
    "project_members",
    "project_machines",
    "statuses",
    "labels",
    "topics",
    "tasks",
    "task_labels",
    "checklist_items",
    "comments",
    "sessions",
    "handoffs",
    "dispatches",
    "loops",
    "teams",
    "jobs",
    "workers",
    "task_jobs",
    "team_requests",
    "folders",
    "changes",
];

fn column(table: &str) -> &'static str {
    if table == "projects" {
        "id"
    } else {
        "project_id"
    }
}

/// A fingerprint of everything the Project has, table by table: how many
/// rows, and all of them, sorted, as text.
fn fingerprint(s: &Supabase, pid: &str) -> Vec<(String, String)> {
    PROJECT_TABLES
        .iter()
        .map(|t| {
            let mut all: Vec<String> = rows(s, &format!("/rest/v1/{t}?{}=eq.{pid}&select=*", column(t))).iter().map(|r| r.to_string()).collect();
            all.sort();
            (t.to_string(), format!("{}:{}", all.len(), all.join("|")))
        })
        .collect()
}

#[test]
fn outsiders_can_see_and_change_nothing_of_a_project() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };

    // ---- A Project with something in every table.
    let pat = person(&s, "Pat");
    let project = call(&s, &pat, "POST", "/rest/v1/rpc/start_project", json!({ "name": unique("Secret") }));
    let pid = project["id"].as_str().unwrap().to_string();
    let (mac, mac_id) = machine(&s);
    call(&s, &pat, "POST", "/rest/v1/project_machines", json!({ "project_id": pid, "machine_id": mac_id }));
    let status = call(&s, &pat, "GET", &format!("/rest/v1/statuses?project_id=eq.{pid}&select=id&limit=1"), Value::Null);
    let label = call(&s, &pat, "POST", "/rest/v1/labels", json!({ "project_id": pid, "name": "secret", "color": "red" }));
    let topic = call(&s, &pat, "POST", "/rest/v1/topics", json!({ "project_id": pid, "name": "Hidden" }));
    let task = call(
        &s,
        &pat,
        "POST",
        "/rest/v1/tasks",
        json!({ "project_id": pid, "status_id": status[0]["id"], "title": "The secret plan", "notes": "Nobody else", "topic_id": topic[0]["id"] }),
    );
    let tid = task[0]["id"].as_str().unwrap().to_string();
    call(&s, &pat, "POST", "/rest/v1/task_labels", json!({ "task_id": tid, "label_id": label[0]["id"] }));
    call(&s, &pat, "POST", "/rest/v1/checklist_items", json!({ "task_id": tid, "text": "Step one" }));
    call(&s, &pat, "POST", "/rest/v1/comments", json!({ "task_id": tid, "body": "A private comment" }));
    let session = call(&s, &mac, "POST", "/rest/v1/sessions", json!({ "project_id": pid, "machine_id": mac_id, "name": "worker", "folder": "/code" }));
    let sid = session[0]["id"].as_str().unwrap().to_string();
    call(&s, &mac, "POST", "/rest/v1/handoffs", json!({ "project_id": pid, "session_id": sid, "machine_id": mac_id, "body": "Where I stopped" }));
    call(&s, &pat, "PATCH", &format!("/rest/v1/tasks?id=eq.{tid}"), json!({ "assignee_session_id": sid }));
    let dispatch = call(&s, &pat, "POST", "/rest/v1/dispatches", json!({ "task_id": tid, "session_id": sid }));
    let did = dispatch[0]["id"].as_str().unwrap().to_string();
    let lp = call(&s, &pat, "POST", "/rest/v1/loops", json!({ "session_id": sid, "prompt": "keep going", "every_seconds": 600 }));
    let lid = lp[0]["id"].as_str().unwrap().to_string();
    let team = call(&s, &mac, "POST", "/rest/v1/teams", json!({ "project_id": pid, "name": "web", "folder": "/code" }));
    let team_id = team[0]["id"].as_str().unwrap().to_string();
    let job = call(&s, &pat, "POST", "/rest/v1/jobs", json!({ "team_id": team_id, "title": "Secret job" }));
    call(&s, &mac, "POST", "/rest/v1/workers", json!({ "team_id": team_id, "name": "builder", "role": "builder", "job_id": job[0]["id"] }));
    call(&s, &pat, "POST", "/rest/v1/task_jobs", json!({ "task_id": tid, "job_id": job[0]["id"] }));
    call(&s, &mac, "POST", "/rest/v1/team_requests", json!({ "team_id": team_id, "job_id": job[0]["id"], "worker": "builder", "task_id": tid }));
    call(&s, &mac, "POST", "/rest/v1/folders", json!({ "project_id": pid, "path": "/code" }));
    let file = format!("{pid}/{}.png", Uuid::new_v4());
    s.upload_as(&pat, "comment-images", &file, b"\x89PNG\r\n\x1a\nsecret", "image/png").unwrap();
    let pat_id = pat.user.id;

    // Every table really has something in it, or the test proves nothing.
    let before = fingerprint(&s, &pid);
    for (table, print) in &before {
        assert!(!print.starts_with("0:"), "{table} has no rows for the Project: the setup missed it");
    }

    // ---- The outsiders, each with a little of their own.
    let sam = person(&s, "Sam");
    let (other_mac, other_id) = machine(&s);
    let other_project = call(&s, &sam, "POST", "/rest/v1/rpc/start_project", json!({ "name": unique("Other") }));
    call(&s, &sam, "POST", "/rest/v1/project_machines", json!({ "project_id": other_project["id"], "machine_id": other_id }));
    let sam_id = sam.user.id;
    let outsiders = [
        Outsider { name: "a person in another Project", login: Some(sam) },
        Outsider { name: "a machine in another Project", login: Some(other_mac) },
        Outsider { name: "a visitor with no login", login: None },
    ];

    let mut problems = Vec::new();
    for who in &outsiders {
        let mut bad = |what: String| problems.push(format!("{}: {what}", who.name));
        for table in PROJECT_TABLES {
            let col = column(table);
            // Reading: by the Project, and everything they can see.
            let r = attempt(&s, who, "GET", &format!("/rest/v1/{table}?{col}=eq.{pid}"), None);
            if !nothing(&r) {
                bad(format!("read {table}: {r:?}"));
            }
            if let Ok(Value::Array(all)) = attempt(&s, who, "GET", &format!("/rest/v1/{table}?select=*"), None) {
                if all.iter().any(|row| row[col] == json!(pid)) {
                    bad(format!("saw the Project's rows listing all of {table}"));
                }
            }
            // Changing and deleting.
            let r = attempt(&s, who, "PATCH", &format!("/rest/v1/{table}?{col}=eq.{pid}"), Some(json!({ col: pid })));
            if !nothing(&r) {
                bad(format!("changed {table}: {r:?}"));
            }
            let r = attempt(&s, who, "DELETE", &format!("/rest/v1/{table}?{col}=eq.{pid}"), None);
            if !nothing(&r) {
                bad(format!("deleted from {table}: {r:?}"));
            }
            // Adding: a copy of one of its rows, as a new one.
            let Some(mut copy) = rows(&s, &format!("/rest/v1/{table}?{col}=eq.{pid}&select=*&limit=1")).into_iter().next() else {
                bad(format!("{table} has no rows left to copy"));
                continue;
            };
            for k in ["id", "seq", "number", "created_at", "updated_at"] {
                copy.as_object_mut().unwrap().remove(k);
            }
            match *table {
                "project_members" => copy["person_id"] = json!(sam_id),
                "project_machines" => copy["machine_id"] = json!(other_id),
                "projects" => continue,
                _ => {}
            }
            let r = attempt(&s, who, "POST", &format!("/rest/v1/{table}"), Some(copy));
            if !nothing(&r) {
                bad(format!("added to {table}: {r:?}"));
            }
        }

        // Functions that act on one of the Project's things.
        for (f, args) in [
            ("claim_dispatch", json!({ "dispatch": did })),
            ("finish_dispatch", json!({ "dispatch": did, "ok": true, "message": "done" })),
            ("give_up_dispatch", json!({ "dispatch": did, "why": "no" })),
            ("finish_loop", json!({ "loop": lid })),
            ("stop_loop", json!({ "loop": lid })),
            ("loop_note", json!({ "loop": lid, "note": "hi" })),
            ("loop_ran", json!({ "loop": lid, "due": "2030-01-01T00:00:00Z" })),
            ("pick_up_tasks", json!({ "session": sid })),
        ] {
            let r = attempt(&s, who, "POST", &format!("/rest/v1/rpc/{f}"), Some(args));
            if !nothing(&r) && r != Ok(json!(false)) && r != Ok(json!(0)) {
                bad(format!("{f}: {r:?}"));
            }
        }
        for (f, args) in [("can_use_project", json!({ "p": pid })), ("runs_team", json!({ "team": team_id })), ("machine_can_use", json!({ "machine": mac_id, "project": pid }))] {
            let r = attempt(&s, who, "POST", &format!("/rest/v1/rpc/{f}"), Some(args));
            if f != "machine_can_use" && matches!(r, Ok(Value::Bool(true))) {
                bad(format!("{f} said yes"));
            }
        }
        if let Ok(Value::Array(lines)) = attempt(&s, who, "POST", "/rest/v1/rpc/recent_changes", Some(json!({}))) {
            if lines.iter().any(|l| l["project_id"] == json!(pid)) {
                bad("recent_changes showed the Project's changes".into());
            }
        }

        // The person and machine themselves: seen maybe, changed never.
        for (table, filter, change) in [
            ("people", format!("id=eq.{pat_id}"), json!({ "display_name": "Hacked" })),
            ("machines", format!("id=eq.{mac_id}"), json!({ "name": "hacked", "active": false, "owner": null })),
            ("tailscale_identities", format!("person_id=eq.{pat_id}"), json!({ "display_name": "Hacked" })),
        ] {
            let r = attempt(&s, who, "PATCH", &format!("/rest/v1/{table}?{filter}"), Some(change));
            if !nothing(&r) {
                bad(format!("changed {table}: {r:?}"));
            }
            let r = attempt(&s, who, "DELETE", &format!("/rest/v1/{table}?{filter}"), None);
            if !nothing(&r) {
                bad(format!("deleted from {table}: {r:?}"));
            }
        }

        // Stored files: not read, listed, replaced, added or removed.
        if let Some(login) = &who.login {
            if s.download_as(login, "comment-images", &file).is_ok() {
                bad("downloaded the Project's image".into());
            }
            if s.upload_as(login, "comment-images", &format!("{pid}/{}.png", Uuid::new_v4()), b"\x89PNG\r\n\x1a\nx", "image/png").is_ok() {
                bad("put an image in the Project's folder".into());
            }
        }
        let r = attempt(&s, who, "POST", "/storage/v1/object/list/comment-images", Some(json!({ "prefix": pid, "limit": 100 })));
        if !nothing(&r) {
            bad(format!("listed the Project's images: {r:?}"));
        }
        let r = attempt(&s, who, "DELETE", "/storage/v1/object/comment-images", Some(json!({ "prefixes": [file] })));
        if !nothing(&r) {
            bad(format!("removed the Project's image: {r:?}"));
        }
        let r = attempt(&s, who, "GET", &format!("/storage/v1/object/public/comment-images/{file}"), None);
        if r.is_ok() {
            bad("got the image without signing in, by its public address".into());
        }
    }

    assert!(problems.is_empty(), "outsiders got through:\n{}", problems.join("\n"));
    // Nothing of the Project changed, and its people and machine are as they were.
    assert!(fingerprint(&s, &pid) == before, "the Project's rows changed");
    assert_eq!(rows(&s, &format!("/rest/v1/people?id=eq.{pat_id}&select=display_name"))[0]["display_name"], "Pat");
    assert_eq!(rows(&s, &format!("/rest/v1/machines?id=eq.{mac_id}&select=active"))[0]["active"], true);
    assert!(s.download_as(&pat, "comment-images", &file).is_ok(), "the Project's image is still there");
}
