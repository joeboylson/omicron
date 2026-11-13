//! Dispatch: hand a task to its Claude session, on the session's machine.
//!
//! Whoever asks adds a request (`dispatches` table) and waits. The session's
//! machine hears it live (its daemon), claims it, and leaves the task in the
//! session's inbox: Omicron's add-on puts it into the session's window now,
//! or when it's next opened (`omicron open`). Then it saves how it went,
//! which the asker hears.
//!
//! The session is told the same way a person would tell it: "go get your
//! tasks" (`omicron tasks mine`), so the task text and the report rules come
//! from one place.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use omicron::board::{Board, Dispatch, SessionRecord, Task};
use omicron::realtime::{self, Event, Listen, Next};
use omicron::supa::{MachineKey, Supabase};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How long the machine has to take the request (the database stops it
/// being taken after this too).
pub const CLAIM_TIME: Duration = Duration::from_secs(20);
/// How long the machine has, once it took it, to say how it went.
pub const FINISH_TIME: Duration = Duration::from_secs(60);

/// What the session is told.
pub fn message(project: &str, task: &Task) -> String {
    // One line: a new line would send it early.
    let title = task.title.replace(['\n', '\r'], " ");
    format!(
        "Omicron dispatched task #{} \"{title}\" ({project}) to you. Run `omicron tasks mine` to get it, then work on it and report as it says.",
        task.number
    )
}

/// `omicron tasks dispatch`: ask, then wait to hear how it went.
pub fn dispatch(project: &str, number: i64, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    let p = board.project(project)?;
    let task = board.task(&p, number)?;
    let name = task.session.clone().context("give the task to a Claude session first (`omicron tasks send`)")?;
    let session = board.session(&p, &name)?;
    let outcome = request_and_wait(&board, &task, &session)?;
    match outcome.state.as_str() {
        "done" => {
            println!("{}", outcome.result.unwrap_or_else(|| format!("{name} has the task.")));
            Ok(())
        }
        _ => bail!(outcome.error.unwrap_or_else(|| "it didn't happen".into())),
    }
}

/// How long a machine that looks asleep gets to show up before a hand-off
/// gives up on it.
const ASLEEP_GRACE: Duration = Duration::from_secs(5);

/// Add the request once the machine is known to be awake and we're
/// listening (so its answer can't be missed), then wait for the answer.
fn request_and_wait(board: &Board, task: &Task, session: &SessionRecord) -> Result<Dispatch> {
    const PENDING: u8 = 0;
    const CLAIMED: u8 = 1;
    let stop = Arc::new(AtomicBool::new(false));
    let phase = Arc::new(AtomicU8::new(PENDING));
    let mut listening = false;
    let mut awake: Option<bool> = None;
    let mut request: Option<Dispatch> = None;
    let mut answer: Option<Dispatch> = None;

    let mut timer: Option<std::thread::JoinHandle<()>> = None;
    // A machine whose daemon has only just started can take a moment to show
    // as connected: give it a few seconds before calling it asleep.
    let still_asleep = Arc::new(AtomicBool::new(false));
    let mut grace: Option<std::thread::JoinHandle<()>> = None;
    let listen = Listen { tables: &["changes"], announce: None };
    let started = Instant::now();
    realtime::listen(&board.supabase, &listen, || Ok(board.session.clone()), &stop, |event| {
        match event {
            Event::Listening => listening = true,
            Event::Connected(who) => {
                awake = Some(who.values().any(|d| d["machine_id"].as_str() == Some(session.machine_id.as_str())));
            }
            Event::Change(c) if c.table == "changes" && c.record["table_name"] == "dispatches" => {
                let row = &c.record["record"];
                if let Some(r) = &request {
                    if row["id"].as_str() == Some(r.id.as_str()) {
                        let d = omicron::board::dispatch_from(row)?;
                        match d.state.as_str() {
                            "claimed" => phase.store(CLAIMED, Ordering::Relaxed),
                            "done" | "failed" => {
                                answer = Some(d);
                                return Ok(Next::Stop);
                            }
                            _ => {}
                        }
                    }
                }
            }
            Event::Reconnecting(why) if request.is_none() && started.elapsed() > Duration::from_secs(10) => {
                bail!("couldn't reach Realtime: {why}")
            }
            _ => {}
        }
        if request.is_none() && listening {
            match awake {
                Some(false) => {
                    still_asleep.store(true, Ordering::Relaxed);
                    if grace.is_none() {
                        let (stop, still_asleep) = (stop.clone(), still_asleep.clone());
                        grace = Some(std::thread::spawn(move || {
                            let since = Instant::now();
                            while since.elapsed() < ASLEEP_GRACE {
                                if !still_asleep.load(Ordering::Relaxed) || stop.load(Ordering::Relaxed) {
                                    return;
                                }
                                std::thread::sleep(Duration::from_millis(100));
                            }
                            if still_asleep.load(Ordering::Relaxed) {
                                stop.store(true, Ordering::Relaxed);
                            }
                        }));
                    }
                }
                Some(true) => {
                    still_asleep.store(false, Ordering::Relaxed);
                    request = Some(board.request_dispatch(task)?);
                    let asked_at = Instant::now();
                    let (stop, phase) = (stop.clone(), phase.clone());
                    timer = Some(std::thread::spawn(move || loop {
                        let waited = asked_at.elapsed();
                        let pending = phase.load(Ordering::Relaxed) == PENDING;
                        if (pending && waited > CLAIM_TIME) || waited > CLAIM_TIME + FINISH_TIME || stop.load(Ordering::Relaxed) {
                            stop.store(true, Ordering::Relaxed);
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }));
                }
                None => {}
            }
        }
        Ok(Next::Continue)
    })?;
    stop.store(true, Ordering::Relaxed);
    if let Some(t) = timer {
        let _ = t.join();
    }
    if let Some(g) = grace {
        let _ = g.join();
    }
    if request.is_none() && still_asleep.load(Ordering::Relaxed) {
        bail!("{} is asleep (its daemon isn't running), so {} can't be opened there", session.machine, session.name);
    }
    if let Some(a) = answer {
        return Ok(a);
    }
    let r = request.context("stopped before asking")?;
    // The answer may have come in between; read it to be sure.
    let now = board.dispatch(&r.id)?;
    if now.state == "pending" {
        let why = format!("{} didn't pick it up in time. Is its daemon running?", session.machine);
        if board.give_up_dispatch(&r.id, &why)? {
            bail!(why);
        }
        return board.dispatch(&r.id);
    }
    if now.state == "claimed" {
        bail!("{} took it but didn't say how it went. Check `omicron sessions hosted` there.", session.machine);
    }
    Ok(now)
}

/// The daemon's side: a new request for this machine. Takes it (if nobody
/// has and it isn't too old), hands the task over, and says how it went.
/// Safe to run twice for the same request: only the first can take it.
pub fn carry_out(supabase: &Supabase, key: &MachineKey, machine: &str, row: &Value) -> Result<()> {
    let Some(id) = row["id"].as_str() else { return Ok(()) };
    if row["state"] != "pending" || row["machine_id"].as_str() != Some(key.machine_id.to_string().as_str()) {
        return Ok(());
    }
    let board = Board { supabase: supabase.clone(), session: supabase.sign_in_machine(key)? };
    let Some(d) = board.claim_dispatch(id)? else { return Ok(()) };
    // Work handed over from elsewhere: only while this computer's gate is open.
    if omicron::gate::open_until().is_none() {
        return board.finish_dispatch(
            &d.id,
            false,
            &format!("{machine}'s gate is closed, so it takes no work from elsewhere. Open it on {machine} with `omicron gate open --until 17:00`."),
        );
    }
    let (ok, message) = match hand_over(&board, machine, &d) {
        Ok(m) => (true, m),
        Err(e) => (false, format!("{e:#}")),
    };
    board.finish_dispatch(&d.id, ok, &message)
}

fn hand_over(board: &Board, machine: &str, d: &Dispatch) -> Result<String> {
    let (project, task) = board.task_by_id(&d.task_id)?;
    let session = board.session_by_id(&d.session_id)?;
    let text = message(&project, &task);
    let name = &session.name;
    if crate::sessions_cmd::deliver(board, &session, &text)? {
        Ok(format!("Sent the task to {name} on {machine}."))
    } else {
        Ok(format!("{name} isn't open on {machine}. It gets the task when it's next opened (`omicron open {name}`)."))
    }
}
