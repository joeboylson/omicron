//! Claude accounts on this machine: save the login Claude Code has now
//! under a name, and swap saved logins in. Rewritten from janus.
//!
//! Claude Code keeps its login in two places:
//! - the tokens (`claudeAiOauth`): on a Mac in the Keychain item
//!   "Claude Code-credentials" (or `~/.claude/.credentials.json` while that
//!   item doesn't exist); on Linux in that file;
//! - who it is (`oauthAccount`) in `~/.claude.json`.
//!
//! Only those two entries are ever changed; everything else in them (MCP
//! logins, settings) is left alone. Saved logins live in
//! `~/.omicron/accounts/<name>.json`, readable only by this user, and never
//! leave the machine.
//!
//! Tokens are renewed as they're used, so before a switch the account in
//! use is saved again, or its saved copy would go stale.

use anyhow::{bail, Context, Result};
use serde_json::{Map, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const KEYCHAIN_SERVICE: &str = "Claude Code-credentials";

/// The folder Claude Code's files are in (the user's home).
/// `OMICRON_CLAUDE_HOME` moves it, for tests.
fn claude_home() -> Result<PathBuf> {
    if let Some(h) = std::env::var_os("OMICRON_CLAUDE_HOME").filter(|h| !h.is_empty()) {
        return Ok(PathBuf::from(h));
    }
    Ok(PathBuf::from(std::env::var_os("HOME").context("HOME isn't set")?))
}

fn credentials_path() -> Result<PathBuf> {
    Ok(claude_home()?.join(".claude/.credentials.json"))
}

fn config_path() -> Result<PathBuf> {
    Ok(claude_home()?.join(".claude.json"))
}

fn accounts_dir() -> Result<PathBuf> {
    Ok(crate::config::home()?.join("accounts"))
}

/// The Keychain is used on a Mac, unless `OMICRON_KEYCHAIN=off` (tests, or a
/// Mac that keeps Claude Code's login in the file).
fn use_keychain() -> bool {
    cfg!(target_os = "macos") && std::env::var("OMICRON_KEYCHAIN").map_or(true, |v| v != "off")
}

fn read_object(path: &Path) -> Result<Map<String, Value>> {
    match std::fs::read_to_string(path) {
        Ok(text) if text.trim().is_empty() => Ok(Map::new()),
        Ok(text) => match serde_json::from_str(&text) {
            Ok(Value::Object(m)) => Ok(m),
            _ => bail!("{} isn't the JSON Claude Code writes", path.display()),
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Map::new()),
        Err(e) => Err(e).with_context(|| format!("couldn't read {}", path.display())),
    }
}

/// Write JSON by writing a new file and renaming it over the old one,
/// keeping the old file's permissions (or `mode` for a new file).
fn write_object(path: &Path, data: &Map<String, Value>, mode: u32) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let mode = std::fs::metadata(path).map(|m| m.permissions().mode() & 0o777).unwrap_or(mode);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = path.with_extension(format!("omicron-{}", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string_pretty(&Value::Object(data.clone()))? + "\n")?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(mode))?;
    std::fs::rename(&tmp, path).with_context(|| format!("couldn't save {}", path.display()))?;
    Ok(())
}

// ---- the Keychain (macOS) ----------------------------------------------------

fn keychain_account() -> String {
    std::env::var("USER").unwrap_or_default()
}

/// Run `security` with `input` on stdin (so secrets never show in `ps`).
fn security(args: &[&str], input: Option<&str>) -> Result<(i32, String)> {
    let mut child = Command::new("security")
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .context("couldn't run `security` for the Keychain")?;
    if let Some(input) = input {
        child.stdin.take().context("no stdin for security")?.write_all(input.as_bytes())?;
    }
    drop(child.stdin.take());
    let out = child.wait_with_output()?;
    Ok((out.status.code().unwrap_or(-1), String::from_utf8_lossy(&out.stdout).into_owned()))
}

fn read_keychain() -> Result<Option<Map<String, Value>>> {
    let (code, out) = security(&["find-generic-password", "-a", &keychain_account(), "-s", KEYCHAIN_SERVICE, "-w"], None)?;
    match code {
        0 => {}
        44 => return Ok(None), // no such item
        51 => bail!("the Keychain is locked. Unlock it, then try again."),
        c => bail!("reading the Keychain failed (security exited {c})"),
    }
    let text = out.trim();
    // `security -w` prints the value as text, or as hex if it isn't text.
    let text = if text.starts_with('{') {
        text.to_string()
    } else {
        let bytes: Option<Vec<u8>> = (0..text.len())
            .step_by(2)
            .map(|i| text.get(i..i + 2).and_then(|h| u8::from_str_radix(h, 16).ok()))
            .collect();
        String::from_utf8(bytes.context("the Keychain item isn't the JSON Claude Code saves")?)?
    };
    match serde_json::from_str(&text) {
        Ok(Value::Object(m)) => Ok(Some(m)),
        _ => bail!("the Keychain item {KEYCHAIN_SERVICE} isn't the JSON Claude Code saves"),
    }
}

fn write_keychain(doc: &Map<String, Value>) -> Result<()> {
    let hex: String = serde_json::to_string(&Value::Object(doc.clone()))?.bytes().map(|b| format!("{b:02x}")).collect();
    // `security -i` reads commands from stdin; -X takes the value as hex.
    let line = format!("add-generic-password -U -a \"{}\" -s \"{KEYCHAIN_SERVICE}\" -X {hex}\n", keychain_account());
    let (code, _) = security(&["-i"], Some(&line))?;
    if code != 0 {
        bail!("saving to the Keychain failed (security exited {code}). Is it locked?");
    }
    Ok(())
}

// ---- Claude Code's login -------------------------------------------------------

/// Claude Code's whole credentials document, where Claude Code reads it.
fn read_credentials() -> Result<Map<String, Value>> {
    if use_keychain() {
        if let Some(doc) = read_keychain()? {
            return Ok(doc);
        }
    }
    read_object(&credentials_path()?)
}

fn write_credentials(doc: &Map<String, Value>) -> Result<()> {
    if use_keychain() {
        return write_keychain(doc);
    }
    write_object(&credentials_path()?, doc, 0o600)
}

/// A login: the tokens and who they belong to.
#[derive(Debug, Clone, PartialEq)]
pub struct Login {
    pub tokens: Value,
    pub account: Value,
}

impl Login {
    /// Claude's id for the account, to tell logins apart.
    pub fn account_id(&self) -> Option<&str> {
        self.account["accountUuid"].as_str()
    }

    pub fn email(&self) -> &str {
        self.account["emailAddress"].as_str().unwrap_or("")
    }
}

/// The login Claude Code has now, if it's logged in.
pub fn current() -> Result<Option<Login>> {
    let tokens = read_credentials()?.remove("claudeAiOauth");
    let account = read_object(&config_path()?)?.remove("oauthAccount");
    Ok(match (tokens, account) {
        (Some(tokens), Some(account)) if !tokens.is_null() && !account.is_null() => Some(Login { tokens, account }),
        _ => None,
    })
}

/// Make `login` the one Claude Code uses. Everything else stays.
fn put(login: &Login) -> Result<()> {
    let mut creds = read_credentials()?;
    creds.insert("claudeAiOauth".into(), login.tokens.clone());
    write_credentials(&creds)?;
    let path = config_path()?;
    let mut config = read_object(&path)?;
    config.insert("oauthAccount".into(), login.account.clone());
    write_object(&path, &config, 0o600)
}

// ---- saved accounts ---------------------------------------------------------

fn check_name(name: &str) -> Result<()> {
    if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        bail!("an account name is letters, numbers, - and _, like `work` or `personal`");
    }
    Ok(())
}

fn account_path(name: &str) -> Result<PathBuf> {
    check_name(name)?;
    Ok(accounts_dir()?.join(format!("{name}.json")))
}

#[derive(Debug, Clone, PartialEq)]
pub struct Saved {
    pub name: String,
    pub login: Login,
}

fn load(path: &Path) -> Result<Saved> {
    let doc = read_object(path)?;
    Ok(Saved {
        name: path.file_stem().unwrap_or_default().to_string_lossy().into_owned(),
        login: Login {
            tokens: doc.get("claudeAiOauth").cloned().unwrap_or(Value::Null),
            account: doc.get("oauthAccount").cloned().unwrap_or(Value::Null),
        },
    })
}

fn store(name: &str, login: &Login) -> Result<()> {
    let mut doc = Map::new();
    doc.insert("claudeAiOauth".into(), login.tokens.clone());
    doc.insert("oauthAccount".into(), login.account.clone());
    write_object(&account_path(name)?, &doc, 0o600)
}

/// Every saved account, by name.
pub fn saved() -> Result<Vec<Saved>> {
    let dir = accounts_dir()?;
    let mut all = Vec::new();
    match std::fs::read_dir(&dir) {
        Ok(entries) => {
            for e in entries {
                let path = e?.path();
                if path.extension().is_some_and(|x| x == "json") {
                    all.push(load(&path)?);
                }
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    all.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(all)
}

/// The saved account Claude Code is using now, if any.
pub fn in_use() -> Result<Option<String>> {
    let Some(now) = current()? else { return Ok(None) };
    Ok(saved()?.into_iter().find(|s| s.login.account_id().is_some() && s.login.account_id() == now.account_id()).map(|s| s.name))
}

/// Save the login Claude Code has now as `name`. The same account can't be
/// saved under two names.
pub fn add(name: &str) -> Result<Login> {
    let now = current()?.context("Claude Code isn't logged in. Log in with /login, then try again.")?;
    if let Some(other) = saved()?.into_iter().find(|s| s.name != name && s.login.account_id() == now.account_id()) {
        bail!("this login ({}) is already saved as {}", now.email(), other.name);
    }
    store(name, &now)?;
    Ok(now)
}

/// Re-save the account in use, so its saved copy has the newest tokens.
pub fn refresh() -> Result<()> {
    if let (Some(name), Some(now)) = (in_use()?, current()?) {
        store(&name, &now)?;
    }
    Ok(())
}

/// Switch Claude Code to the saved account `name`.
pub fn switch(name: &str) -> Result<Saved> {
    let path = account_path(name)?;
    if !path.exists() {
        bail!("there's no saved account called {name}. Save one with `omicron accounts add {name}`.");
    }
    refresh()?;
    let target = load(&path)?;
    put(&target.login)?;
    Ok(target)
}

pub fn remove(name: &str) -> Result<()> {
    let path = account_path(name)?;
    std::fs::remove_file(&path).with_context(|| format!("there's no saved account called {name}"))
}

// ---- usage ------------------------------------------------------------------

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Where an account's usage comes from: the endpoint Claude Code's /usage
/// reads. Not publicly documented, so it may change. `OMICRON_USAGE_URL`
/// moves it, for tests.
fn usage_url() -> String {
    std::env::var("OMICRON_USAGE_URL").unwrap_or_else(|_| "https://api.anthropic.com/api/oauth/usage".into())
}

/// One limit: how much is used, and when it starts again.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Window {
    pub percent: f64,
    pub resets_at: Option<DateTime<Utc>>,
}

impl Window {
    /// As it stands at `now`: a window past its reset time is empty again.
    pub fn at(self, now: DateTime<Utc>) -> Window {
        match self.resets_at {
            Some(t) if t <= now => Window { percent: 0.0, resets_at: None },
            _ => self,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Usage {
    pub five_hour: Option<Window>,
    pub weekly: Option<Window>,
}

fn window(v: &Value) -> Option<Window> {
    Some(Window {
        percent: v.get("utilization")?.as_f64()?,
        resets_at: v.get("resets_at").and_then(Value::as_str).and_then(|s| DateTime::parse_from_rfc3339(s).ok()).map(|t| t.with_timezone(&Utc)),
    })
}

pub fn parse_usage(v: &Value) -> Usage {
    Usage { five_hour: v.get("five_hour").and_then(window), weekly: v.get("seven_day").and_then(window) }
}

fn usage_cache_path() -> Result<PathBuf> {
    Ok(accounts_dir()?.join("usage.cache"))
}

/// The last numbers seen for each account.
pub fn last_usage(name: &str) -> Option<Usage> {
    let doc = read_object(&usage_cache_path().ok()?).ok()?;
    doc.get(name).map(parse_usage)
}

/// A token that works for `name` now, if there is one. For the account in
/// use that's Claude Code's own (it renews them); otherwise the saved one.
/// Omicron never renews a token itself: that would replace Claude Code's.
fn usable_token(name: &str) -> Result<Option<String>> {
    let login = if in_use()?.as_deref() == Some(name) {
        current()?
    } else {
        saved()?.into_iter().find(|s| s.name == name).map(|s| s.login)
    };
    let Some(login) = login else { return Ok(None) };
    let expires_ms = login.tokens["expiresAt"].as_i64().unwrap_or(i64::MAX);
    if expires_ms < Utc::now().timestamp_millis() + 60_000 {
        return Ok(None);
    }
    Ok(login.tokens["accessToken"].as_str().map(String::from))
}

/// Fresh numbers for `name` when its token works, otherwise the last ones
/// seen. The note says why fresh numbers weren't possible.
pub fn check_usage(name: &str) -> (Option<Usage>, Option<String>) {
    let fresh = (|| -> Result<bool> {
        let Some(token) = usable_token(name)? else { return Ok(false) };
        let answer: Value = ureq::get(&usage_url())
            .set("Authorization", &format!("Bearer {token}"))
            .set("anthropic-beta", "oauth-2025-04-20")
            .timeout(std::time::Duration::from_secs(15))
            .call()
            .map_err(|e| anyhow::anyhow!("asking for usage failed: {e}"))?
            .into_json()?;
        let path = usage_cache_path()?;
        let mut cache = read_object(&path)?;
        let keep = |w: Option<&Value>| w.map(|w| serde_json::json!({ "utilization": w.get("utilization"), "resets_at": w.get("resets_at") }));
        cache.insert(name.into(), serde_json::json!({ "five_hour": keep(answer.get("five_hour")), "seven_day": keep(answer.get("seven_day")) }));
        write_object(&path, &cache, 0o600)?;
        Ok(true)
    })();
    let note = match fresh {
        Ok(true) => None,
        Ok(false) => Some("no working token; showing the last numbers seen".into()),
        Err(e) => Some(format!("{e:#}; showing the last numbers seen")),
    };
    (last_usage(name), note)
}

// ---- switching on its own ---------------------------------------------------

/// The rules for switching on their own, in `~/.omicron/accounts/auto.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Auto {
    pub primary: Option<String>,
    pub secondary: Option<String>,
    /// Switch away when the primary's 5-hour use reaches this %.
    pub five_hour: Option<f64>,
    /// Switch away when the primary's weekly use reaches this %.
    pub weekly: Option<f64>,
    /// An account picked by hand: nothing switches until `resume`.
    #[serde(default)]
    pub held: Option<String>,
    /// On the secondary because the primary was at a limit.
    #[serde(default)]
    pub away: bool,
}

impl Auto {
    pub fn on(&self) -> bool {
        self.primary.is_some() && self.secondary.is_some() && (self.five_hour.is_some() || self.weekly.is_some())
    }

    fn path() -> Result<PathBuf> {
        Ok(accounts_dir()?.join("auto.json"))
    }

    pub fn load() -> Result<Auto> {
        let doc = read_object(&Self::path()?)?;
        Ok(serde_json::from_value(Value::Object(doc)).unwrap_or_default())
    }

    pub fn save(&self) -> Result<()> {
        let Value::Object(doc) = serde_json::to_value(self)? else { unreachable!() };
        write_object(&Self::path()?, &doc, 0o600)
    }

    /// Why an account can't be used now ("5-hour limit at 93%"), if it can't.
    pub fn blocked(&self, usage: Option<&Usage>, now: DateTime<Utc>) -> Option<String> {
        let usage = usage?;
        [(self.five_hour, usage.five_hour, "5-hour"), (self.weekly, usage.weekly, "weekly")]
            .into_iter()
            .filter_map(|(at, w, label)| {
                let w = w?.at(now);
                (w.percent >= at?).then(|| format!("{label} limit at {}%", w.percent.round()))
            })
            .next()
    }

    /// Where to switch, and why, given the account in use and both
    /// accounts' numbers.
    pub fn decide(&self, current: Option<&str>, primary: Option<&Usage>, secondary: Option<&Usage>, now: DateTime<Utc>) -> Option<(String, String)> {
        if !self.on() || self.held.is_some() {
            return None;
        }
        let (p, s) = (self.primary.as_deref()?, self.secondary.as_deref()?);
        if current == Some(p) {
            let why = self.blocked(primary, now)?;
            if self.blocked(secondary, now).is_none() {
                return Some((s.into(), why));
            }
        } else if current == Some(s) && self.away && self.blocked(primary, now).is_none() {
            return Some((p.into(), format!("{p} is free again")));
        }
        None
    }
}

/// One check: look at both accounts and switch if the rules say so.
/// Returns what happened, for the log, when anything did.
pub fn auto_tick() -> Result<Option<String>> {
    let mut auto = Auto::load()?;
    if !auto.on() || auto.held.is_some() {
        return Ok(None);
    }
    let (p, s) = (auto.primary.clone().unwrap(), auto.secondary.clone().unwrap());
    let (pu, pnote) = check_usage(&p);
    let (su, _) = check_usage(&s);
    let current = in_use()?;
    let Some((to, why)) = auto.decide(current.as_deref(), pu.as_ref(), su.as_ref(), Utc::now()) else {
        return Ok(pnote.map(|n| format!("{p}: {n}")));
    };
    switch(&to)?;
    auto.away = to == s;
    auto.save()?;
    let message = format!("Switched Claude Code to {to}: {why}.");
    notify(&message);
    Ok(Some(message))
}

/// A desktop notification, best effort.
fn notify(message: &str) {
    let _ = if cfg!(target_os = "macos") {
        Command::new("osascript")
            .args(["-e", &format!("display notification \"{}\" with title \"Omicron\"", message.replace('"', "'"))])
            .output()
    } else {
        Command::new("notify-send").args(["Omicron", message]).output()
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn used(five: f64, five_resets_h: i64, weekly: f64) -> Usage {
        let now = Utc::now();
        Usage {
            five_hour: Some(Window { percent: five, resets_at: Some(now + Duration::hours(five_resets_h)) }),
            weekly: Some(Window { percent: weekly, resets_at: Some(now + Duration::days(3)) }),
        }
    }

    fn rules() -> Auto {
        Auto { primary: Some("personal".into()), secondary: Some("work".into()), five_hour: Some(90.0), weekly: Some(99.0), ..Auto::default() }
    }

    #[test]
    fn leaves_the_primary_at_a_limit_if_the_secondary_is_free() {
        let now = Utc::now();
        let a = rules();
        assert_eq!(
            a.decide(Some("personal"), Some(&used(93.0, 2, 40.0)), Some(&used(10.0, 2, 10.0)), now),
            Some(("work".into(), "5-hour limit at 93%".into()))
        );
        assert_eq!(a.decide(Some("personal"), Some(&used(50.0, 2, 40.0)), Some(&used(10.0, 2, 10.0)), now), None);
        // Both at a limit: stay.
        assert_eq!(a.decide(Some("personal"), Some(&used(93.0, 2, 40.0)), Some(&used(95.0, 2, 10.0)), now), None);
    }

    #[test]
    fn comes_back_once_the_primarys_limit_resets_but_only_if_it_left_on_its_own() {
        let now = Utc::now();
        let mut a = rules();
        a.away = true;
        // The 5-hour window has reset (its time has passed).
        assert_eq!(
            a.decide(Some("work"), Some(&used(93.0, -1, 40.0)), Some(&used(10.0, 2, 10.0)), now),
            Some(("personal".into(), "personal is free again".into()))
        );
        assert_eq!(a.decide(Some("work"), Some(&used(93.0, 1, 40.0)), None, now), None);
        a.away = false;
        assert_eq!(a.decide(Some("work"), Some(&used(10.0, 1, 40.0)), None, now), None);
    }

    #[test]
    fn a_held_account_stays() {
        let mut a = rules();
        a.held = Some("personal".into());
        assert_eq!(a.decide(Some("personal"), Some(&used(99.0, 2, 99.0)), Some(&used(1.0, 2, 1.0)), Utc::now()), None);
    }
}
