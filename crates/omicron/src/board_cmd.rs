//! Signing in for the board commands (projects_cmd, tasks_cmd, people and
//! machines): as the person using this computer, or as this machine.

use anyhow::{Context, Result};
use omicron::board::Board;
use omicron::config::Config;
use omicron::identity;

/// Sign in for board commands.
///
/// As a person when this machine can (it has the secret key and Tailscale
/// says who owns it), otherwise as the machine. `as_machine` (or
/// `OMICRON_AS=machine`) forces the machine, which is how Claude sessions act.
pub fn sign_in(as_machine: bool) -> Result<Board> {
    let config = Config::load()?;
    let supabase = config.supabase()?;
    let session = if !acts_as_machine(as_machine)? {
        let me = identity::local_person().context("couldn't tell who you are. Use --as-machine to act as this machine.")?;
        kept_login(&format!("person {} {}", supabase.url, me.login), || supabase.sign_in_person(&me))?
    } else {
        let key = config.machine_key()?;
        kept_login(&format!("machine {} {}", supabase.url, key.machine_id), || supabase.sign_in_machine(&key))?
    };
    Ok(Board::signed_in(&supabase, &session))
}

/// A login is good for an hour; each command used to make a new one, and
/// Supabase limits how many logins can be made in a few minutes. So the
/// last one is kept (in Omicron's own folder, readable only by this user,
/// beside the machine's key) and used again until shortly before it runs out.
fn kept_login(who: &str, sign_in: impl FnOnce() -> Result<omicron::supa::Session>) -> Result<omicron::supa::Session> {
    use serde_json::json;
    let file = omicron::config::home()?.join("login.json");
    let now = chrono::Utc::now().timestamp();
    if let Ok(text) = std::fs::read_to_string(&file) {
        if let Ok(kept) = serde_json::from_str::<serde_json::Value>(&text) {
            if kept["who"] == who && kept["until"].as_i64().is_some_and(|u| u > now + 120) {
                if let Ok(session) = serde_json::from_value(kept["session"].clone()) {
                    return Ok(session);
                }
            }
        }
    }
    let session = sign_in()?;
    let until = now + session.expires_in as i64;
    let saved = json!({ "who": who, "until": until, "session": session });
    // Written to a copy and swapped in, readable only by this user.
    let tmp = file.with_extension(format!("json.{}", std::process::id()));
    if std::fs::write(&tmp, saved.to_string()).is_ok() {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        let _ = std::fs::rename(&tmp, &file);
    }
    Ok(session)
}

/// Whether `sign_in` signs in as this machine rather than as you.
pub fn acts_as_machine(as_machine: bool) -> Result<bool> {
    let config = Config::load()?;
    Ok(as_machine
        || std::env::var("OMICRON_AS").is_ok_and(|v| v == "machine")
        || config.supabase()?.secret_key.is_none())
}
