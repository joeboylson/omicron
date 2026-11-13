//! The full-screen pickers and jumping into a running session, driven
//! through a real terminal: arrows, Ctrl-P/Ctrl-N, typing to filter,
//! backspace, nothing matching, Enter, Esc, the detach key, and the screen
//! put back after. Plus what they print when there's no terminal.
//!
//! Runs only when the test Supabase is set up (see `scripts/test.sh`).

mod common;
use common::*;
use serde_json::json;
use std::path::PathBuf;
use uuid::Uuid;

const UP: &str = "\x1b[A";
const DOWN: &str = "\x1b[B";
const ENTER: &str = "\r";
const ESC: &str = "\x1b";
const DETACH: &str = "\x1c";

/// A machine whose Omicron folder has a short path (socket paths are short).
fn short_machine(s: &omicron::supa::Supabase) -> Computer {
    let m = machine(s);
    let short = PathBuf::from(format!("/tmp/opk-{}", &Uuid::new_v4().simple().to_string()[..8]));
    std::fs::rename(&m.home, &short).unwrap();
    Computer { home: short, ..m }
}

/// Host a little program as a session called `name`: it prints `hello
/// from <name>`, then echoes what it's typed; typed `detach`, it runs
/// `omicron detach` from inside.
fn host(c: &Computer, name: &str) {
    let o = env!("CARGO_BIN_EXE_omicron");
    let script = format!("echo hello from {name}; while read -r l; do if [ \"$l\" = detach ]; then {o} detach; else echo \"got: $l\"; fi; done");
    ok(c, &["sessions", "host", name, "--", "sh", "-c", &script]);
}

#[test]
fn sessions_pick_attach_and_detach_through_a_terminal() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };
    let (pat, project) = person_with_project(&s, "Pat");
    let mac = short_machine(&s);
    let mac_id = mac.machine_id.unwrap();
    let names: Vec<String> = s.admin_request("GET", &format!("/rest/v1/machines?id=eq.{mac_id}&select=name"), None).unwrap()[0]["name"]
        .as_str()
        .map(|n| vec![n.to_string()])
        .unwrap();
    ok(&pat, &["machines", "add", &names[0], &project]);
    let pid = s.admin_request("GET", &format!("/rest/v1/projects?name=eq.{project}&select=id"), None).unwrap()[0]["id"].as_str().unwrap().to_string();
    // Three sessions on this machine: two running in the background, one
    // whose Claude stopped without saying.
    for name in ["alpha", "bravo-web", "charlie"] {
        s.admin_request("POST", "/rest/v1/sessions", Some(json!({ "project_id": pid, "machine_id": mac_id, "name": name, "folder": "/code" })))
            .unwrap();
    }
    host(&mac, "alpha");
    host(&mac, "bravo-web");

    // Without a terminal: one line per session, running first.
    let listed = ok(&mac, &["sessions", "pick"]);
    let first: Vec<&str> = listed.lines().map(|l| l.split('\t').next().unwrap()).collect();
    assert_eq!(first, ["alpha", "bravo-web", "charlie"], "{listed}");
    assert!(listed.lines().next().unwrap().contains("\trunning\t"), "{listed}");
    assert!(listed.lines().nth(2).unwrap().contains("\tstopped\t"), "{listed}");

    // Arrows and Ctrl-N/Ctrl-P move; typing filters; Enter jumps in.
    let mut t = Term::start(&mac, &["sessions", "pick"]);
    t.wait_for("Sessions on this machine");
    t.wait_for("charlie");
    t.keys(DOWN);
    t.keys("\x0e"); // Ctrl-N
    t.keys(UP);
    t.keys("\x10"); // Ctrl-P: back on alpha
    t.keys("zzz");
    t.wait_for("Nothing matches.");
    for _ in 0..3 {
        t.keys("\x7f"); // backspace
    }
    t.keys("web");
    t.keys(ENTER);
    t.wait_for("hello from bravo-web");
    t.keys("ping");
    t.keys(ENTER);
    t.wait_for("got: ping");
    // Ctrl-\ lets go: it keeps running.
    t.keys(DETACH);
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");
    assert!(ok(&mac, &["sessions", "hosted"]).contains("bravo-web"));
    // The picker used the alternate screen and put the terminal back
    // (cursor shown again, normal screen).
    let raw = last_raw();
    assert!(raw.contains("\x1b[?1049h") && raw.contains("\x1b[?1049l") && raw.contains("\x1b[?25h"), "{raw:?}");

    // One that stopped without saying: picking it says so, and it ends.
    let mut t = Term::start(&mac, &["sessions", "pick"]);
    t.wait_for("charlie");
    t.keys("charlie");
    t.keys(ENTER);
    let (fine, screen) = t.finish();
    assert!(!fine && screen.contains("charlie had stopped, so it's ended"), "{screen}");
    assert!(!ok(&mac, &["sessions", "list", "--project", &project]).contains("charlie"));

    // Esc quits, doing nothing.
    let mut t = Term::start(&mac, &["sessions", "pick"]);
    t.wait_for("alpha");
    t.keys(ESC);
    let (fine, _) = t.finish();
    assert!(fine);

    // `omicron open <name>` jumps straight back in, and what was printed
    // before shows.
    let mut t = Term::start(&mac, &["open", "alpha"]);
    t.wait_for("hello from alpha");
    t.keys("again");
    t.keys(ENTER);
    t.wait_for("got: again");
    // `omicron detach`, run inside the session, lets go too.
    t.keys("detach");
    t.keys(ENTER);
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");
    assert!(screen.contains("[detached from alpha"), "{screen}");
    assert!(ok(&mac, &["sessions", "hosted"]).contains("alpha"));

    // It ends while jumped in: says so and returns.
    let mut t = Term::start(&mac, &["sessions", "attach", "alpha"]);
    t.wait_for("got: again");
    t.keys("\x04"); // Ctrl-D: its `read` ends, and so does the program
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");
    assert!(screen.contains("alpha ended."), "{screen}");
    assert!(!ok(&mac, &["sessions", "hosted"]).contains("alpha"));

    ok(&mac, &["sessions", "send", "bravo-web", "\x04", "--no-enter"]);
    let _ = std::fs::remove_dir_all(&mac.home);
}

#[test]
fn teams_view_and_pick_through_a_terminal() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };
    let (pat, project) = person_with_project(&s, "Pat");
    let mac = short_machine(&s);
    let mac_name = s.admin_request("GET", &format!("/rest/v1/machines?id=eq.{}&select=name", mac.machine_id.unwrap()), None).unwrap()[0]["name"]
        .as_str()
        .unwrap()
        .to_string();
    ok(&pat, &["machines", "add", &mac_name, &project]);

    // A team folder, in git, started (no daemon here, so nobody runs yet).
    let folder = mac.home.join("app");
    std::fs::create_dir_all(&folder).unwrap();
    let git = |args: &[&str]| {
        let o = std::process::Command::new("git").arg("-C").arg(&folder).args(["-c", "user.email=t@x", "-c", "user.name=T"]).args(args).output().unwrap();
        assert!(o.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&o.stderr));
    };
    git(&["init", "-q", "-b", "main"]);
    std::fs::write(folder.join("app.txt"), "one\n").unwrap();
    git(&["add", "."]);
    git(&["commit", "-qm", "start"]);
    let team = format!("tv{}", &Uuid::new_v4().simple().to_string()[..4]);
    let in_folder = |args: &[&str]| {
        let o = command(&mac, args).current_dir(&folder).output().unwrap();
        assert!(o.status.success(), "omicron {args:?}: {}", String::from_utf8_lossy(&o.stderr));
        String::from_utf8_lossy(&o.stdout).to_string()
    };
    in_folder(&["teams", "init", "--name", &team]);
    git(&["add", "."]);
    git(&["commit", "-qm", "team"]);
    in_folder(&["teams", "start", "--project", &project]);
    in_folder(&["teams", "add-job", &team, "A job"]);

    // A job's checkout with a change in it, where Omicron keeps them.
    let tid = s.admin_request("GET", &format!("/rest/v1/teams?name=eq.{team}&select=id"), None).unwrap()[0]["id"].as_str().unwrap().to_string();
    let wt = mac.home.join("teams").join(format!("{team}-{}", &tid[..8])).join("job-1");
    git(&["worktree", "add", "-q", "-b", "job/1-a-job", wt.to_str().unwrap()]);
    std::fs::write(wt.join("app.txt"), "one\ntwo\n").unwrap();
    std::fs::write(wt.join("new.txt"), "brand new\n").unwrap();

    // Without a terminal: one line per file.
    let listed = in_folder(&["teams", "view", &team]);
    assert!(listed.contains("setup\t\troles/builder.md\t"), "{listed}");
    assert!(listed.contains("job #1\tchanged\tapp.txt\t"), "{listed}");
    assert!(listed.contains("job #1\tnew\tnew.txt\t"), "{listed}");

    // In a terminal: filter, open a changed file as its diff, page, go back.
    let mut t = Term::start(&mac, &["teams", "view", &team]);
    t.wait_for(&format!("{team} ·"));
    t.wait_for("roles/planner.md");
    t.keys("app.txt");
    t.keys(ENTER);
    t.wait_for("+two");
    t.wait_for("Esc back");
    t.keys(" "); // a page down at the end goes nowhere
    t.keys("g");
    t.keys(ESC); // back to the list
    t.wait_for("roles/planner.md");
    t.keys("\x7f\x7f\x7f\x7f\x7f\x7f\x7f");
    t.keys("new");
    t.keys(ENTER);
    t.wait_for("brand new");
    t.keys("q");
    t.keys(ESC); // and out
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");

    // teams pick: nobody in the team runs here yet, so it says so.
    let out = ok(&mac, &["teams", "pick", &team]);
    assert!(out.contains(&format!("Nobody in {team} is running on this machine")), "{out}");
    // A member running in the host: listed, and Enter jumps in.
    host(&mac, &format!("{team}.lead"));
    s.admin_request("POST", "/rest/v1/workers", Some(json!({ "team_id": tid, "name": "lead", "role": "lead", "state": "busy" }))).unwrap();
    let listed = ok(&mac, &["teams", "pick"]);
    assert!(listed.starts_with(&format!("{team}.lead\tlead\tbusy\t")), "{listed}");
    let mut t = Term::start(&mac, &["teams", "pick", &team]);
    t.wait_for(&format!("{team} on this machine"));
    t.keys(ENTER);
    t.wait_for(&format!("hello from {team}.lead"));
    t.keys(DETACH);
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");

    ok(&mac, &["sessions", "send", &format!("{team}.lead"), "\x04", "--no-enter"]);
    git(&["worktree", "remove", "--force", wt.to_str().unwrap()]);
    let _ = std::fs::remove_dir_all(&mac.home);
}

#[test]
fn open_asks_for_a_new_sessions_name_in_a_terminal() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };
    let (pat, project) = person_with_project(&s, "Pat");
    let mac = short_machine(&s);
    let mac_id = mac.machine_id.unwrap();
    let name = s.admin_request("GET", &format!("/rest/v1/machines?id=eq.{mac_id}&select=name"), None).unwrap()[0]["name"].as_str().unwrap().to_string();
    ok(&pat, &["machines", "add", &name, &project]);
    let code = mac.home.join("code");
    std::fs::create_dir_all(&code).unwrap();
    let bin = mac.home.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    std::fs::write(bin.join("claude"), "#!/bin/sh\necho \"claude $3 $4\"\ncat\n").unwrap();
    std::process::Command::new("chmod").args(["+x", bin.join("claude").to_str().unwrap()]).status().unwrap();
    let path = format!("{}:{}", bin.display(), std::env::var("PATH").unwrap());
    let open = |typed: &str| {
        let mut t = Term::start_env(&mac, &["open", "--project", &project, "--folder", code.to_str().unwrap()], &[("PATH", &path)]);
        t.wait_for("Name for the session (code):");
        t.keys(typed);
        t.keys(ENTER);
        t
    };

    // Typed: that name. (Ctrl-\ lets go, leaving it running.)
    let mut t = open("parser");
    t.wait_for("claude --name parser");
    t.keys(DETACH);
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");
    // Just Enter: the folder's name.
    let mut t = open("");
    t.wait_for("claude --name code");
    t.keys(DETACH);
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");
    let listed = ok(&mac, &["sessions", "list", "--project", &project]);
    assert!(listed.contains("parser\t") && listed.contains("code\t"), "{listed}");
    for name in ["parser", "code"] {
        ok(&mac, &["sessions", "send", name, "\x04", "--no-enter"]);
    }
    let _ = std::fs::remove_dir_all(&mac.home);
}
