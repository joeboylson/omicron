//! Teams in Supabase: teams, jobs and workers, and who may change what.
//! Runs only when the test Supabase is set up (see `dev/supabase/test.sh`).

use omicron::identity::TailscalePerson;
use omicron::supa::{Session, Supabase};
use serde_json::{json, Value};
use uuid::Uuid;

fn admin() -> Option<Supabase> {
    let s = Supabase::from_env().ok()?;
    s.secret_key.as_ref()?;
    Some(s)
}

fn person(s: &Supabase, name: &str) -> Session {
    let login = format!("{}-{}@example.com", name.to_lowercase(), &Uuid::new_v4().simple().to_string()[..8]);
    s.sign_in_person(&TailscalePerson { login, display_name: name.into() }).unwrap()
}

fn machine(s: &Supabase) -> (Session, Uuid) {
    let key = s.register_machine(&format!("box-{}", &Uuid::new_v4().simple().to_string()[..8]), false).unwrap();
    (s.sign_in_machine(&key).unwrap(), key.machine_id)
}

fn call(s: &Supabase, who: &Session, method: &str, path: &str, body: Value) -> anyhow::Result<Value> {
    s.request_as(who, method, path, if body.is_null() { None } else { Some(body) })
}

#[test]
fn teams_jobs_and_workers_and_who_may_change_them() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };
    let pat = person(&s, "Pat");
    let project = call(&s, &pat, "POST", "/rest/v1/rpc/start_project", json!({ "name": format!("Code-{}", Uuid::new_v4()) })).unwrap();
    let pid = project["id"].as_str().unwrap().to_string();
    let (mac, mac_id) = machine(&s);
    call(&s, &pat, "POST", "/rest/v1/project_machines", json!({ "project_id": pid, "machine_id": mac_id })).unwrap();

    // Only machines run teams.
    assert!(call(&s, &pat, "POST", "/rest/v1/teams", json!({ "project_id": pid, "name": "web", "folder": "/code/web" })).is_err());
    let team = call(&s, &mac, "POST", "/rest/v1/teams", json!({ "project_id": pid, "name": "web", "folder": "/code/web", "workflow": "feature" })).unwrap();
    let tid = team[0]["id"].as_str().unwrap().to_string();
    assert_eq!(team[0]["machine_id"], json!(mac_id));
    assert_eq!(team[0]["state"], "running");

    // People add jobs; numbers count up within the team.
    let one = call(&s, &pat, "POST", "/rest/v1/jobs", json!({ "team_id": tid, "title": "Add a login page", "number": 99 })).unwrap();
    let two = call(&s, &mac, "POST", "/rest/v1/jobs", json!({ "team_id": tid, "title": "Fix the footer" })).unwrap();
    assert_eq!((one[0]["number"].as_i64(), two[0]["number"].as_i64()), (Some(1), Some(2)));
    assert_eq!(one[0]["project_id"], json!(pid));
    let job1 = one[0]["id"].as_str().unwrap().to_string();

    // The machine runs the workers; people don't.
    assert!(call(&s, &pat, "POST", "/rest/v1/workers", json!({ "team_id": tid, "name": "builder", "role": "builder" })).is_err());
    let w = call(&s, &mac, "POST", "/rest/v1/workers", json!({ "team_id": tid, "name": "builder-2", "role": "builder", "state": "busy", "job_id": job1 })).unwrap();
    assert_eq!(w[0]["project_id"], json!(pid));
    assert!(call(&s, &mac, "POST", "/rest/v1/workers", json!({ "team_id": tid, "name": "Not A Name", "role": "x" })).is_err());

    // Moving a job along; finishing stamps the time, and its number stays.
    let moved = call(&s, &mac, "PATCH", &format!("/rest/v1/jobs?id=eq.{job1}"), json!({ "state": "working", "step": "builder", "number": 7 })).unwrap();
    assert_eq!((moved[0]["number"].as_i64(), moved[0]["step"].as_str()), (Some(1), Some("builder")));
    let done = call(&s, &mac, "PATCH", &format!("/rest/v1/jobs?id=eq.{job1}"), json!({ "state": "done", "note": "On main." })).unwrap();
    assert!(done[0]["finished_at"].is_string());
    assert!(call(&s, &mac, "PATCH", &format!("/rest/v1/jobs?id=eq.{job1}"), json!({ "state": "lost" })).is_err());

    // Another machine in the Project sees the team but can't run its workers.
    let (other, other_id) = machine(&s);
    call(&s, &pat, "POST", "/rest/v1/project_machines", json!({ "project_id": pid, "machine_id": other_id })).unwrap();
    assert_eq!(call(&s, &other, "GET", &format!("/rest/v1/teams?id=eq.{tid}&select=name"), Value::Null).unwrap()[0]["name"], "web");
    let changed = call(&s, &other, "PATCH", &format!("/rest/v1/workers?team_id=eq.{tid}"), json!({ "state": "gone" })).unwrap();
    assert_eq!(changed, json!([]), "the rules hide another machine's workers from changes");

    // Someone outside the Project sees nothing.
    let sam = person(&s, "Sam");
    assert_eq!(call(&s, &sam, "GET", &format!("/rest/v1/jobs?team_id=eq.{tid}"), Value::Null).unwrap(), json!([]));

    // Every change is on the change list, so it shows up live.
    let lines = s.admin_request("GET", &format!("/rest/v1/changes?project_id=eq.{pid}&table_name=in.(teams,jobs,workers)&select=table_name"), None).unwrap();
    let tables: std::collections::BTreeSet<&str> = lines.as_array().unwrap().iter().filter_map(|l| l["table_name"].as_str()).collect();
    assert_eq!(tables.into_iter().collect::<Vec<_>>(), ["jobs", "teams", "workers"]);
}

fn omicron(home: &std::path::Path, dir: &std::path::Path, args: &[&str]) -> (bool, String) {
    let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_omicron"));
    for (k, _) in std::env::vars() {
        if k.starts_with("OMICRON_") {
            cmd.env_remove(k);
        }
    }
    // Claude Code's own settings, just for this test machine.
    let o = cmd.env("OMICRON_HOME", home).env("CLAUDE_CONFIG_DIR", home.join("claude")).current_dir(dir).args(args).output().unwrap();
    (o.status.success(), format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr)))
}

#[test]
fn a_folder_is_set_up_its_team_started_and_given_jobs() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };
    let pat = person(&s, "Pat");
    let pname = format!("Code-{}", &Uuid::new_v4().simple().to_string()[..8]);
    let project = call(&s, &pat, "POST", "/rest/v1/rpc/start_project", json!({ "name": pname })).unwrap();
    // A machine with its own settings, in the Project.
    let home = std::env::temp_dir().join(format!("omicron-teams-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&home).unwrap();
    let key = s.register_machine(&format!("box-{}", &Uuid::new_v4().simple().to_string()[..8]), false).unwrap();
    std::fs::write(home.join("config.json"), json!({ "supabase_url": s.url, "supabase_key": s.key, "machine_key": key.to_string() }).to_string()).unwrap();
    call(&s, &pat, "POST", "/rest/v1/project_machines", json!({ "project_id": project["id"], "machine_id": key.machine_id })).unwrap();
    let folder = home.join("webapp");
    std::fs::create_dir_all(&folder).unwrap();
    let team = format!("web-{}", &Uuid::new_v4().simple().to_string()[..6]);

    let (ok, out) = omicron(&home, &folder, &["teams", "start", "--project", &pname]);
    assert!(!ok && out.contains("run `omicron teams init` there"), "{out}");
    let (ok, out) = omicron(&home, &folder, &["teams", "init", "--name", &team]);
    assert!(ok && out.contains("three roles"), "{out}");
    assert!(folder.join(".omicron-team/workflows/default.json").exists());
    // Claude Code must trust the folder first: nobody is there to answer.
    let (ok, out) = omicron(&home, &folder, &["teams", "start", "--project", &pname]);
    assert!(!ok && out.contains("doesn't trust") && out.contains("Yes, I trust this folder"), "{out}");
    std::fs::create_dir_all(home.join("claude")).unwrap();
    let trust = json!({ "projects": { folder.canonicalize().unwrap().to_string_lossy(): { "hasTrustDialogAccepted": true } } });
    std::fs::write(home.join("claude/.claude.json"), trust.to_string()).unwrap();
    let (ok, out) = omicron(&home, &folder, &["teams", "start", "--project", &pname]);
    assert!(ok, "{out}");
    assert!(out.contains("Before it can start workers: run `claude` once in"), "{out}");
    assert!(out.starts_with(&format!("Started {team} in {pname} on this machine (planner")), "{out}");

    let (ok, out) = omicron(&home, &folder, &["teams", "add-job", &team, "Add a login page", "--text", "Email and password."]);
    assert!(ok && out.trim() == format!("Added job #1 to {team}: Add a login page"), "{out}");
    omicron(&home, &folder, &["teams", "add-job", &team, "Fix the footer"]);
    let (_, out) = omicron(&home, &folder, &["teams", "jobs", &team]);
    assert_eq!(out, "#1\twaiting\tAdd a login page\n#2\twaiting\tFix the footer\n");
    let (_, out) = omicron(&home, &folder, &["teams", "list"]);
    assert!(out.lines().any(|l| l.starts_with(&format!("{team}\trunning\tdefault\t2 open jobs\t"))), "{out}");

    // A task links to jobs: shown on the task with each job's state.
    let (ok1, out) = omicron(&home, &folder, &["tasks", "add", &pname, "Ship the login page"]);
    assert!(ok1, "{out}");
    let (okl, out) = omicron(&home, &folder, &["tasks", "link", &pname, "1", &team, "1"]);
    assert!(okl, "{out}");
    assert!(out.contains(&format!("  Job: {team} #1 Add a login page (waiting)")), "{out}");
    omicron(&home, &folder, &["tasks", "link", &pname, "1", &team, "2"]);
    let (_, out) = omicron(&home, &folder, &["tasks", "show", &pname, "1"]);
    assert!(out.contains(&format!("#2 Fix the footer (waiting)")), "{out}");
    let (okd, out) = omicron(&home, &folder, &["tasks", "link", &pname, "1", &team, "1"]);
    assert!(!okd && out.contains("already linked"), "{out}");
    omicron(&home, &folder, &["tasks", "unlink", &pname, "1", &team, "2"]);
    let (_, out) = omicron(&home, &folder, &["tasks", "show", &pname, "1"]);
    assert!(!out.contains("Fix the footer"), "{out}");

    // Only jobs of teams in the task's own Project.
    let other = call(&s, &pat, "POST", "/rest/v1/rpc/start_project", json!({ "name": format!("Other-{}", Uuid::new_v4()) })).unwrap();
    let st = call(&s, &pat, "GET", &format!("/rest/v1/statuses?project_id=eq.{}&select=id&limit=1", other["id"].as_str().unwrap()), Value::Null).unwrap();
    let task = call(&s, &pat, "POST", "/rest/v1/tasks", json!({ "project_id": other["id"], "status_id": st[0]["id"], "title": "Elsewhere" })).unwrap();
    let job = s.admin_request("GET", &format!("/rest/v1/jobs?title=eq.Fix the footer&select=id,teams!inner(name)&teams.name=eq.{team}"), None).unwrap();
    let err = call(&s, &pat, "POST", "/rest/v1/task_jobs", json!({ "task_id": task[0]["id"], "job_id": job[0]["id"] }));
    assert!(err.unwrap_err().to_string().contains("its own Project"));

    // Stopped, then started again: the same team, jobs kept.
    omicron(&home, &folder, &["teams", "stop", &team]);
    let (_, out) = omicron(&home, &folder, &["teams", "list"]);
    assert!(out.contains(&format!("{team}\tstopped")), "{out}");
    omicron(&home, &folder, &["teams", "start", "--project", &pname]);
    let rows = s.admin_request("GET", &format!("/rest/v1/teams?name=eq.{team}&select=state"), None).unwrap();
    assert_eq!(rows, json!([{ "state": "running" }]));
}
