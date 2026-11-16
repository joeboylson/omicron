//! Conversations (#281): a group chat in a Project. People post from the
//! page or here; a Claude session takes part when its loop watches the
//! conversation, reads new messages on each `omicron loop check`, and
//! answers with `omicron say`.

use crate::board_cmd::{acts_as_machine, sign_in};
use crate::loops_cmd::{parse_every, say_every};
use anyhow::{bail, Context, Result};
use clap::Subcommand;
use omicron::board::{Board, Conversation, LoopWatch, Message, Project};
use std::path::PathBuf;

#[derive(Subcommand)]
pub enum Conversations {
    /// A Project's conversations, newest activity first
    List { project: String },
    /// Start a conversation
    Start { project: String, name: String },
    /// A conversation: its sessions, pinned tasks and messages
    Show {
        project: String,
        name: String,
        /// Only the last this many messages
        #[arg(long, default_value_t = 30)]
        last: usize,
    },
    /// Remove a conversation and its messages
    Remove { project: String, name: String },
    /// Pin a task to a conversation
    Pin { project: String, name: String, number: i64 },
    /// Unpin a task
    Unpin { project: String, name: String, number: i64 },
    /// Add a Claude session: its loop checks the conversation (a loop is
    /// started for it if it has none, checking as soon as it's done unless
    /// --every says how often)
    Add {
        project: String,
        name: String,
        session: String,
        /// How often a new loop checks, like 15m (left out: as soon as it's done)
        #[arg(long)]
        every: Option<String>,
        /// Its own instructions for this conversation, on top of the board rules
        #[arg(long)]
        instructions: Option<String>,
    },
    /// Take a session out of a conversation
    Drop { project: String, name: String, session: String },
    /// Mark a conversation as read
    Read { project: String, name: String },
    /// Save the images in a conversation's last messages to a folder, to look at them
    Images {
        project: String,
        name: String,
        /// From the last this many messages
        #[arg(long, default_value_t = 10)]
        last: usize,
        /// Where to save them (a new folder under the system's temp folder if left out)
        #[arg(long)]
        to: Option<PathBuf>,
    },
}

pub fn conversations(cmd: Conversations, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    match cmd {
        Conversations::List { project } => {
            let p = board.project(&project)?;
            let all = board.conversations(&p)?;
            if all.is_empty() {
                println!("{} has no conversations yet.", p.name);
            }
            for c in all {
                println!("{}{}", c.name, if c.unread { "  unread" } else { "" });
            }
        }
        Conversations::Start { project, name } => {
            let p = board.project(&project)?;
            let c = board.start_conversation(&p, &name)?;
            println!("Started {} in {}.", c.name, p.name);
        }
        Conversations::Show { project, name, last } => {
            let p = board.project(&project)?;
            let c = board.conversation(&p, &name)?;
            print!("{}", show(&board, &p, &c, last)?);
        }
        Conversations::Remove { project, name } => {
            let p = board.project(&project)?;
            let c = board.conversation(&p, &name)?;
            board.remove_conversation(&c)?;
            println!("Removed {}.", c.name);
        }
        Conversations::Pin { project, name, number } => {
            let p = board.project(&project)?;
            let c = board.conversation(&p, &name)?;
            let t = board.task(&p, number)?;
            if board.pinned_tasks(&c)?.iter().any(|x| x.id == t.id) {
                bail!("#{number} is already pinned to {}", c.name);
            }
            board.pin_task(&c, &t)?;
            println!("Pinned #{} {} to {}.", t.number, t.title, c.name);
        }
        Conversations::Unpin { project, name, number } => {
            let p = board.project(&project)?;
            let c = board.conversation(&p, &name)?;
            let t = board.task(&p, number)?;
            board.unpin_task(&c, &t)?;
            println!("Unpinned #{} from {}.", t.number, c.name);
        }
        Conversations::Add { project, name, session, every, instructions } => {
            let p = board.project(&project)?;
            let c = board.conversation(&p, &name)?;
            let s = board.session(&p, &session)?;
            let every = every.as_deref().map(parse_every).transpose()?;
            let l = match board.loops(Some(&s.id))?.into_iter().next() {
                Some(l) => l,
                None => {
                    let l = board.start_loop(&s.id, "", every, None, None, true, &Default::default(), every.is_none(), true)?;
                    println!("Started a loop for {}: {}.", s.name, every.map(|e| format!("every {}", say_every(e))).unwrap_or("as soon as it's done".into()));
                    l
                }
            };
            if board.loop_watches(&l.id)?.iter().any(|w| w.conversation_id.as_deref() == Some(c.id.as_str())) {
                bail!("{} is already in {}", s.name, c.name);
            }
            board.add_loop_watch(&l.id, &LoopWatch { conversation_id: Some(c.id.clone()), instructions: instructions.unwrap_or_default(), ..Default::default() })?;
            println!("Added {} to {}.", s.name, c.name);
        }
        Conversations::Drop { project, name, session } => {
            let p = board.project(&project)?;
            let c = board.conversation(&p, &name)?;
            let s = board.session(&p, &session)?;
            let l = board.loops(Some(&s.id))?.into_iter().next().with_context(|| format!("{} isn't in {}", s.name, c.name))?;
            let watches = board.loop_watches(&l.id)?;
            let w = watches.iter().find(|w| w.conversation_id.as_deref() == Some(c.id.as_str())).with_context(|| format!("{} isn't in {}", s.name, c.name))?;
            board.remove_loop_watch(&w.id)?;
            // Its last watch, and no message: nothing left to do, so it stops.
            if watches.len() == 1 && l.prompt.trim().is_empty() {
                board.stop_loop(&l.id)?;
                println!("Took {} out of {}; its loop had nothing else to do, so it stopped.", s.name, c.name);
            } else {
                println!("Took {} out of {}.", s.name, c.name);
            }
        }
        Conversations::Read { project, name } => {
            let p = board.project(&project)?;
            let c = board.conversation(&p, &name)?;
            board.mark_conversation_read(&c)?;
            println!("Marked {} as read.", c.name);
        }
        Conversations::Images { project, name, last, to } => {
            let p = board.project(&project)?;
            let c = board.conversation(&p, &name)?;
            let messages = board.messages(&c, None)?;
            let images: Vec<String> = messages.into_iter().rev().take(last).collect::<Vec<_>>().into_iter().rev().flat_map(|m| m.images).collect();
            if images.is_empty() {
                println!("No images in {}'s last {last} messages.", c.name);
                return Ok(());
            }
            let dir = match to {
                Some(d) => d,
                None => std::env::temp_dir().join(format!("omicron-images-{}", uuid::Uuid::new_v4().simple())),
            };
            std::fs::create_dir_all(&dir)?;
            for (i, path) in images.iter().enumerate() {
                let file = dir.join(format!("{}-{}", i + 1, omicron::board::image_name(path)));
                std::fs::write(&file, board.image(path)?)?;
                println!("{}", file.display());
            }
        }
    }
    Ok(())
}

/// `omicron say`: post a message, as the session it's run in (if any).
pub fn say(conversation: String, text: String, images: Vec<PathBuf>, project: Option<String>, as_machine: bool) -> Result<()> {
    let machine = acts_as_machine(as_machine)?;
    let board = sign_in(machine)?;
    let session = if machine { this_session(&board)? } else { None };
    let p = match (&project, &session) {
        (Some(name), _) => board.project(name)?,
        (None, Some(s)) => board.project(&s.project_id)?,
        (None, None) => bail!("say which Project with --project"),
    };
    let c = board.conversation(&p, &conversation)?;
    let session_id = session.filter(|s| s.project_id == p.id).map(|s| s.id);
    board.post_message(&p, &c, &text, session_id.as_deref(), &images)?;
    println!("Said in {}.", c.name);
    Ok(())
}

/// The session this command runs in: its window, or `OMICRON_SESSION`.
fn this_session(board: &Board) -> Result<Option<omicron::board::SessionRecord>> {
    let windows = omicron::windows::Windows::load()?;
    if let Some(id) = omicron::windows::this_window(&windows)?.and_then(|pid| windows.windows.get(&pid)).and_then(|w| w.session_id.clone()) {
        return Ok(Some(board.session_by_id(&id)?));
    }
    match std::env::var("OMICRON_SESSION").ok().filter(|n| !n.trim().is_empty()) {
        Some(name) => board.my_session_named(&name),
        None => Ok(None),
    }
}

/// Who wrote a message, as a line's start: "Joe" or "atlas (session parser)".
pub fn author(m: &Message) -> String {
    match &m.session {
        Some(s) => format!("{} (session {s})", m.author),
        None => m.author.clone(),
    }
}

/// One message as text, its images listed after.
pub fn say_message(m: &Message) -> String {
    let at = m.at.get(..16).unwrap_or(&m.at).replace('T', " ");
    let mut out = format!("[{at}] {}: {}", author(m), m.body.trim());
    if !m.images.is_empty() {
        out.push_str(&format!(" [{} image{}]", m.images.len(), if m.images.len() == 1 { "" } else { "s" }));
    }
    out
}

fn show(board: &Board, p: &Project, c: &Conversation, last: usize) -> Result<String> {
    let mut out = format!("{} in {}{}\n", c.name, p.name, if c.unread { " (unread)" } else { "" });
    let sessions = board.conversation_sessions(c)?;
    if !sessions.is_empty() {
        out.push_str(&format!("Sessions: {}\n", sessions.join(", ")));
    }
    let pinned = board.pinned_tasks(c)?;
    if !pinned.is_empty() {
        out.push_str("Pinned:\n");
        for t in pinned {
            out.push_str(&format!("  #{} {}\n", t.number, omicron::text::line(&t.title)));
        }
    }
    let messages = board.messages(c, None)?;
    if messages.is_empty() {
        out.push_str("No messages yet.\n");
    }
    for m in messages.iter().skip(messages.len().saturating_sub(last)) {
        out.push_str(&say_message(m));
        out.push('\n');
    }
    Ok(out)
}
