//! End-to-end tests for the session host (`omicron sessions host / send /
//! hosted`): a real host, a real terminal, talked to over its socket the way
//! `attach` does.

use omicron::host::{frame, INPUT, RESIZE};
use std::io::{Read, Write};
use std::os::unix::net::UnixStream;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

fn new_home() -> PathBuf {
    // Short: socket paths have a length limit.
    let dir = PathBuf::from(format!("/tmp/oh-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn omicron(home: &Path, args: &[&str]) -> (bool, String) {
    let out = Command::new(env!("CARGO_BIN_EXE_omicron")).env("OMICRON_HOME", home).args(args).output().unwrap();
    (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

/// Read from the session until `want` shows up (or fail after a while).
fn read_until(s: &mut UnixStream, seen: &mut String, want: &str) {
    s.set_read_timeout(Some(Duration::from_millis(200))).unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut buf = [0u8; 4096];
    while !seen.contains(want) {
        assert!(Instant::now() < deadline, "never saw {want:?}; saw {seen:?}");
        if let Ok(n) = s.read(&mut buf) {
            seen.push_str(&String::from_utf8_lossy(&buf[..n]));
        }
    }
}

fn socket(home: &Path, name: &str) -> UnixStream {
    UnixStream::connect(home.join("run").join(format!("{name}.sock"))).unwrap()
}

#[test]
fn a_hosted_session_keeps_running_and_can_be_joined_typed_into_and_resized() {
    let home = new_home();
    let (ok, out) = omicron(&home, &["sessions", "host", "t1", "--", "sh", "-c", "echo ready; read x; stty size; cat"]);
    assert!(ok, "{out}");
    assert!(out.contains("t1 is running"), "{out}");
    // The command that started it has exited; the host carries on.
    assert_eq!(omicron(&home, &["sessions", "hosted"]).1.trim(), "t1");

    // Someone jumping in later sees what was already printed.
    let mut a = socket(&home, "t1");
    let mut seen = String::new();
    read_until(&mut a, &mut seen, "ready");

    // A new size reaches the program's terminal.
    a.write_all(&frame(RESIZE, &[0, 33, 0, 77])).unwrap();
    std::thread::sleep(Duration::from_millis(200));
    a.write_all(&frame(INPUT, b"\r")).unwrap();
    read_until(&mut a, &mut seen, "33 77");

    // Typing from a second connection (`send`) shows up for everyone.
    let (ok, out) = omicron(&home, &["sessions", "send", "t1", "hello there\\r"]);
    assert!(ok, "{out}");
    read_until(&mut a, &mut seen, "hello there");
    let mut b = socket(&home, "t1");
    let mut seen_b = String::new();
    read_until(&mut b, &mut seen_b, "hello there");

    // Two senders at once: each message arrives whole, on its own line
    // (one types at a time, and Enter comes on its own after the text).
    let home2 = home.clone();
    let other = std::thread::spawn(move || omicron(&home2, &["sessions", "send", "t1", &"B".repeat(300)]));
    let (ok, out) = omicron(&home, &["sessions", "send", "t1", &"A".repeat(300)]);
    assert!(ok, "{out}");
    assert!(other.join().unwrap().0);
    read_until(&mut a, &mut seen, &"A".repeat(300));
    read_until(&mut a, &mut seen, &"B".repeat(300));
    let lines: Vec<&str> = seen.split(['\r', '\n']).filter(|l| l.contains('A') || l.contains('B')).collect();
    assert!(lines.iter().all(|l| !(l.contains('A') && l.contains('B'))), "the messages got mixed: {lines:?}");

    // A second session with the same name is refused while it runs.
    assert!(omicron(&home, &["sessions", "host", "t1", "--", "true"]).1.contains("already running"));

    // The program ends (Ctrl-D to cat): the host cleans up and stops.
    a.write_all(&frame(INPUT, &[4])).unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while home.join("run/t1.sock").exists() {
        assert!(Instant::now() < deadline, "the socket wasn't removed");
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(omicron(&home, &["sessions", "hosted"]).1.contains("No hosted sessions"));
}

#[test]
fn names_and_missing_sessions_are_checked() {
    let home = new_home();
    assert!(omicron(&home, &["sessions", "host", "../x", "--", "true"]).1.contains("a session name is"));
    assert!(omicron(&home, &["sessions", "attach", "nope"]).1.contains("no session called nope is running"));
}

/// Someone jumped in who stops reading (a paused terminal) mustn't hold up
/// the session: others can still jump in and type, it still counts as
/// running, and a busy host is never taken for a dead one (#94).
#[test]
fn a_client_that_stops_reading_doesnt_hold_up_the_session() {
    let home = new_home();
    // Lots of output, all the time.
    let (ok, out) = omicron(&home, &["sessions", "host", "busy", "--", "sh", "-c", "while :; do echo lots of output lots of output lots of output; done"]);
    assert!(ok, "{out}");
    // Jumps in, never reads.
    let _stuck = socket(&home, "busy");
    std::thread::sleep(Duration::from_secs(8));
    // Others still get in, and it's still running.
    let mut a = socket(&home, "busy");
    let mut seen = String::new();
    read_until(&mut a, &mut seen, "lots of output");
    assert_eq!(omicron(&home, &["sessions", "hosted"]).1.trim(), "busy");
    let (ok, out) = omicron(&home, &["sessions", "send", "busy", "x"]);
    assert!(ok, "{out}");

    // A host that's alive but doesn't answer is still listed, socket kept.
    let pid: u32 = std::fs::read_to_string(home.join("run/busy.pid")).unwrap().trim().parse().unwrap();
    Command::new("kill").args(["-STOP", &pid.to_string()]).status().unwrap();
    // Fill its queue of people waiting to get in.
    let waiting: Vec<_> = (0..300).filter_map(|_| UnixStream::connect(home.join("run/busy.sock")).ok()).collect();
    assert_eq!(omicron(&home, &["sessions", "hosted"]).1.trim(), "busy");
    assert!(home.join("run/busy.sock").exists());
    drop(waiting);
    Command::new("kill").args(["-CONT", &pid.to_string()]).status().unwrap();

    // Gone for real: no longer listed.
    Command::new("kill").args(["-9", &pid.to_string()]).status().unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert!(omicron(&home, &["sessions", "hosted"]).1.contains("No hosted sessions"));
}
