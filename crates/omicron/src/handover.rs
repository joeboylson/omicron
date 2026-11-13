//! Handing a session off to a fresh conversation (ref/BRAINSTORM.md,
//! "Session buttons"): ask it for its handoff note, wait until the note is
//! saved and its turn is over, then /clear. The start hook gives the fresh
//! conversation the note. Used by the Dev view's Hand off button and by
//! runs between tasks.

use crate::board::{Board, SessionRecord};
use crate::realtime::{self, Event, Listen, Next};
use crate::supa::Supabase;
use anyhow::Result;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

/// How long a session gets to write its note.
const NOTE_TIME: Duration = Duration::from_secs(20 * 60);

/// Ask, wait, clear. True once cleared; false if no note came in time (the
/// session is left as it was). Blocks until then.
pub fn hand_off_and_clear(supabase: &Supabase, board: &Board, session: &SessionRecord) -> Result<bool> {
    let before = board.waiting_handoff(&session.id)?.map(|h| h.id);
    let stop = Arc::new(AtomicBool::new(false));
    {
        let stop = stop.clone();
        std::thread::spawn(move || {
            std::thread::sleep(NOTE_TIME);
            stop.store(true, Ordering::Relaxed);
        });
    }
    let listen = Listen { tables: &["changes"], announce: None };
    let mut asked = false;
    let mut saved = false;
    realtime::listen(supabase, &listen, || Ok(board.session.clone()), &stop, |event| {
        match event {
            // Listening first, so the note can't be missed.
            Event::Listening if !asked => {
                asked = true;
                wait_until_free(&session.id);
                crate::host::say(
                    &session.name,
                    "Omicron: write your handoff note now (the /omicron-handoff skill, or `omicron handoff write`), then stop. This conversation is cleared once it's saved, and the fresh one starts from the note.",
                )?;
            }
            Event::Change(c) if c.table == "changes" && c.record["table_name"] == "handoffs" => {
                let note = &c.record["record"];
                if note["session_id"].as_str() == Some(session.id.as_str()) && note["state"] == "waiting" && note["id"].as_str() != before.as_deref() {
                    saved = true;
                    return Ok(Next::Stop);
                }
            }
            _ => {}
        }
        Ok(Next::Continue)
    })?;
    stop.store(true, Ordering::Relaxed);
    if !saved {
        return Ok(false);
    }
    // Let its turn finish before clearing (the Stop hook marks it free).
    std::thread::sleep(Duration::from_secs(1));
    wait_until_free(&session.id);
    crate::host::say(&session.name, "/clear")?;
    // The fresh conversation starts (its start hook) before anything else is typed.
    std::thread::sleep(Duration::from_secs(3));
    Ok(true)
}

/// Wait (up to two minutes) until a session's turn is over.
pub fn wait_until_free(session_id: &str) {
    let since = Instant::now();
    while crate::windows::is_busy(session_id) && since.elapsed() < Duration::from_secs(120) {
        std::thread::sleep(Duration::from_millis(500));
    }
}
