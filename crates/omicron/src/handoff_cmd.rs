//! `omicron handoff`: a Claude session writes down where it stopped, and the
//! next conversation in its window (after /clear) starts with the note. The
//! hooks in `sessions_cmd` do the handing over. Rewritten from lethe.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use clap::Subcommand;
use omicron::board::Handoff;
use omicron::windows::{this_window, Windows};
use std::io::Read;

#[derive(Subcommand)]
pub enum HandoffCmd {
    /// Save a handoff note for the session this runs in. Then type /clear:
    /// the next conversation in this window starts with it.
    Write {
        /// The note. Read from stdin when left out.
        text: Option<String>,
    },
    /// The newest handoff notes (all you can see, or one Project's)
    List {
        #[arg(long)]
        project: Option<String>,
    },
    /// Print a note
    Show {
        project: String,
        number: i64,
        /// Also mark it picked up (to continue from it in any session)
        #[arg(long)]
        pickup: bool,
    },
}

pub fn handoff(cmd: HandoffCmd, as_machine: bool) -> Result<()> {
    match cmd {
        HandoffCmd::Write { text } => {
            let body = match text {
                Some(t) => t,
                None => {
                    let mut s = String::new();
                    std::io::stdin().read_to_string(&mut s)?;
                    s
                }
            };
            if body.trim().is_empty() {
                bail!("the note is empty");
            }
            let windows = Windows::load()?;
            let session_id = this_window(&windows)?
                .and_then(|pid| windows.windows.get(&pid))
                .and_then(|w| w.session_id.clone())
                .context("run this inside a Claude session Omicron tracks (opened with `omicron open`)")?;
            // Notes belong to the session's machine.
            let board = sign_in(true)?;
            let session = board.session_by_id(&session_id)?;
            let note = board.write_handoff(&session, body.trim())?;
            println!(
                "Saved handoff note #{} for session {}. Type /clear: the next conversation in this window starts with it.",
                note.number, session.name
            );
        }
        HandoffCmd::List { project } => {
            let board = sign_in(as_machine)?;
            let project = project.map(|p| board.project(&p)).transpose()?;
            let notes = board.handoffs(project.as_ref())?;
            if notes.is_empty() {
                println!("No handoff notes yet.");
            }
            for n in notes {
                println!(
                    "#{}\t{}\t{}\t{}\t{}\t{}",
                    n.number,
                    n.project,
                    n.session.as_deref().unwrap_or("-"),
                    n.state.replace('_', " "),
                    n.written_at.get(..16).unwrap_or(&n.written_at).replace('T', " "),
                    first_line(&n.body)
                );
            }
        }
        HandoffCmd::Show { project, number, pickup } => {
            let board = sign_in(as_machine)?;
            let p = board.project(&project)?;
            let note = board.handoff(&p, number)?;
            print!("{}", note_text(&note));
            if pickup && note.state != "picked_up" {
                board.set_handoff_state(&note.id, "picked_up")?;
            }
        }
    }
    Ok(())
}

fn first_line(body: &str) -> String {
    let line = body.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    if line.chars().count() > 60 {
        format!("{}…", line.chars().take(59).collect::<String>())
    } else {
        line.to_string()
    }
}

/// A note as a session reads it.
pub fn note_text(note: &Handoff) -> String {
    format!(
        "Handoff note #{} in {}{}, written {}:\n\n{}\n",
        note.number,
        note.project,
        note.session.as_deref().map(|s| format!(" from session {s}")).unwrap_or_default(),
        note.written_at.get(..16).unwrap_or(&note.written_at).replace('T', " "),
        note.body
    )
}
