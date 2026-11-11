//! `omicron chat`: one chat per Project, for people and Claude sessions.

use crate::board_cmd::{acts_as_machine, sign_in};
use anyhow::Result;
use clap::Subcommand;
use omicron::windows::{this_window, Windows};

#[derive(Subcommand)]
pub enum Chat {
    /// Turn a Project's chat on
    On { project: String },
    /// Turn a Project's chat off (the messages stay)
    Off { project: String },
    /// The newest messages
    Read {
        project: String,
        #[arg(long, default_value_t = 20)]
        limit: usize,
    },
    /// Send a message. Name a Claude session (`@parser`) and it's told at the
    /// end of its next turn.
    Send { project: String, text: String },
}

pub fn chat(cmd: Chat, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    match cmd {
        Chat::On { project } => {
            let p = board.project(&project)?;
            board.set_chat(&p, true)?;
            println!("Chat is on for {}.", p.name);
        }
        Chat::Off { project } => {
            let p = board.project(&project)?;
            board.set_chat(&p, false)?;
            println!("Chat is off for {}.", p.name);
        }
        Chat::Read { project, limit } => {
            let p = board.project(&project)?;
            let msgs = board.chat(&p, limit)?;
            if msgs.is_empty() {
                println!("No messages yet.");
            }
            for m in msgs {
                println!("{}", line(&m));
            }
        }
        Chat::Send { project, text } => {
            let p = board.project(&project)?;
            // From inside a tracked Claude session, as its machine.
            let session_id = if acts_as_machine(as_machine)? {
                let windows = Windows::load()?;
                this_window(&windows)?.and_then(|pid| windows.windows.get(&pid)).and_then(|w| w.session_id.clone())
            } else {
                None
            };
            board.send_chat(&p, &text, session_id.as_deref())?;
            println!("Sent.");
        }
    }
    Ok(())
}

pub fn line(m: &omicron::board::ChatMessage) -> String {
    let who = match &m.session {
        Some(s) => format!("{} (session {s})", m.author),
        None => m.author.clone(),
    };
    format!("{} {who}: {}", m.at.get(..16).unwrap_or(&m.at).replace('T', " "), m.body)
}
