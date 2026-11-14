//! `omicron sessions`: listing, sending to, ending and renaming Claude
//! sessions. Every session runs the same way: opened in a terminal with
//! `omicron open` (sessions_open.rs), which records it and loads Omicron's
//! hooks (hooks.rs) and add-on (claude_setup.rs). Messages for it go into
//! its inbox (omicron::tell), and the add-on puts them into its window.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use omicron::windows::Windows;
use serde_json::json;
use std::path::PathBuf;
use crate::claude_setup::{add_addon, add_hooks, add_skill};
use clap::Subcommand;

#[derive(Subcommand)]
pub enum Sessions {
    /// Pick one of this machine's sessions from a full-screen list and
    /// open it here (`omicron open`)
    Pick,
    /// List sessions (all the ones you can see, or one Project's)
    List {
        #[arg(long)]
        project: Option<String>,
    },
    /// Remove a session's record
    Remove {
        name: String,
        #[arg(long)]
        project: String,
    },
    /// Run a command in the background in Omicron's session host, to jump
    /// into later with `attach`. Example: omicron sessions host work -- claude
    Host {
        name: String,
        #[arg(last = true, required = true)]
        command: Vec<String>,
    },
    /// Jump into a hosted session here. Ctrl-\ detaches.
    Attach { name: String },
    /// Type a message into a hosted session and send it (Enter is pressed
    /// for you, a moment after the text, so it isn't taken as pasted)
    Send {
        name: String,
        text: String,
        /// Only type it, don't press Enter (\r and \n in the text are keys)
        #[arg(long)]
        no_enter: bool,
    },
    /// The hosted sessions running on this machine
    Hosted,
    /// Follow a conversation's inbox, printing each message as one JSON
    /// line (run by Omicron's add-on inside the Claude window)
    #[command(hide = true)]
    Inbox { conversation: String },
    /// The host process itself (started by `host`)
    #[command(hide = true)]
    HostRun {
        name: String,
        #[arg(last = true, required = true)]
        command: Vec<String>,
    },
    /// Add Omicron's hooks to Claude Code's settings, so it can tell which
    /// window is which session
    SetupClaude {
        /// The settings file (default ~/.claude/settings.json)
        #[arg(long)]
        settings: Option<PathBuf>,
    },
}

pub fn sessions(cmd: Sessions, as_machine: bool) -> Result<()> {
    match cmd {
        Sessions::List { project } => {
            let board = sign_in(as_machine)?;
            let project = project.map(|p| board.project(&p)).transpose()?;
            let rows = board.sessions(project.as_ref())?;
            if rows.is_empty() {
                println!("No sessions yet. In a Claude Code session, open one with `omicron open`.");
            }
            for s in rows {
                let why = s.gone_why.map(|w| format!("\t({w})")).unwrap_or_default();
                println!("{}\t{}\t{}\t{}\t{}{why}", s.name, omicron::text::line(&s.project), s.machine, s.state, omicron::text::line(&s.folder));
            }
        }
        Sessions::Remove { name, project } => {
            let board = sign_in(as_machine)?;
            let project = board.project(&project)?;
            let record = board.session(&project, &name)?;
            board.remove_session(&project, &name)?;
            let mut windows = Windows::load()?;
            windows.links.retain(|_, id| *id != record.id);
            for w in windows.windows.values_mut() {
                if w.session_id.as_deref() == Some(record.id.as_str()) {
                    w.session_id = None;
                }
            }
            windows.save()?;
            println!("Removed session {name} from {}.", project.name);
        }
        Sessions::Pick => crate::picker::pick()?,
        Sessions::Host { name, command } => {
            let folder = std::env::current_dir()?;
            omicron::host::start(&name, &folder, &command, &[])?;
            println!("{name} is running. Jump in with `omicron sessions attach {name}`.");
        }
        Sessions::Attach { name } => {
            if omicron::host::attach(&name)? {
                eprintln!("{name} ended.");
            }
        }
        Sessions::Send { name, text, no_enter } => {
            let text = text.replace("\\r", "\r").replace("\\n", "\n");
            if no_enter {
                // Keys, as they are (like Ctrl-D), into whatever runs in the host.
                omicron::host::send(&name, &text)?;
                return Ok(());
            }
            // A session (when this machine can look it up), or else
            // whatever runs in the host under that name.
            let found = match sign_in(true) {
                Ok(board) => {
                    let me = omicron::config::Config::load()?.machine_key()?.machine_id.to_string();
                    board.sessions(None)?.into_iter().find(|s| s.name == name && s.machine_id == me).map(|s| (board, s))
                }
                Err(_) if omicron::host::is_running(&name) => None,
                Err(e) => return Err(e),
            };
            match found {
                // A session: through its inbox, as if typed once Claude is free.
                Some((board, session)) => {
                    use omicron::tell::Delivery;
                    match omicron::tell::tell(&board, &session, &text)? {
                        Delivery::Sent => println!("Sent it to {name}."),
                        Delivery::Waiting => println!("Left it for {name}. It isn't ready for it yet; it gets it as soon as it is."),
                        Delivery::NotOpen => println!("Left it for {name}. It isn't open; it gets it when it's next opened (`omicron open {name}`)."),
                    }
                }
                // Something else in the host (a team member): typed, then
                // Enter on its own, so it sends.
                None if omicron::host::is_running(&name) => omicron::host::say(&name, &text)?,
                None => bail!("no session called {name} on this machine"),
            }
        }
        Sessions::Inbox { conversation } => {
            use std::io::Write;
            let mut out = std::io::stdout().lock();
            // Stops once the window stops reading (its add-on ended).
            omicron::inbox::follow(&conversation, |text| {
                writeln!(out, "{}", json!(text)).and_then(|_| out.flush()).is_ok()
            })?;
        }
        Sessions::Hosted => {
            let names = omicron::host::hosted()?;
            if names.is_empty() {
                println!("No hosted sessions are running on this machine.");
            }
            for n in names {
                println!("{n}");
            }
        }
        Sessions::HostRun { name, command } => omicron::host::host(&name, &command)?,
        Sessions::SetupClaude { settings } => {
            let path = match settings {
                Some(p) => p,
                None => PathBuf::from(std::env::var_os("HOME").context("HOME isn't set")?).join(".claude/settings.json"),
            };
            let exe = std::env::current_exe()?.canonicalize()?;
            add_hooks(&path, &exe.to_string_lossy())?;
            let skill = add_skill(path.parent().context("the settings file has no folder")?)?;
            let addon = add_addon(&exe.to_string_lossy())?;
            println!("Added Omicron's hooks to {}. Restart open Claude Code sessions to pick them up.", path.display());
            println!("Added the /omicron-handoff command ({}).", skill.display());
            println!("Added Omicron's add-on ({}). Start Claude with `--plugin-dir {}` to get Omicron's messages.", addon.display(), addon.display());
        }
    }
    Ok(())
}
