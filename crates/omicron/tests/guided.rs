//! The guided command line, driven through a real terminal: missing parts
//! of a command are asked for (menus and questions), and the finished
//! command runs. Without a terminal, nothing is asked.
//!
//! Runs only when the test Supabase is set up (see `scripts/test.sh`).

mod common;
use common::*;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, OwnedFd};
use std::process::{Child, Stdio};
use std::time::{Duration, Instant};

/// `omicron` running in a terminal of its own.
struct Term {
    child: Child,
    master: std::fs::File,
    seen: String,
}

impl Term {
    fn start(c: &Computer, args: &[&str]) -> Term {
        let size = nix::pty::Winsize { ws_row: 40, ws_col: 120, ws_xpixel: 0, ws_ypixel: 0 };
        let pty = nix::pty::openpty(Some(&size), None).unwrap();
        let slave: OwnedFd = pty.slave;
        let mut cmd = command(c, args);
        cmd.env("TERM", "xterm-256color")
            .stdin(Stdio::from(slave.try_clone().unwrap()))
            .stdout(Stdio::from(slave.try_clone().unwrap()))
            .stderr(Stdio::from(slave));
        let child = cmd.spawn().unwrap();
        let master = std::fs::File::from(pty.master);
        // Reads don't block forever.
        unsafe {
            let fd = master.as_raw_fd();
            let flags = nix::libc::fcntl(fd, nix::libc::F_GETFL);
            nix::libc::fcntl(fd, nix::libc::F_SETFL, flags | nix::libc::O_NONBLOCK);
        }
        Term { child, master, seen: String::new() }
    }

    /// What's been shown, without colors and cursor moves.
    fn plain(&self) -> String {
        let mut out = String::new();
        let mut chars = self.seen.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '\x1b' {
                if chars.peek() == Some(&'[') {
                    chars.next();
                    while let Some(n) = chars.next() {
                        if n.is_ascii_alphabetic() || n == '~' {
                            break;
                        }
                    }
                } else {
                    chars.next();
                }
            } else {
                out.push(c);
            }
        }
        out
    }

    fn wait_for(&mut self, text: &str) {
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut buf = [0u8; 8192];
        while Instant::now() < deadline {
            if self.plain().contains(text) {
                return;
            }
            match self.master.read(&mut buf) {
                Ok(n) if n > 0 => self.seen.push_str(&String::from_utf8_lossy(&buf[..n])),
                _ => std::thread::sleep(Duration::from_millis(50)),
            }
        }
        panic!("never saw {text:?}; the screen had:\n{}", self.plain());
    }

    fn keys(&mut self, k: &str) {
        if let Err(e) = self.master.write_all(k.as_bytes()) {
            panic!("couldn't type {k:?} ({e}); the screen had:\n{}", self.plain());
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    fn finish(mut self) -> (bool, String) {
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut buf = [0u8; 8192];
        loop {
            match self.master.read(&mut buf) {
                Ok(n) if n > 0 => self.seen.push_str(&String::from_utf8_lossy(&buf[..n])),
                _ => std::thread::sleep(Duration::from_millis(50)),
            }
            if let Some(status) = self.child.try_wait().unwrap() {
                // What's left to read.
                while let Ok(n) = self.master.read(&mut buf) {
                    if n == 0 {
                        break;
                    }
                    self.seen.push_str(&String::from_utf8_lossy(&buf[..n]));
                }
                return (status.success(), self.plain());
            }
            if Instant::now() > deadline {
                let _ = self.child.kill();
                panic!("omicron didn't finish; the screen had:\n{}", self.plain());
            }
        }
    }
}

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

    // Without a terminal, nothing is asked: the usual error.
    let o = omicron(&me, &["tasks", "add"]);
    assert!(!o.status.success());
    assert!(String::from_utf8_lossy(&o.stderr).contains("required"), "{}", String::from_utf8_lossy(&o.stderr));
}
