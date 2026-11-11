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
    assert!(omicron(&home, &["sessions", "send", "nope", "x"]).1.contains("no session called nope is running"));
}
