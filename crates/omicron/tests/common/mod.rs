//! What the newer CLI tests share: throwaway people and machines on the
//! test Supabase, and running `omicron` as them.
#![allow(dead_code)]

use omicron::supa::Supabase;
use serde_json::json;
use std::path::PathBuf;
use std::io::{Read, Write};
use std::os::fd::{AsRawFd, OwnedFd};
use std::process::{Child, Command, Output, Stdio};
use std::time::{Duration, Instant};
use uuid::Uuid;

pub fn admin() -> Option<Supabase> {
    let s = Supabase::from_env().ok()?;
    s.secret_key.as_ref()?;
    Some(s)
}

pub fn unique(name: &str) -> String {
    format!("{name}-{}", &Uuid::new_v4().simple().to_string()[..8])
}

pub fn new_home() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("omicron-test-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A computer: its own Omicron settings, and (for a person's) who
/// Tailscale says is signed in.
pub struct Computer {
    pub home: PathBuf,
    pub tailscale: Option<PathBuf>,
    pub machine_id: Option<Uuid>,
}

pub fn persons_computer(s: &Supabase, name: &str) -> Computer {
    let home = new_home();
    std::fs::write(home.join("config.json"), json!({ "supabase_url": s.url, "supabase_key": s.key, "supabase_secret_key": s.secret_key }).to_string()).unwrap();
    let status = home.join("tailscale.json");
    let login = format!("{}@example.com", unique(&name.to_lowercase()));
    std::fs::write(&status, json!({ "Self": { "UserID": 1 }, "User": { "1": { "LoginName": login, "DisplayName": name } } }).to_string()).unwrap();
    Computer { home, tailscale: Some(status), machine_id: None }
}

/// A registered machine without the secret key (how a Claude session acts).
pub fn machine(s: &Supabase) -> Computer {
    let home = new_home();
    let key = s.register_machine(&unique("box"), false).unwrap();
    std::fs::write(home.join("config.json"), json!({ "supabase_url": s.url, "supabase_key": s.key, "machine_key": key.to_string() }).to_string()).unwrap();
    Computer { home, tailscale: None, machine_id: Some(key.machine_id) }
}

pub fn command(c: &Computer, args: &[&str]) -> Command {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_omicron"));
    for (k, _) in std::env::vars() {
        if k.starts_with("OMICRON_") {
            cmd.env_remove(k);
        }
    }
    cmd.env("OMICRON_HOME", &c.home).env("CLAUDE_CONFIG_DIR", c.home.join("claude-code"));
    if let Some(t) = &c.tailscale {
        cmd.env("OMICRON_TAILSCALE_STATUS", t);
    }
    cmd.args(args);
    cmd
}

pub fn omicron(c: &Computer, args: &[&str]) -> Output {
    command(c, args).output().unwrap()
}

pub fn ok(c: &Computer, args: &[&str]) -> String {
    let o = omicron(c, args);
    assert!(o.status.success(), "omicron {args:?} failed: {}", String::from_utf8_lossy(&o.stderr));
    String::from_utf8_lossy(&o.stdout).to_string()
}

/// It failed, plainly: a non-zero exit, a message, and never a crash.
pub fn fails(c: &Computer, args: &[&str]) -> String {
    let o = omicron(c, args);
    let err = String::from_utf8_lossy(&o.stderr).to_string();
    assert!(!o.status.success(), "omicron {args:?} should have failed: {}", String::from_utf8_lossy(&o.stdout));
    assert!(!err.contains("panicked") && !err.contains("RUST_BACKTRACE"), "omicron {args:?} crashed: {err}");
    assert!(!err.trim().is_empty(), "omicron {args:?} failed without saying why");
    err
}

/// A person with a fresh Project of their own. Returns (computer, project name).
pub fn person_with_project(s: &Supabase, name: &str) -> (Computer, String) {
    let me = persons_computer(s, name);
    let project = unique("House");
    ok(&me, &["projects", "new", &project]);
    (me, project)
}

/// `omicron` running in a terminal of its own.
pub struct Term {
    pub child: Child,
    master: std::fs::File,
    seen: String,
}

impl Term {
    pub fn start(c: &Computer, args: &[&str]) -> Term {
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
    pub fn plain(&self) -> String {
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

    pub fn wait_for(&mut self, text: &str) {
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

    pub fn keys(&mut self, k: &str) {
        if let Err(e) = self.master.write_all(k.as_bytes()) {
            panic!("couldn't type {k:?} ({e}); the screen had:\n{}", self.plain());
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    pub fn finish(mut self) -> (bool, String) {
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
                let plain = self.plain();
                RAW_SEEN.with(|r| *r.borrow_mut() = self.seen.clone());
                return (status.success(), plain);
            }
            if Instant::now() > deadline {
                let _ = self.child.kill();
                panic!("omicron didn't finish; the screen had:\n{}", self.plain());
            }
        }
    }
}


thread_local! {
    /// What the last finished terminal showed, escape codes and all.
    pub static RAW_SEEN: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

/// The last finished terminal's output, escape codes and all.
pub fn last_raw() -> String {
    RAW_SEEN.with(|r| r.borrow().clone())
}
