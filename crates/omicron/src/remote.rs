//! Remote control tokens (ref/BRAINSTORM.md, "Remote control with a
//! short-lived token"): this computer makes a token, shown once, that lets a
//! browser control it from its page for a while (its Dev side: sessions,
//! terminals, Dispatch), like its owner visiting from it, even when the
//! visit's Tailscale login can't be checked. Only while that browser is
//! signed in as the person who made it, and only until it runs out: 8 hours
//! unless asked otherwise, never more than 30 days.
//!
//! Like the gate, tokens live in a file on this computer, not the database,
//! so nobody can make one from outside. Only a hash of each is kept.

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/// How long a token lasts unless asked otherwise.
pub const USUAL: Duration = Duration::hours(8);
/// The longest a token lasts.
pub const LONGEST: Duration = Duration::days(30);
/// What every token starts with, so it's easy to tell apart.
const PREFIX: &str = "omr_";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Token {
    /// A short name for it, to take it back by.
    pub id: String,
    /// sha256 of the token itself, in hex.
    hash: String,
    /// The person who made it: only they can use it.
    pub person: String,
    pub made: DateTime<Utc>,
    pub until: DateTime<Utc>,
}

fn path() -> Result<PathBuf> {
    Ok(crate::config::home()?.join("remote-tokens.json"))
}

fn hash(token: &str) -> String {
    Sha256::digest(token.trim().as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

fn random_hex(bytes: usize) -> Result<String> {
    let mut b = vec![0u8; bytes];
    getrandom::getrandom(&mut b).map_err(|e| anyhow::anyhow!("couldn't make a random token: {e}"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}

/// The tokens kept here, still good or not.
pub fn all() -> Result<Vec<Token>> {
    all_in(&path()?)
}

fn all_in(file: &std::path::Path) -> Result<Vec<Token>> {
    match std::fs::read_to_string(file) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e.into()),
    }
}

fn save(file: &std::path::Path, tokens: &[Token]) -> Result<()> {
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let tmp = file.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(tokens)?)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(tmp, file)?;
    Ok(())
}

/// Make a token for `person`, lasting `last` (at most 30 days). Returns the
/// token itself (shown once, never kept) and its record. Ones that have run
/// out are cleared away.
pub fn make(person: &str, last: Duration) -> Result<(String, Token)> {
    make_in(&path()?, person, last)
}

fn make_in(file: &std::path::Path, person: &str, last: Duration) -> Result<(String, Token)> {
    if last <= Duration::zero() {
        bail!("a token has to last a while");
    }
    if last > LONGEST {
        bail!("a token lasts at most 30 days");
    }
    let token = format!("{PREFIX}{}", random_hex(32)?);
    let now = Utc::now();
    let record = Token { id: random_hex(3)?, hash: hash(&token), person: person.to_string(), made: now, until: now + last };
    let mut tokens: Vec<Token> = all_in(file)?.into_iter().filter(|t| t.until > now).collect();
    tokens.push(record.clone());
    save(file, &tokens)?;
    Ok((token, record))
}

/// Whether `token` lets `person` in now.
pub fn lets_in(token: &str, person: &str) -> bool {
    path().is_ok_and(|f| lets_in_file(&f, token, person))
}

fn lets_in_file(file: &std::path::Path, token: &str, person: &str) -> bool {
    let token = token.trim();
    if !token.starts_with(PREFIX) {
        return false;
    }
    let h = hash(token);
    let now = Utc::now();
    all_in(file).unwrap_or_default().iter().any(|t| t.hash == h && t.person == person && t.until > now && t.until <= t.made + LONGEST)
}

/// Take a token back by its id, or all of them. How many went.
pub fn revoke(id: Option<&str>) -> Result<usize> {
    revoke_in(&path()?, id)
}

fn revoke_in(file: &std::path::Path, id: Option<&str>) -> Result<usize> {
    let tokens = all_in(file)?;
    let keep: Vec<Token> = match id {
        Some(id) => tokens.iter().filter(|t| t.id != id).cloned().collect(),
        None => Vec::new(),
    };
    let gone = tokens.len() - keep.len();
    if id.is_some() && gone == 0 {
        bail!("there's no token {} here (`omicron remote list`)", id.unwrap_or(""));
    }
    save(file, &keep)?;
    Ok(gone)
}

/// Read a length like 8h, 3d or 90m.
pub fn parse_last(text: &str) -> Result<Duration> {
    let t = text.trim();
    let (n, unit) = t.split_at(t.find(|c: char| !c.is_ascii_digit()).context("give a length like 8h, 3d or 90m")?);
    let n: i64 = n.parse().context("give a length like 8h, 3d or 90m")?;
    Ok(match unit {
        "m" => Duration::minutes(n),
        "h" => Duration::hours(n),
        "d" => Duration::days(n),
        _ => bail!("give a length like 8h, 3d or 90m"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_lets_only_its_person_in_until_it_runs_out_or_is_taken_back() {
        // A file of its own (not OMICRON_HOME: other tests read that at the same time).
        let dir = std::env::temp_dir().join(format!("omicron-remote-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("remote-tokens.json");
        let ok = |t: &str, who: &str| lets_in_file(&file, t, who);
        let (token, _) = make_in(&file, "joe", USUAL).unwrap();
        assert!(token.starts_with("omr_") && token.len() == 4 + 64);
        assert!(ok(&token, "joe"));
        assert!(ok(&format!(" {token}\n"), "joe"), "pasted with spaces");
        assert!(!ok(&token, "sam"), "someone else signed in");
        assert!(!ok("omr_0000", "joe"));
        // Only a hash is kept.
        assert!(!std::fs::read_to_string(&file).unwrap().contains(&token));
        // Run out: no longer.
        let mut tokens = all_in(&file).unwrap();
        tokens[0].until = Utc::now() - Duration::minutes(1);
        save(&file, &tokens).unwrap();
        assert!(!ok(&token, "joe"));
        // Taken back.
        let (again, rec) = make_in(&file, "joe", Duration::hours(1)).unwrap();
        assert!(ok(&again, "joe"));
        assert_eq!(revoke_in(&file, Some(&rec.id)).unwrap(), 1);
        assert!(!ok(&again, "joe"));
        assert!(revoke_in(&file, Some("nope")).is_err());
        // Too long, or nothing.
        assert!(make_in(&file, "joe", Duration::days(31)).is_err());
        assert!(make_in(&file, "joe", Duration::zero()).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn lengths() {
        assert_eq!(parse_last("8h").unwrap(), Duration::hours(8));
        assert_eq!(parse_last("30d").unwrap(), Duration::days(30));
        assert_eq!(parse_last("90m").unwrap(), Duration::minutes(90));
        assert!(parse_last("8").is_err() && parse_last("h").is_err() && parse_last("2w").is_err());
    }
}
