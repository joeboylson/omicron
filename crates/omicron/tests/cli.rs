//! End-to-end tests: run the real `omicron` command, each in its own empty
//! settings folder, the way a person would in a terminal.
//!
//! The ones that need Supabase run only when OMICRON_SUPABASE_URL,
//! OMICRON_SUPABASE_KEY and OMICRON_SUPABASE_SECRET_KEY are set (see
//! `scripts/test.sh`).

use omicron::identity::TailscalePerson;
use omicron::supa::Supabase;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use uuid::Uuid;

/// A fresh, empty settings folder for one pretend machine.
fn new_home() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("omicron-test-{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Run `omicron` with only the settings in `home`. Settings from the test's
/// own environment never leak in.
fn omicron(home: &Path, args: &[&str]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_omicron"));
    for (k, _) in std::env::vars() {
        if k.starts_with("OMICRON_") || k.starts_with("CLAUDE_CODE_") || k == "CLAUDECODE" {
            cmd.env_remove(k);
        }
    }
    cmd.env("OMICRON_HOME", home).args(args).output().unwrap()
}

fn stdout(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).trim().to_string()
}

fn stderr(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).trim().to_string()
}

fn ok(o: Output) -> String {
    assert!(o.status.success(), "command failed\nstdout: {}\nstderr: {}", stdout(&o), stderr(&o));
    stdout(&o)
}

fn fails(o: Output) -> String {
    assert!(!o.status.success(), "command should have failed\nstdout: {}", stdout(&o));
    stderr(&o)
}

struct TestSupabase {
    url: String,
    key: String,
    secret: String,
}

fn test_supabase() -> Option<TestSupabase> {
    let var = |n: &str| std::env::var(n).ok().filter(|v| !v.is_empty());
    Some(TestSupabase {
        url: var("OMICRON_SUPABASE_URL")?,
        key: var("OMICRON_SUPABASE_KEY")?,
        secret: var("OMICRON_SUPABASE_SECRET_KEY")?,
    })
}

macro_rules! supabase_or_skip {
    () => {
        match test_supabase() {
            Some(s) => s,
            None => {
                eprintln!("skipped: no test Supabase set up");
                return;
            }
        }
    };
}

/// A machine set up with the publishable key only (not a Web Machine).
fn plain_machine(s: &TestSupabase) -> PathBuf {
    let home = new_home();
    ok(omicron(&home, &["setup", "--url", &s.url, "--key", &s.key]));
    home
}

/// A machine that also has the secret key (a Web Machine).
fn web_machine(s: &TestSupabase) -> PathBuf {
    let home = plain_machine(s);
    ok(omicron(&home, &["setup", "--secret-key", &s.secret]));
    home
}

fn unique(name: &str) -> String {
    format!("{name}-{}", &Uuid::new_v4().simple().to_string()[..8])
}

#[test]
fn trust_marks_one_folder_for_claude_code_and_refuses_home() {
    let home = new_home();
    let claude = home.join("claude-config");
    std::fs::create_dir_all(&claude).unwrap();
    std::fs::write(claude.join(".claude.json"), r#"{"numStartups": 3, "projects": {}}"#).unwrap();
    let folder = home.join("app");
    std::fs::create_dir_all(&folder).unwrap();
    let run = |args: &[&str]| {
        let mut c = Command::new(env!("CARGO_BIN_EXE_omicron"));
        c.env("OMICRON_HOME", &home).env("CLAUDE_CONFIG_DIR", &claude).args(args).output().unwrap()
    };
    let o = run(&["trust", folder.to_str().unwrap()]);
    assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stderr));
    let c: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(claude.join(".claude.json")).unwrap()).unwrap();
    assert_eq!(c["numStartups"], 3);
    assert_eq!(c["projects"][folder.canonicalize().unwrap().to_str().unwrap()]["hasTrustDialogAccepted"], true);
    // Again: nothing changes.
    let before = std::fs::read_to_string(claude.join(".claude.json")).unwrap();
    assert!(run(&["trust", folder.to_str().unwrap()]).status.success());
    assert_eq!(std::fs::read_to_string(claude.join(".claude.json")).unwrap(), before);
    // Never the home folder, never a folder that isn't there.
    let o = run(&["trust", &std::env::var("HOME").unwrap()]);
    assert!(!o.status.success() && String::from_utf8_lossy(&o.stderr).contains("everything under it"));
    assert!(!run(&["trust", "/no/such/folder"]).status.success());
}

#[test]
fn help_lists_the_commands() {
    let out = ok(omicron(&new_home(), &["--help"]));
    for cmd in ["setup", "whoami", "machines", "people"] {
        assert!(out.contains(cmd), "{out}");
    }
}

#[test]
fn start_at_login_prints_the_service_file() {
    let home = new_home();
    let out = ok(omicron(&home, &["daemon", "start-at-login", "--print"]));
    // systemd (Linux) says NAME=value; launchd (macOS) says <key>NAME</key><string>value</string>.
    let home_set = out.contains(&format!("OMICRON_HOME={}", home.display()))
        || out.contains(&format!("<key>OMICRON_HOME</key><string>{}</string>", home.display()));
    assert!(home_set, "{out}");
    assert!(out.contains("OMICRON_DAEMON_SERVICE"), "{out}");
    assert!(out.contains(" daemon") || out.contains("<string>daemon</string>"), "{out}");
}

#[test]
fn start_at_login_needs_a_registered_machine() {
    let home = new_home();
    ok(omicron(&home, &["setup", "--url", "http://example.invalid", "--key", "pub"]));
    let err = fails(omicron(&home, &["daemon", "start-at-login"]));
    assert!(err.contains("register"), "{err}");
}

#[test]
fn setup_saves_settings_only_this_user_can_read() {
    let home = new_home();
    ok(omicron(&home, &["setup", "--url", "http://example.invalid", "--key", "pub"]));
    ok(omicron(&home, &["setup", "--secret-key", "shh"]));
    let saved: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(home.join("config.json")).unwrap()).unwrap();
    // A second setup adds to the first instead of replacing it.
    assert_eq!(saved["supabase_url"], "http://example.invalid");
    assert_eq!(saved["supabase_key"], "pub");
    assert_eq!(saved["supabase_secret_key"], "shh");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(home.join("config.json")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

#[test]
fn a_web_machine_can_give_browsers_another_supabase_address() {
    let home = new_home();
    ok(omicron(&home, &["setup", "--url", "http://127.0.0.1:8000", "--public-url", "https://box.example.ts.net:8450/"]));
    let saved: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(home.join("config.json")).unwrap()).unwrap();
    assert_eq!(saved["supabase_url"], "http://127.0.0.1:8000");
    assert_eq!(saved["public_supabase_url"], "https://box.example.ts.net:8450");
}

#[test]
fn setup_with_nothing_says_what_it_needs() {
    assert!(fails(omicron(&new_home(), &["setup"])).contains("--url"));
}

#[test]
fn commands_before_setup_say_to_run_setup() {
    let err = fails(omicron(&new_home(), &["machines", "register", "x"]));
    assert!(err.contains("omicron setup"), "{err}");
}

#[test]
fn check_in_before_registering_says_to_register() {
    let home = new_home();
    ok(omicron(&home, &["setup", "--url", "http://example.invalid", "--key", "pub"]));
    let err = fails(omicron(&home, &["machines", "check-in"]));
    assert!(err.contains("machines register"), "{err}");
}

#[test]
fn registering_needs_the_secret_key() {
    let s = supabase_or_skip!();
    let err = fails(omicron(&plain_machine(&s), &["machines", "register", &unique("laptop")]));
    assert!(err.contains("secret key"), "{err}");
}

#[test]
fn a_web_machine_registers_itself_and_checks_in() {
    let s = supabase_or_skip!();
    let home = web_machine(&s);
    let name = unique("mini");
    assert!(ok(omicron(&home, &["machines", "register", &name])).contains(&name));
    assert_eq!(ok(omicron(&home, &["machines", "check-in"])), format!("{name} checked in."));

    // Registering the same machine twice is refused.
    let err = fails(omicron(&home, &["machines", "register", &unique("again")]));
    assert!(err.contains("already registered"), "{err}");
}

#[test]
fn a_key_made_on_one_machine_sets_up_another() {
    let s = supabase_or_skip!();
    let name = unique("laptop");
    let key = ok(omicron(&web_machine(&s), &["machines", "register", &name, "--print"]));
    assert!(key.starts_with("omk_"), "{key}");

    // The other machine only has the publishable key.
    let laptop = plain_machine(&s);
    ok(omicron(&laptop, &["machines", "use-key", &key]));
    assert_eq!(ok(omicron(&laptop, &["machines", "check-in"])), format!("{name} checked in."));
}

#[test]
fn a_wrong_key_isnt_saved() {
    let s = supabase_or_skip!();
    let laptop = plain_machine(&s);
    let wrong = format!("omk_{}_{}", Uuid::new_v4().simple(), "0".repeat(64));
    let err = fails(omicron(&laptop, &["machines", "use-key", &wrong]));
    assert!(err.contains("doesn't work"), "{err}");
    let saved = std::fs::read_to_string(laptop.join("config.json")).unwrap();
    assert!(!saved.contains("machine_key"), "{saved}");
}

#[test]
fn a_switched_off_machine_says_so() {
    let s = supabase_or_skip!();
    let home = web_machine(&s);
    let name = unique("old");
    ok(omicron(&home, &["machines", "register", &name]));
    let admin = Supabase { url: s.url.clone(), key: s.key.clone(), secret_key: Some(s.secret.clone()) };
    admin.admin_request("PATCH", &format!("/rest/v1/machines?name=eq.{name}"), Some(serde_json::json!({ "active": false }))).unwrap();
    assert_eq!(ok(omicron(&home, &["machines", "check-in"])), format!("{name} is switched off."));
}

#[test]
fn linking_a_second_tailscale_identity() {
    let s = supabase_or_skip!();
    let admin = Supabase { url: s.url.clone(), key: s.key.clone(), secret_key: Some(s.secret.clone()) };
    let personal = TailscalePerson { login: format!("{}@example.com", unique("me")), display_name: "Me".into() };
    let me = admin.sign_in_person(&personal).unwrap();

    let work = format!("{}@example.com", unique("me-work"));
    ok(omicron(&web_machine(&s), &["people", "link", &me.user.id.to_string(), &work, "--name", "Me (work)"]));
    let again = admin.sign_in_person(&TailscalePerson { login: work, display_name: "Me (work)".into() }).unwrap();
    assert_eq!(again.user.id, me.user.id);
}

/// `omicron doctor` on a computer with only the settings in `home`: its own
/// home folder too (for Claude's settings and the start-at-login file), and
/// nobody signed in to Tailscale.
fn doctor(home: &Path) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_omicron"));
    for (k, _) in std::env::vars() {
        if k.starts_with("OMICRON_") || k.starts_with("CLAUDE_CODE_") || k == "CLAUDECODE" || k == "CLAUDE_CONFIG_DIR" {
            cmd.env_remove(k);
        }
    }
    let status = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/status-signed-out.json");
    cmd.env("OMICRON_HOME", home).env("HOME", home).env("OMICRON_TAILSCALE_STATUS", status).arg("doctor").output().unwrap()
}

#[test]
fn doctor_on_a_new_computer_says_to_run_setup() {
    let o = doctor(&new_home());
    assert!(!o.status.success());
    let out = stdout(&o);
    assert!(out.contains("fix   Settings") && out.contains("omicron setup"), "{out}");
    // What depends on the settings isn't checked yet.
    assert!(out.contains("--    Machine"), "{out}");
    // Nothing to do by hand for Claude: `omicron open` sets it up.
    assert!(out.contains("ok    Claude hooks and add-on") && out.contains("omicron open"), "{out}");
    assert!(stderr(&o).contains("things left to set up"), "{}", stderr(&o));
}

#[test]
fn doctor_says_what_a_new_machine_still_needs_and_when_its_done() {
    let s = supabase_or_skip!();
    let home = web_machine(&s);
    let out = stdout(&doctor(&home));
    assert!(out.contains("ok    Settings"), "{out}");
    assert!(out.contains("fix   Machine") && out.contains("machines register"), "{out}");

    let name = unique("doc");
    ok(omicron(&home, &["machines", "register", &name]));
    let out = stdout(&doctor(&home));
    assert!(out.contains(&format!("{name} can't use any Project yet")), "{out}");
    assert!(out.contains("fix   Daemon") && out.contains("fix   Start at login"), "{out}");
}
