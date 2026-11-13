//! The gate: whether this computer takes orders from anywhere else (work
//! handed over from the web page or another machine). Closed unless opened
//! here, on this computer, and it closes by itself, never more than 24
//! hours after it opened. It lives in a file on this computer, not the
//! database, so nobody can open it from outside by changing a row
//! (ref/BRAINSTORM.md, "The gate").

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Duration, Local, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// The longest a gate stays open.
pub const LONGEST: Duration = Duration::hours(24);

#[derive(Serialize, Deserialize)]
struct Gate {
    until: DateTime<Local>,
}

fn path() -> Result<PathBuf> {
    Ok(crate::config::home()?.join("gate.json"))
}

/// When the gate closes, if it's open now.
pub fn open_until() -> Option<DateTime<Local>> {
    let text = std::fs::read_to_string(path().ok()?).ok()?;
    let gate: Gate = serde_json::from_str(&text).ok()?;
    // Never trust a file that says longer than the longest (written by hand).
    (gate.until > Local::now() && gate.until <= Local::now() + LONGEST).then_some(gate.until)
}

/// Open the gate until a time today (or tomorrow, if that time has passed),
/// like "17:00" or "5:30pm". Returns when it closes.
pub fn open(until: &str) -> Result<DateTime<Local>> {
    let now = Local::now();
    let at = parse_time(until)?;
    let mut when = Local
        .from_local_datetime(&now.date_naive().and_time(at))
        .earliest()
        .context("that time doesn't exist today (a clock change)")?;
    if when <= now {
        when += Duration::days(1);
    }
    if when > now + LONGEST {
        bail!("a gate stays open at most 24 hours");
    }
    let file = path()?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&file, serde_json::to_string(&Gate { until: when })?)?;
    Ok(when)
}

pub fn close() -> Result<()> {
    match std::fs::remove_file(path()?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

fn parse_time(text: &str) -> Result<NaiveTime> {
    let mut t = text.trim().to_lowercase().replace(' ', "");
    // "5pm" and "17" have no minutes, which a time needs.
    if !t.contains(':') {
        let at = t.find(|c: char| !c.is_ascii_digit()).unwrap_or(t.len());
        t.insert_str(at, ":00");
    }
    for format in ["%H:%M", "%I:%M%p"] {
        if let Ok(time) = NaiveTime::parse_from_str(&t, format) {
            return Ok(time);
        }
    }
    bail!("couldn't read {text:?} as a time: use one like 17:00 or 5pm")
}

/// Why this machine (signed in as `board`) won't take an order from `who`
/// (the login that gave it), if it won't. Its own orders always go
/// through; otherwise only its owner's, and only while the gate is open.
pub fn refusal(board: &crate::board::Board, machine: &str, who: Option<&str>) -> Result<Option<String>> {
    let me = board.session.user.id.to_string();
    if who == Some(me.as_str()) {
        return Ok(None);
    }
    let owner = board.machine_owner()?;
    if owner.is_none() || who != owner.as_deref() {
        let owner = if owner.is_none() { "it has no owner yet (`omicron machines owner` on it)" } else { "this came from someone else" };
        return Ok(Some(format!("{machine} only takes orders from its owner, and {owner}.")));
    }
    if open_until().is_none() {
        return Ok(Some(format!(
            "{machine}'s gate is closed, so it takes no work from elsewhere. Open it on {machine} with `omicron gate open --until 17:00`."
        )));
    }
    Ok(None)
}

/// Words for whether the gate is open.
pub fn status() -> String {
    match open_until() {
        Some(until) => format!("Open until {}: this computer takes work from elsewhere.", until.format("%-I:%M %p %a")),
        None => "Closed: this computer takes no work from elsewhere. Open it with `omicron gate open --until 17:00`.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_are_read_the_usual_ways() {
        assert_eq!(parse_time("17:00").unwrap(), NaiveTime::from_hms_opt(17, 0, 0).unwrap());
        assert_eq!(parse_time("5pm").unwrap(), NaiveTime::from_hms_opt(17, 0, 0).unwrap());
        assert_eq!(parse_time("5:30 PM").unwrap(), NaiveTime::from_hms_opt(17, 30, 0).unwrap());
        assert!(parse_time("later").is_err());
    }
}
