//! Odd text everywhere the CLI takes or shows it: emoji, right-to-left
//! scripts, HTML, markdown, quotes, very long text, line breaks and tabs,
//! and text that tries to act on the terminal (escape codes, bells,
//! direction overrides). Shown as plain text, one line where a line is
//! expected, and nothing that acts ever reaches the terminal.
//!
//! Runs only when the test Supabase is set up (see `scripts/test.sh`).

mod common;
use common::*;
use serde_json::json;

/// What must never reach a terminal: escape, bell, other controls (but
/// line breaks), and direction overrides.
fn acts(out: &str) -> Vec<char> {
    out.chars()
        .filter(|&c| (c.is_control() && c != '\n') || matches!(c, '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}'))
        .collect()
}

#[test]
fn odd_text_is_kept_and_shown_safely() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };
    let (me, _) = person_with_project(&s, "Robin");
    // A Project named with emoji and right-to-left text, found by its name.
    let project = format!("🏡 בית {}", unique("x"));
    ok(&me, &["projects", "new", &project]);
    assert!(ok(&me, &["projects", "list"]).contains(&project));

    let shown = [
        ("Buy 🥛 milk 🐄 (2 L)", "Buy 🥛 milk 🐄 (2 L)"),
        ("שלום עולם مرحبا بالعالم", "שלום עולם مرحبا بالعالم"),
        ("<script>alert(1)</script>", "<script>alert(1)</script>"),
        ("<img src=x onerror=alert(1)>", "<img src=x onerror=alert(1)>"),
        ("Quotes \"double\" 'single' `back` $(whoami) ; rm -rf ~", "Quotes \"double\" 'single' `back` $(whoami) ; rm -rf ~"),
        ("**bold** _it_ [link](http://x) # not a heading", "**bold** _it_ [link](http://x) # not a heading"),
        ("Zero\u{200b}width and e\u{301}", "Zero\u{200b}width and e\u{301}"),
        ("Tab\there", "Tab here"),
        ("Clear\x1b[2J\x1b[Hscreen\x07", "Clear[2J[Hscreen"),
        ("Title\x1b]0;pwned\x07bar", "Title]0;pwnedbar"),
        ("invoice\u{202E}fdp.exe", "invoicefdp.exe"),
    ];
    for (i, (title, _)) in shown.iter().enumerate() {
        let out = ok(&me, &["tasks", "add", &project, title, "--notes", "line one\nline two\x1b[31m red"]);
        assert!(out.starts_with(&format!("#{} ", i + 1)), "{out}");
    }
    // A title that's a line break goes in through the database (as the web
    // page might), not the CLI.
    let pid = ok(&me, &["projects", "list"]).lines().count(); // (just to use the Project)
    let _ = pid;

    let list = ok(&me, &["tasks", "list", &project]);
    assert!(acts(&list).is_empty(), "the list has characters that act: {:?}", acts(&list));
    for (i, (_, want)) in shown.iter().enumerate() {
        let line = format!("  #{}  {want}", i + 1);
        assert!(list.lines().any(|l| l == line), "missing {line:?} in:\n{list}");
    }
    // One line per task, plus the statuses: line breaks never split a task.
    let task_lines = list.lines().filter(|l| l.starts_with("  #")).count();
    assert_eq!(task_lines, shown.len(), "{list}");

    for (i, (_, want)) in shown.iter().enumerate() {
        let show = ok(&me, &["tasks", "show", &project, &(i + 1).to_string()]);
        assert!(acts(&show).is_empty(), "#{} shows characters that act: {:?}", i + 1, acts(&show));
        assert!(show.starts_with(&format!("#{}  {want}", i + 1)), "{show}");
        // Notes keep their lines, indented under the first.
        assert!(show.contains("  Notes: line one\n         line two[31m red"), "{show}");
        assert!(show.contains(&format!("  Project: {project}")), "{show}");
    }

    // Comments, checklist items, labels and topics: the same.
    let nasty = "<b>hi</b> 😀 שלום\x1b[5m\nsecond line";
    ok(&me, &["tasks", "comment", &project, "1", nasty]);
    ok(&me, &["tasks", "check", &project, "1", "step\x1b[2J one\nand more"]);
    ok(&me, &["tasks", "label", &project, "1", "🔥 urgent"]);
    ok(&me, &["topics", "add", &project, "מטבח <kitchen>"]);
    ok(&me, &["tasks", "topic", &project, "1", "מטבח <kitchen>"]);
    let show = ok(&me, &["tasks", "show", &project, "1"]);
    assert!(acts(&show).is_empty(), "{:?}", acts(&show));
    assert!(show.contains("<b>hi</b> 😀 שלום[5m\n    second line"), "{show}");
    assert!(show.contains("1. [ ] step[2J one and more"), "{show}");
    assert!(show.contains("[🔥 urgent]"), "{show}");
    assert!(show.contains("Topic: מטבח <kitchen>"), "{show}");
    assert!(ok(&me, &["labels", "list", &project]).contains("🔥 urgent"));
    ok(&me, &["labels", "rename", &project, "🔥 urgent", "דחוף ⚡"]);
    assert!(ok(&me, &["tasks", "show", &project, "1"]).contains("[דחוף ⚡]"));

    // Very long text: kept whole.
    let long = "word ".repeat(1000);
    let out = ok(&me, &["tasks", "add", &project, long.trim()]);
    assert!(out.contains(long.trim()), "a long title was cut");

    // Nothing at all, or only spaces: refused, plainly.
    for empty in ["", "   ", "\n\t "] {
        let err = fails(&me, &["tasks", "add", &project, empty]);
        assert!(err.to_lowercase().contains("title"), "{err}");
        fails(&me, &["projects", "new", empty]);
        fails(&me, &["topics", "add", &project, empty]);
    }

    // Text written straight into the database (as the web page or another
    // tool might) gets the same treatment.
    let pid = s
        .admin_request("GET", &format!("/rest/v1/projects?name=eq.{}&select=id", urlencode(&project)), None)
        .unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_string();
    let status = s.admin_request("GET", &format!("/rest/v1/statuses?project_id=eq.{pid}&select=id&limit=1"), None).unwrap();
    s.admin_request(
        "POST",
        "/rest/v1/tasks",
        Some(json!({ "project_id": pid, "status_id": status[0]["id"], "title": "Two\nlines\r\x1b[1;1Hand\u{9b}31m more" })),
    )
    .unwrap();
    let list = ok(&me, &["tasks", "list", &project]);
    assert!(acts(&list).is_empty(), "{:?}", acts(&list));
    assert!(list.lines().any(|l| l.ends_with("Two lines[1;1Hand31m more")), "{list}");
}

#[test]
fn a_person_tailscale_gives_no_name_is_named_by_their_login() {
    let Some(s) = admin() else {
        eprintln!("skipped: no test Supabase set up");
        return;
    };
    let login = format!("{}@example.com", unique("noname"));
    let who = omicron::identity::TailscalePerson { login: login.clone(), display_name: "  ".into() };
    let session = s.sign_in_person(&who).unwrap();
    let me = s.request_as(&session, "GET", &format!("/rest/v1/people?id=eq.{}&select=display_name", session.user.id), None).unwrap();
    assert_eq!(me[0]["display_name"], json!(login));
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}
