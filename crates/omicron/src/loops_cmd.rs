//! Loops: Omicron keeps a session's loop going. A loop sends a session a
//! prompt every so often, so the session doesn't have to remember to
//! wake itself up (which it can forget, or be stopped from doing by a usage
//! limit or a long conversation being condensed).
//!
//! The session's machine runs it (`Runner`, in the daemon). A run waits
//! while the session is busy (between a prompt going in and its turn
//! ending, as the hooks mark it), so runs never stack up, and while the
//! session isn't open in a window (`omicron open`), so they don't pile up
//! for when it is.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use chrono::{DateTime, Local, NaiveDateTime, NaiveTime, TimeZone, Utc};
use clap::Subcommand;
use omicron::board::{Board, Loop};
use omicron::supa::{MachineKey, Supabase};
use omicron::windows::{this_window, Windows};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Subcommand)]
pub enum Loops {
    /// Start a loop: type a prompt into a session every so often. Inside a
    /// session, it's for that session unless --session says otherwise.
    /// Example: omicron loops start "Keep going with the next task" --every 10m --times 20
    Start {
        /// What to type in each time (one line)
        prompt: String,
        /// How often, like 90s, 10m, 2h or 1h30m (at least a minute)
        #[arg(long)]
        every: String,
        /// Stop after this time: 18:30, "2026-11-12 08:00", +8h, or a full timestamp
        #[arg(long, conflicts_with = "times")]
        until: Option<String>,
        /// Stop after this many runs
        #[arg(long)]
        times: Option<i64>,
        /// The session (by name; needs --project)
        #[arg(long, requires = "project")]
        session: Option<String>,
        #[arg(long)]
        project: Option<String>,
    },
    /// The loops that are running (all you can see, or one Project's)
    List {
        #[arg(long)]
        project: Option<String>,
    },
    /// Stop a session's loop (this session's, inside one)
    Stop {
        #[arg(long, requires = "project")]
        session: Option<String>,
        #[arg(long)]
        project: Option<String>,
    },
}

pub fn loops(cmd: Loops, as_machine: bool) -> Result<()> {
    match cmd {
        Loops::Start { prompt, every, until, times, session, project } => {
            let every = parse_every(&every)?;
            let until = until.map(|u| parse_until(&u, Local::now())).transpose()?;
            if times == Some(0) {
                bail!("--times is at least 1");
            }
            let (board, id, name) = target(session, project, as_machine)?;
            let one_line = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
            let l = board.start_loop(&id, &one_line, every, until.map(|u| u.to_rfc3339()).as_deref(), times)?;
            println!("Started a loop for {name}: every {}, {}.", say_every(every), say_end(&l));
            println!("First run at {}. Stop it with `omicron loops stop`.", say_time(&l.next_run_at));
        }
        Loops::List { project } => {
            let board = sign_in(as_machine)?;
            let project = project.map(|p| board.project(&p)).transpose()?;
            let sessions = board.sessions(project.as_ref())?;
            let mut any = false;
            for l in board.loops(None)? {
                let Some(s) = sessions.iter().find(|s| s.id == l.session_id) else { continue };
                any = true;
                println!(
                    "{}\t{}\tevery {}\t{}\tnext {}\t{}{}",
                    s.name,
                    s.project,
                    say_every(l.every_seconds),
                    say_end(&l),
                    say_time(&l.next_run_at),
                    l.prompt,
                    l.note.as_ref().map(|n| format!("\t({n})")).unwrap_or_default()
                );
            }
            if !any {
                println!("No loops are running.");
            }
        }
        Loops::Stop { session, project } => {
            let (board, id, name) = target(session, project, as_machine)?;
            let running = board.loops(Some(&id))?;
            let Some(l) = running.first() else {
                println!("{name} has no loop running.");
                return Ok(());
            };
            board.stop_loop(&l.id)?;
            println!("Stopped {name}'s loop (it ran {} {}).", l.runs, if l.runs == 1 { "time" } else { "times" });
        }
    }
    Ok(())
}

/// The session a command is about: named, or the one it runs in.
fn target(session: Option<String>, project: Option<String>, as_machine: bool) -> Result<(Board, String, String)> {
    match (session, project) {
        (Some(name), Some(project)) => {
            let board = sign_in(as_machine)?;
            let p = board.project(&project)?;
            let s = board.session(&p, &name)?;
            Ok((board, s.id, s.name))
        }
        _ => {
            let windows = Windows::load()?;
            let id = this_window(&windows)?
                .and_then(|pid| windows.windows.get(&pid))
                .and_then(|w| w.session_id.clone())
                .context("name the session with --session and --project, or run this inside a session Omicron tracks")?;
            // Inside a session, act as its machine.
            let board = sign_in(true)?;
            let s = board.session_by_id(&id)?;
            Ok((board, s.id, s.name))
        }
    }
}

/// "90s", "10m", "2h", "1h30m", "1d" to seconds (at least 60).
pub fn parse_every(text: &str) -> Result<i64> {
    let bad = || anyhow::anyhow!("say how often like 90s, 10m, 2h or 1h30m (not {text:?})");
    let mut total = 0i64;
    let mut number = String::new();
    for c in text.trim().chars() {
        if c.is_ascii_digit() {
            number.push(c);
            continue;
        }
        let n: i64 = number.parse().map_err(|_| bad())?;
        number.clear();
        total += n * match c {
            's' => 1,
            'm' => 60,
            'h' => 3600,
            'd' => 86400,
            _ => return Err(bad()),
        };
    }
    if !number.is_empty() || total == 0 {
        return Err(bad());
    }
    if total < 60 {
        bail!("a loop runs at most once a minute");
    }
    Ok(total)
}

/// An end time: "18:30" (the next one), "2026-11-12 08:00", "+8h", or a
/// full timestamp. Local time unless it says otherwise.
pub fn parse_until(text: &str, now: DateTime<Local>) -> Result<DateTime<Utc>> {
    let t = text.trim();
    if let Some(rest) = t.strip_prefix('+') {
        return Ok((now + chrono::Duration::seconds(parse_every(rest).or_else(|_| {
            // "+30s" is too short for a loop interval but fine as an end.
            bail!("say the end like +8h or +30m")
        })?))
        .with_timezone(&Utc));
    }
    if let Ok(full) = DateTime::parse_from_rfc3339(t) {
        return Ok(full.with_timezone(&Utc));
    }
    for format in ["%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(t, format) {
            let local = Local.from_local_datetime(&naive).earliest().context("that time doesn't exist here (a clock change)")?;
            return Ok(local.with_timezone(&Utc));
        }
    }
    if let Ok(time) = NaiveTime::parse_from_str(t, "%H:%M") {
        let mut day = now.date_naive();
        if time <= now.time() {
            day = day.succ_opt().context("that's too far ahead")?;
        }
        let local = Local.from_local_datetime(&day.and_time(time)).earliest().context("that time doesn't exist here (a clock change)")?;
        return Ok(local.with_timezone(&Utc));
    }
    bail!("say the end like 18:30, \"2026-11-12 08:00\" or +8h (not {text:?})")
}

pub fn say_every(seconds: i64) -> String {
    let (h, m, s) = (seconds / 3600, seconds % 3600 / 60, seconds % 60);
    let mut parts = Vec::new();
    if h > 0 {
        parts.push(format!("{h}h"));
    }
    if m > 0 {
        parts.push(format!("{m}m"));
    }
    if s > 0 {
        parts.push(format!("{s}s"));
    }
    parts.join("")
}

fn say_time(iso: &str) -> String {
    DateTime::parse_from_rfc3339(iso)
        .map(|t| t.with_timezone(&Local).format("%b %-d %H:%M").to_string())
        .unwrap_or_else(|_| iso.to_string())
}

fn say_end(l: &Loop) -> String {
    match (&l.until, l.times) {
        (Some(u), _) => format!("until {} ({} so far)", say_time(u), l.runs),
        (None, Some(t)) => format!("{} of {t} runs done", l.runs),
        (None, None) => format!("until stopped ({} so far)", l.runs),
    }
}

/// The daemon's side: keeps this machine's running loops and runs each when
/// it's due. Hears about new and stopped loops through the change list
/// (`heard`), so nothing asks the database on a timer; the clock here only
/// decides when a run is due.
pub struct Runner {
    supabase: Supabase,
    key: MachineKey,
    loops: Mutex<HashMap<String, Loop>>,
    /// The loops' sessions, kept from the change list too, so a loop that's
    /// due but waiting (not open, gate closed, busy) asks nothing each tick.
    sessions: Mutex<HashMap<String, omicron::board::SessionRecord>>,
    /// This machine's owner (`None` until read; `Some(None)`: no owner).
    owner: Mutex<Option<Option<String>>>,
}

impl Runner {
    pub fn start(supabase: Supabase, key: MachineKey) -> Arc<Runner> {
        let runner = Arc::new(Runner { supabase, key, loops: Mutex::default(), sessions: Mutex::default(), owner: Mutex::default() });
        let r = runner.clone();
        std::thread::spawn(move || loop {
            if let Err(e) = r.tick() {
                eprintln!("omicron daemon: loops: {e:#}");
            }
            std::thread::sleep(Duration::from_secs(1));
        });
        runner
    }

    fn board(&self) -> Result<Board> {
        Ok(Board { supabase: self.supabase.clone(), session: self.supabase.sign_in_machine(&self.key)? })
    }

    /// Read this machine's running loops afresh (on start and reconnect).
    pub fn reload(&self) -> Result<()> {
        let board = self.board()?;
        let all = board.machine_loops(&self.key.machine_id.to_string())?;
        *self.loops.lock().unwrap() = all.into_iter().map(|l| (l.id.clone(), l)).collect();
        // Read afresh when needed (changes may have been missed meanwhile).
        self.sessions.lock().unwrap().clear();
        *self.owner.lock().unwrap() = Some(board.machine_owner()?);
        Ok(())
    }

    /// A line of the change list about a loop.
    pub fn heard(&self, row: &Value) {
        let me = self.key.machine_id.to_string();
        match row["table_name"].as_str() {
            // A loop's session changed or ended: forget it, to be read again.
            Some("sessions") => {
                let r = if row["kind"] == "DELETE" { &row["old_record"] } else { &row["record"] };
                if let Some(id) = r["id"].as_str() {
                    self.sessions.lock().unwrap().remove(id);
                }
                return;
            }
            // This machine's owner changed.
            Some("machines") if row["record"]["id"].as_str() == Some(me.as_str()) => {
                *self.owner.lock().unwrap() = Some(row["record"]["owner"].as_str().map(String::from));
                return;
            }
            Some("loops") => {}
            _ => return,
        }
        let record = if row["kind"] == "DELETE" { &row["old_record"] } else { &row["record"] };
        let Ok(l) = serde_json::from_value::<Loop>(record.clone()) else { return };
        if l.machine_id != self.key.machine_id.to_string() {
            return;
        }
        let mut loops = self.loops.lock().unwrap();
        if l.state == "running" && row["kind"] != "DELETE" {
            loops.insert(l.id.clone(), l);
        } else {
            loops.remove(&l.id);
        }
    }

    fn tick(&self) -> Result<()> {
        let now = Utc::now();
        let due: Vec<Loop> = self
            .loops
            .lock()
            .unwrap()
            .values()
            .filter(|l| DateTime::parse_from_rfc3339(&l.next_run_at).is_ok_and(|t| t <= now))
            .cloned()
            .collect();
        for l in due {
            self.run(&l, now)?;
        }
        Ok(())
    }

    fn run(&self, l: &Loop, now: DateTime<Utc>) -> Result<()> {
        let board = self.board()?;
        if l.until.as_deref().and_then(|u| DateTime::parse_from_rfc3339(u).ok()).is_some_and(|u| u <= now) {
            board.finish_loop(&l.id)?;
            self.loops.lock().unwrap().remove(&l.id);
            return Ok(());
        }
        // Bound first: a lock taken in the `match` line would be held for
        // the whole match, and the arm below takes it again.
        let cached = self.sessions.lock().unwrap().get(&l.session_id).cloned();
        let session = match cached {
            Some(s) => s,
            None => {
                let s = board.session_by_id(&l.session_id)?;
                self.sessions.lock().unwrap().insert(l.session_id.clone(), s.clone());
                s
            }
        };
        let name = session.name.clone();
        let open = session.claude_session_id.as_deref().is_some_and(omicron::inbox::listening);
        if !open {
            // Not open in any window: wait rather than pile prompts up for
            // when it is. Say so once.
            let note = format!("waiting: {name} isn't open (`omicron open {name}`)");
            if l.note.as_deref() != Some(note.as_str()) {
                board.loop_note(&l.id, Some(&note))?;
                if let Some(x) = self.loops.lock().unwrap().get_mut(&l.id) {
                    x.note = Some(note);
                }
            }
            return Ok(());
        }
        // Started from elsewhere: only by this machine's owner, while its
        // gate is open.
        let cached_owner = self.owner.lock().unwrap().clone();
        let owner = match cached_owner {
            Some(o) => o,
            None => {
                let o = board.machine_owner()?;
                *self.owner.lock().unwrap() = Some(o.clone());
                o
            }
        };
        let me = self.key.machine_id.to_string();
        let refused = omicron::gate::decide(&me, owner.as_deref(), l.started_by.as_deref(), omicron::gate::open_until().is_some(), &session.machine);
        if let Some(why) = refused {
            let note = format!("waiting: it was started from elsewhere. {why}");
            if l.note.as_deref() != Some(note.as_str()) {
                board.loop_note(&l.id, Some(&note))?;
                if let Some(x) = self.loops.lock().unwrap().get_mut(&l.id) {
                    x.note = Some(note);
                }
            }
            return Ok(());
        }
        if omicron::windows::is_busy(&l.session_id) {
            // Still working on the last one: wait for its turn to end.
            return Ok(());
        }
        // Claim this run in the database first: only one claim of a run
        // can succeed, so two daemons for the same machine (or a tick run
        // twice) never send it twice. Then mark the session busy and send.
        let claimed = board.loop_ran(&l.id, &l.next_run_at)?;
        if claimed.is_none() {
            // Someone else ran it (or it was stopped): catch up on its state.
            self.recorded(None, &l.id);
            return Ok(());
        }
        omicron::windows::set_busy(&l.session_id, true)?;
        crate::sessions_cmd::deliver(&board, &session, &l.prompt)?;
        self.recorded(claimed, &l.id);
        Ok(())
    }

    /// Keep the loop as the database has it after a run.
    fn recorded(&self, now: Option<Loop>, id: &str) {
        match now {
            Some(now) if now.state == "running" => {
                self.loops.lock().unwrap().insert(now.id.clone(), now);
            }
            _ => {
                self.loops.lock().unwrap().remove(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn how_often() {
        assert_eq!(parse_every("10m").unwrap(), 600);
        assert_eq!(parse_every("1h30m").unwrap(), 5400);
        assert_eq!(parse_every("90s").unwrap(), 90);
        assert_eq!(parse_every("1d").unwrap(), 86400);
        assert!(parse_every("30s").unwrap_err().to_string().contains("once a minute"));
        assert!(parse_every("10").is_err());
        assert!(parse_every("ten minutes").is_err());
        assert_eq!(say_every(5400), "1h30m");
        assert_eq!(say_every(90), "1m30s");
    }

    #[test]
    fn end_times() {
        let now = Local.with_ymd_and_hms(2026, 11, 11, 9, 0, 0).unwrap();
        let at = |t: &str| parse_until(t, now).unwrap().with_timezone(&Local).format("%Y-%m-%d %H:%M").to_string();
        assert_eq!(at("18:30"), "2026-11-11 18:30");
        // Already past today: tomorrow.
        assert_eq!(at("08:00"), "2026-11-12 08:00");
        assert_eq!(at("2026-11-12 07:15"), "2026-11-12 07:15");
        assert_eq!(at("+8h"), "2026-11-11 17:00");
        assert!(parse_until("tomorrow", now).is_err());
    }
}
