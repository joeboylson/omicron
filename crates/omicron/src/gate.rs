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

/// Tell Omicron when this machine's gate closes (null when it's closed), for
/// pages to show. Display only: this machine still decides from its file.
pub fn report(supabase: &crate::supa::Supabase, session: &crate::supa::Session) -> Result<()> {
    let until = open_until().map(|t| t.to_rfc3339());
    supabase.request_as(session, "POST", "/rest/v1/rpc/machine_report_gate", Some(serde_json::json!({ "until": until })))?;
    Ok(())
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

/// Whose orders this machine takes, for one pass over its work: who it is,
/// whether its gate is open, and its owner, read from the database at most
/// once (and only when an order from elsewhere needs it).
pub struct Orders<'a> {
    board: &'a crate::board::Board,
    me: String,
    gate_open: bool,
    owner: std::cell::OnceCell<Option<String>>,
}

impl<'a> Orders<'a> {
    pub fn new(board: &'a crate::board::Board) -> Self {
        Orders { board, me: board.session.user.id.to_string(), gate_open: open_until().is_some(), owner: Default::default() }
    }

    /// With the owner already known (read earlier and kept).
    pub fn with_owner(board: &'a crate::board::Board, owner: Option<String>) -> Self {
        let o = Self::new(board);
        let _ = o.owner.set(owner);
        o
    }

    /// Whether the gate was open when these were read.
    pub fn gate_open(&self) -> bool {
        self.gate_open
    }

    fn owner(&self) -> Result<Option<&str>> {
        if let Some(o) = self.owner.get() {
            return Ok(o.as_deref());
        }
        let o = self.board.machine_owner()?;
        Ok(self.owner.get_or_init(|| o).as_deref())
    }

    /// Why this machine won't take an order from `who` (the login that gave
    /// it), if it won't, naming the machine as `machine`.
    pub fn refusal(&self, who: Option<&str>, machine: &str) -> Result<Option<String>> {
        if who == Some(self.me.as_str()) {
            return Ok(None);
        }
        Ok(decide(&self.me, self.owner()?, who, self.gate_open, machine))
    }

    /// Whether it takes an order from `who`. With the gate closed only its
    /// own orders go, so the owner isn't read.
    pub fn takes(&self, who: Option<&str>) -> Result<bool> {
        if who == Some(self.me.as_str()) {
            return Ok(true);
        }
        if !self.gate_open {
            return Ok(false);
        }
        Ok(self.refusal(who, "")?.is_none())
    }
}

/// Why this machine (signed in as `board`) won't take an order from `who`,
/// if it won't: `Orders` for a single order.
pub fn refusal(board: &crate::board::Board, machine: &str, who: Option<&str>) -> Result<Option<String>> {
    Orders::new(board).refusal(who, machine)
}

/// The order rule itself, with nothing read: `me` is this machine, `owner`
/// its owner (if it has one), `who` the login that gave the order. `None`
/// when it goes through; otherwise why not, in words.
pub fn decide(me: &str, owner: Option<&str>, who: Option<&str>, gate_open: bool, machine: &str) -> Option<String> {
    if who == Some(me) {
        return None;
    }
    if owner.is_none() || who != owner {
        let owner = if owner.is_none() { "it has no owner yet (`omicron machines owner` on it)" } else { "this came from someone else" };
        return Some(format!("{machine} only takes orders from its owner, and {owner}."));
    }
    if !gate_open {
        return Some(format!(
            "{machine}'s gate is closed, so it takes no work from elsewhere. Open it on {machine} with `omicron gate open --until 17:00`."
        ));
    }
    None
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
    fn the_order_rule() {
        let d = |who: Option<&str>, owner: Option<&str>, open: bool| decide("mac", owner, who, open, "atlas");
        // Its own orders always.
        assert_eq!(d(Some("mac"), None, false), None);
        // The owner's, only with the gate open.
        assert_eq!(d(Some("joe"), Some("joe"), true), None);
        assert!(d(Some("joe"), Some("joe"), false).unwrap().contains("gate is closed"));
        // Anyone else never, gate open or not; nobody's, with no owner.
        assert!(d(Some("sam"), Some("joe"), true).unwrap().contains("someone else"));
        assert!(d(Some("joe"), None, true).unwrap().contains("no owner yet"));
        assert!(d(None, Some("joe"), true).is_some());
    }

    #[test]
    fn times_are_read_the_usual_ways() {
        assert_eq!(parse_time("17:00").unwrap(), NaiveTime::from_hms_opt(17, 0, 0).unwrap());
        assert_eq!(parse_time("5pm").unwrap(), NaiveTime::from_hms_opt(17, 0, 0).unwrap());
        assert_eq!(parse_time("5:30 PM").unwrap(), NaiveTime::from_hms_opt(17, 30, 0).unwrap());
        assert!(parse_time("later").is_err());
    }
}
