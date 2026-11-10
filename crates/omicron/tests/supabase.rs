//! Sign-in and access rules, against a real Supabase.
//!
//! Runs only when OMICRON_SUPABASE_URL, OMICRON_SUPABASE_KEY and
//! OMICRON_SUPABASE_SECRET_KEY are set (see `dev/supabase/test.sh`).
//! Otherwise each test does nothing.

use omicron::identity::TailscalePerson;
use omicron::supa::{MachineKey, Session, Supabase};
use serde_json::{json, Value};
use uuid::Uuid;

fn supabase() -> Option<Supabase> {
    let s = Supabase::from_env().ok()?;
    s.secret_key.as_ref()?;
    Some(s)
}

/// Skip the test when there's no Supabase to test against.
macro_rules! supabase_or_skip {
    () => {
        match supabase() {
            Some(s) => s,
            None => {
                eprintln!("skipped: no test Supabase set up");
                return;
            }
        }
    };
}

fn someone(name: &str) -> TailscalePerson {
    let tag = Uuid::new_v4().simple().to_string();
    TailscalePerson { login: format!("{name}-{}@example.com", &tag[..8]), display_name: name.to_string() }
}

fn ids(rows: &Value) -> Vec<String> {
    rows.as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap().to_string()).collect()
}

fn new_project(s: &Supabase, as_: &Session, name: &str) -> String {
    let row = s.request_as(as_, "POST", "/rest/v1/rpc/start_project", Some(json!({ "name": name }))).unwrap();
    row["id"].as_str().unwrap().to_string()
}

fn projects(s: &Supabase, as_: &Session) -> Vec<String> {
    ids(&s.request_as(as_, "GET", "/rest/v1/projects?select=id", None).unwrap())
}

fn people(s: &Supabase, as_: &Session) -> Vec<String> {
    ids(&s.request_as(as_, "GET", "/rest/v1/people?select=id", None).unwrap())
}

#[test]
fn the_same_tailscale_identity_is_the_same_person() {
    let s = supabase_or_skip!();
    let who = someone("ana");
    let first = s.sign_in_person(&who).unwrap();
    let again = s.sign_in_person(&who).unwrap();
    assert_eq!(first.user.id, again.user.id);
}

#[test]
fn a_new_person_sees_only_themselves() {
    let s = supabase_or_skip!();
    let _other = s.sign_in_person(&someone("ben")).unwrap();
    let new = s.sign_in_person(&someone("cat")).unwrap();
    assert!(projects(&s, &new).is_empty());
    assert_eq!(people(&s, &new), vec![new.user.id.to_string()]);
}

#[test]
fn starting_a_project_makes_you_a_member() {
    let s = supabase_or_skip!();
    let me = s.sign_in_person(&someone("dan")).unwrap();
    let project = new_project(&s, &me, "Groceries");
    assert_eq!(projects(&s, &me), vec![project]);
}

#[test]
fn machines_cant_start_projects() {
    let s = supabase_or_skip!();
    let key = s.register_machine(&format!("nope-{}", Uuid::new_v4().simple()), true).unwrap();
    let machine = s.sign_in_machine(&key).unwrap();
    assert!(s.request_as(&machine, "POST", "/rest/v1/rpc/start_project", Some(json!({ "name": "x" }))).is_err());
    assert!(s.request_as(&machine, "POST", "/rest/v1/projects", Some(json!({ "name": "x" }))).is_err());
}

#[test]
fn members_can_add_people_who_then_see_the_project() {
    let s = supabase_or_skip!();
    let me = s.sign_in_person(&someone("eve")).unwrap();
    let wife = s.sign_in_person(&someone("fay")).unwrap();
    let project = new_project(&s, &me, "House");
    assert!(projects(&s, &wife).is_empty());

    // Members see everyone, so they can add people who aren't in any Project yet.
    assert!(people(&s, &me).contains(&wife.user.id.to_string()));
    s.request_as(&me, "POST", "/rest/v1/project_members", Some(json!({ "project_id": project, "person_id": wife.user.id })))
        .unwrap();
    assert_eq!(projects(&s, &wife), vec![project.clone()]);

    // And any member can take someone out again.
    s.request_as(&wife, "DELETE", &format!("/rest/v1/project_members?project_id=eq.{project}&person_id=eq.{}", me.user.id), None)
        .unwrap();
    assert!(projects(&s, &me).is_empty());
}

#[test]
fn people_outside_a_project_cant_add_themselves() {
    let s = supabase_or_skip!();
    let me = s.sign_in_person(&someone("gus")).unwrap();
    let stranger = s.sign_in_person(&someone("hal")).unwrap();
    let project = new_project(&s, &me, "Private");
    let tried =
        s.request_as(&stranger, "POST", "/rest/v1/project_members", Some(json!({ "project_id": project, "person_id": stranger.user.id })));
    assert!(tried.is_err());
    assert!(projects(&s, &stranger).is_empty());
}

#[test]
fn a_second_tailscale_identity_signs_in_as_the_same_person() {
    let s = supabase_or_skip!();
    let personal = someone("ivy");
    let work = someone("ivy-work");
    let me = s.sign_in_person(&personal).unwrap();
    s.link_tailscale_identity(me.user.id, &work).unwrap();
    assert_eq!(s.sign_in_person(&work).unwrap().user.id, me.user.id);
}

#[test]
fn machines_see_only_the_projects_they_were_added_to() {
    let s = supabase_or_skip!();
    let me = s.sign_in_person(&someone("jo")).unwrap();
    let mine = new_project(&s, &me, "Work");
    let _other = new_project(&s, &me, "Other");

    let key = s.register_machine(&format!("laptop-{}", Uuid::new_v4().simple()), false).unwrap();
    let machine = s.sign_in_machine(&key.to_string().parse::<MachineKey>().unwrap()).unwrap();
    assert!(projects(&s, &machine).is_empty());

    s.request_as(&me, "POST", "/rest/v1/project_machines", Some(json!({ "project_id": mine, "machine_id": key.machine_id })))
        .unwrap();
    assert_eq!(projects(&s, &machine), vec![mine.clone()]);

    // Machines can't add people or other machines.
    let tried = s.request_as(&machine, "POST", "/rest/v1/project_members", Some(json!({ "project_id": mine, "person_id": me.user.id })));
    assert!(tried.is_err());

    // A machine that's switched off sees nothing.
    s.admin_request("PATCH", &format!("/rest/v1/machines?id=eq.{}", key.machine_id), Some(json!({ "active": false }))).unwrap();
    assert!(projects(&s, &machine).is_empty());
}

#[test]
fn machines_with_every_project_see_new_ones_too() {
    let s = supabase_or_skip!();
    let key = s.register_machine(&format!("mini-{}", Uuid::new_v4().simple()), true).unwrap();
    let machine = s.sign_in_machine(&key).unwrap();
    let me = s.sign_in_person(&someone("kim")).unwrap();
    let project = new_project(&s, &me, "Later");
    assert!(projects(&s, &machine).contains(&project));
}

#[test]
fn machines_can_check_in() {
    let s = supabase_or_skip!();
    let key = s.register_machine(&format!("spark-{}", Uuid::new_v4().simple()), false).unwrap();
    let machine = s.sign_in_machine(&key).unwrap();
    s.request_as(&machine, "POST", "/rest/v1/rpc/machine_check_in", Some(json!({}))).unwrap();
    let row = s.request_as(&machine, "GET", &format!("/rest/v1/machines?id=eq.{}&select=last_seen", key.machine_id), None).unwrap();
    assert!(row[0]["last_seen"].is_string(), "{row}");
}

#[test]
fn machine_names_are_unique() {
    let s = supabase_or_skip!();
    let name = format!("dup-{}", Uuid::new_v4().simple());
    s.register_machine(&name, false).unwrap();
    let err = s.register_machine(&name, false).unwrap_err().to_string();
    assert!(err.contains("already a machine"), "{err}");
}

#[test]
fn a_wrong_machine_key_is_refused() {
    let s = supabase_or_skip!();
    let key = s.register_machine(&format!("box-{}", Uuid::new_v4().simple()), false).unwrap();
    let wrong = format!("omk_{}_{}", key.machine_id.simple(), "0".repeat(64)).parse::<MachineKey>().unwrap();
    let err = s.sign_in_machine(&wrong).unwrap_err().to_string();
    assert!(err.contains("doesn't work"), "{err}");
}
