//! Dispatch: hand a task to its Claude session, on the session's machine.
//!
//! Whoever asks adds a request (`dispatches` table) and waits. The session's
//! machine hears it live (its daemon), claims it, and either types the task
//! into the session if it's running in Omicron's host, or reopens it there
//! (`claude --resume`) with the task as its first message. Then it saves how
//! it went, which the asker hears.
//!
//! The session is told the same way a person would tell it: "go get your
//! tasks" (`omicron tasks mine`), so the task text and the report rules come
//! from one place.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use omicron::board::{Board, Dispatch, SessionRecord, Task};
use omicron::realtime::{self, Event, Listen, Next};
use omicron::supa::{MachineKey, Supabase};
use omicron::windows::Windows;
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
                Some(false) => bail!("{} is asleep (its daemon isn't running), so {} can't be opened there", session.machine, session.name),
                Some(true) => {
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

    // Running in the host: type it in, then press Enter separately, so it
    // isn't taken as pasted text with a new line in it.
    if omicron::host::is_running(name) {
        omicron::host::send(name, &text)?;
        std::thread::sleep(Duration::from_millis(300));
        omicron::host::send(name, "\r")?;
        return Ok(format!("Typed the task into {name} on {machine}."));
    }

    let mut windows = Windows::load()?;
    let gone = windows.sweep();
    if windows.windows.values().any(|w| w.session_id.as_deref() == Some(session.id.as_str())) {
        bail!("{name} is open in a window Omicron doesn't host, so the task can't be typed in. Tell it to get its tasks (`omicron tasks mine`).");
    }
    for g in gone {
        board.update_session(&g, serde_json::json!({ "state": "gone", "gone_why": omicron::windows::STOPPED }))?;
    }

    // Closed: reopen it in the host with the task as its first message.
    let folder = std::path::PathBuf::from(&session.folder);
    if session.folder.is_empty() || !folder.is_dir() {
        bail!("{name}'s folder ({}) isn't on {machine} any more", session.folder);
    }
    let settings = crate::sessions_cmd::omicron_claude_settings()?;
    let mut command = vec!["claude".to_string()];
    if session.state == "gone" && session.gone_why.as_deref() != Some(omicron::windows::STOPPED) {
        bail!("{name} is gone ({}), so it can't be opened. Give the task to someone else.", session.gone_why.as_deref().unwrap_or("no reason saved"));
    }
    let claude_id = match &session.claude_session_id {
        Some(id) if !omicron::windows::transcript_exists(id) => {
            board.update_session(&session.id, serde_json::json!({ "state": "gone", "gone_why": omicron::windows::DELETED }))?;
            bail!("{name}'s conversation was deleted on {machine}, so it can't be reopened. Give the task to someone else.");
        }
        Some(id) => {
            command.extend(["--resume".into(), id.clone()]);
            id.clone()
        }
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            command.extend(["--session-id".into(), id.clone()]);
            board.update_session(&session.id, serde_json::json!({ "claude_session_id": id }))?;
            id
        }
    };
    command.extend(["--name".into(), name.clone(), "--settings".into(), settings.to_string_lossy().into_owned(), text]);
    // So the start hook ties the new window to this session.
    windows.links.insert(claude_id, session.id.clone());
    windows.save()?;
    omicron::host::start(name, &folder, &command, &[])?;
    Ok(format!("Reopened {name} on {machine} with the task. Jump in with `omicron sessions attach {name}`."))
}
