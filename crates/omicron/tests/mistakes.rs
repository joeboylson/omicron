//! Every command's mistakes say what to do: a plain message, a non-zero
//! exit, never a crash or a raw error dump.
//!
//! Runs only when the test Supabase is set up (see `scripts/test.sh`).

mod common;
use common::*;

/// What a mistake must never show a person.
const RAW: &[&str] = &["Supabase said", "\"code\"", "violates", "os error", "environment variable", "panicked", "RUST_BACKTRACE", "called `Result::unwrap()`"];

#[test]
fn mistakes_fail_plainly_and_say_what_to_do() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };
    let (me, p) = person_with_project(&s, "Robin");
    ok(&me, &["tasks", "add", &p, "One"]);
    let mut problems = Vec::new();
    for (case, want) in CASES {
        let args: Vec<String> = case.iter().map(|w| w.replace("{p}", &p)).collect();
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        let o = omicron(&me, &args);
        let err = String::from_utf8_lossy(&o.stderr).to_string();
        if o.status.success() {
            problems.push(format!("omicron {} worked, but shouldn't have", args.join(" ")));
        } else if err.trim().is_empty() {
            problems.push(format!("omicron {} failed without saying why", args.join(" ")));
        } else if let Some(raw) = RAW.iter().find(|r| err.contains(*r)) {
            problems.push(format!("omicron {} shows {raw:?}: {err}", args.join(" ")));
        } else if !err.to_lowercase().contains(&want.to_lowercase()) {
            problems.push(format!("omicron {} should say {want:?}: {err}", args.join(" ")));
        }
    }
    assert!(problems.is_empty(), "{}", problems.join("\n"));
}

/// (the command, what its message must mention)
const CASES: &[(&[&str], &str)] = &[
    (&["tasks", "list", "No such Project"], "no Project called No such Project"),
    (&["tasks", "show", "{p}", "999"], "no task #999"),
    (&["tasks", "show", "{p}", "abc"], "invalid value 'abc'"),
    (&["tasks", "add", "{p}", "x", "--due", "tomorrow"], "dates look like"),
    (&["tasks", "add", "{p}", "x", "--due", "2026-02-30"], "isn't on the calendar"),
    (&["tasks", "add", "{p}", "x", "--status", "Nope"], "It has: To do, Done"),
    (&["tasks", "add", "{p}", "x", "--to", "Nobody"], "nobody called Nobody"),
    (&["tasks", "move", "{p}", "1", "Nope"], "no status called Nope"),
    (&["tasks", "move", "{p}", "1", "--before", "99"], "#99 isn't in that status"),
    (&["tasks", "move", "{p}", "1", "--top", "--bottom"], "cannot be used with"),
    (&["tasks", "tick", "{p}", "1", "5"], "no checklist item 5"),
    (&["tasks", "label", "{p}", "1", " "], "the name needs some text"),
    (&["tasks", "send", "{p}", "1", "nosession"], "no session called nosession"),
    (&["tasks", "dispatch", "{p}", "1"], "give the task to a Claude session first"),
    (&["tasks", "comment", "{p}", "1", ""], "write something"),
    (&["tasks", "comment", "{p}", "1", "x", "--image", "/no/such.png"], "can't read /no/such.png"),
    (&["tasks", "comment", "{p}", "1", "x", "--image", "/etc/hosts"], "isn't an image"),
    (&["tasks", "unread", "{p}", "1"], "only a Claude session"),
    (&["tasks", "link", "{p}", "1", "noteam", "1"], "no team called noteam"),
    (&["tasks", "mine"], "inside a Claude session"),
    (&["tasks", "frobnicate"], "unrecognized subcommand"),
    (&["statuses", "color", "{p}", "Nope", "red"], "no status called Nope"),
    (&["statuses", "color", "{p}", "To do", "plaid"], "isn't one of the colors"),
    (&["labels", "rename", "{p}", "nope", "x"], "no label called nope"),
    (&["labels", "remove", "{p}", "nope"], "no label called nope"),
    (&["topics", "rename", "{p}", "nope", "x"], "no topic called nope"),
    (&["topics", "remove", "{p}", "nope"], "no topic called nope"),
    (&["people", "add", "nobody", "{p}"], "nobody called nobody"),
    (&["machines", "add", "nomachine", "{p}"], "no machine called nomachine"),
    (&["machines", "use-key", "not-a-key"], "start with `omk_`"),
    (&["handoff", "show", "{p}", "9"], "no handoff note #9"),
    (&["handoff", "write", "x"], "inside a Claude session"),
    (&["loops", "start", "go", "--every", "soon"], "say how often"),
    (&["loops", "stop"], "name the session"),
    (&["teams", "jobs", "noteam"], "no team called noteam"),
    (&["teams", "start", "--project", "{p}", "--folder", "/tmp"], "no team set up"),
    (&["teams", "handoff", "done"], "in a team's session"),
    (&["accounts", "use", "noaccount"], "no saved account called noaccount"),
    (&["accounts", "remove", "noaccount"], "no saved account called noaccount"),
    (&["projects", "new", "{p}"], "already have a Project called"),
    (&["projects", "new", "   "], "needs some text"),
    (&["trust", "/no/such/folder"], "no folder"),
];

#[test]
fn supabase_down_says_so_plainly() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };
    let me = persons_computer(&s, "Robin");
    // Nothing listens on this port.
    let config = serde_json::json!({ "supabase_url": "http://127.0.0.1:9", "supabase_key": s.key, "supabase_secret_key": s.secret_key });
    std::fs::write(me.home.join("config.json"), config.to_string()).unwrap();
    let err = fails(&me, &["tasks", "list", "Home"]);
    assert!(err.contains("couldn't reach Supabase at http://127.0.0.1:9"), "{err}");
    assert!(!RAW.iter().any(|r| err.contains(r)), "{err}");
}
