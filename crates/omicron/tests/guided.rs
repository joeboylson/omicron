//! The guided command line, driven through a real terminal: missing parts
//! of a command are asked for (menus and questions), and the finished
//! command runs. Without a terminal, nothing is asked.
//!
//! Runs only when the test Supabase is set up (see `scripts/test.sh`).

mod common;
use common::*;

const DOWN: &str = "\x1b[B";
const ENTER: &str = "\r";

#[test]
fn missing_parts_are_asked_for_in_a_terminal() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };
    let (me, project) = person_with_project(&s, "Robin");

    // Only one Project: picked without asking. The title is asked for.
    let mut t = Term::start(&me, &["tasks", "add"]);
    t.wait_for("Which Project?");
    t.wait_for(&project);
    t.wait_for("Title");
    t.keys("Buy milk");
    t.keys(ENTER);
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");
    assert!(screen.contains(&format!("omicron tasks add {project} 'Buy milk'")), "it says the whole command: {screen}");
    assert!(screen.contains("#1  Buy milk"), "{screen}");

    // Two Projects: a list to pick from. The task is picked from a list too.
    let other = unique("Garden");
    ok(&me, &["projects", "new", &other]);
    ok(&me, &["tasks", "add", &other, "Plant tulips"]);
    let mut t = Term::start(&me, &["tasks", "show"]);
    t.wait_for("Which Project?");
    // Projects are in name order: Garden-… before House-….
    t.keys(ENTER);
    // One task: picked without asking.
    t.wait_for("Which task? #1 Plant tulips");
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");
    assert!(screen.contains(&format!("Project: {other}")), "{screen}");

    // No action word: a menu of what the group can do.
    let mut t = Term::start(&me, &["tasks"]);
    t.wait_for("tasks: what do you want to do?");
    t.wait_for("Show a Project's tasks");
    t.keys(ENTER); // the first: list
    t.wait_for("Which Project?");
    t.keys(DOWN);
    t.keys(ENTER);
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");
    assert!(screen.contains("Buy milk"), "{screen}");

    // Nothing at all: the top menu.
    let mut t = Term::start(&me, &[]);
    t.wait_for("What do you want to do?");
    t.wait_for("projects");
    t.keys("\x1b"); // Esc: cancelled, nothing done
    let (fine, screen) = t.finish();
    assert!(!fine, "{screen}");

    // Removing something: picked from the real list, then confirmed first.
    ok(&me, &["tasks", "label", &project, "1", "urgent"]);
    let mut t = Term::start(&me, &["labels", "remove", &project]);
    t.wait_for("Which label? urgent");
    t.wait_for("can't be undone. Go ahead?");
    t.keys(ENTER); // No, the safe default
    let (fine, screen) = t.finish();
    assert!(!fine && screen.contains("Nothing changed."), "{screen}");
    assert!(ok(&me, &["labels", "list", &project]).contains("urgent"));
    let mut t = Term::start(&me, &["labels", "remove", &project]);
    t.wait_for("Go ahead?");
    t.keys("y");
    t.keys(ENTER);
    let (fine, screen) = t.finish();
    assert!(fine, "{screen}");
    assert!(!ok(&me, &["labels", "list", &project]).contains("urgent"));

    // Without a terminal, nothing is asked: the usual error.
    let o = omicron(&me, &["tasks", "add"]);
    assert!(!o.status.success());
    assert!(String::from_utf8_lossy(&o.stderr).contains("required"), "{}", String::from_utf8_lossy(&o.stderr));
}
