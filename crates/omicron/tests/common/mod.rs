//! What the newer CLI tests share: throwaway people and machines on the
//! test Supabase, and running `omicron` as them.
#![allow(dead_code)]

use omicron::supa::Supabase;
use serde_json::json;
use std::path::PathBuf;
use std::process::{Command, Output};
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
