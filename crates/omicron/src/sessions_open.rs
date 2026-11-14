//! `omicron open` and `omicron link`: running a Claude session the one way,
//! and making a session of a chat that's already running.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use omicron::windows::{this_window, Window, Windows};
use std::path::PathBuf;
use crate::claude_setup::{addon_dir, omicron_claude_settings, shell_quote};

/// `omicron open`: the one way to run a Claude session. Claude runs in the
/// background, with Omicron's hooks and add-on (so it gets its messages
/// from the web page and other machines live), and this terminal jumps in:
/// Ctrl-\ (or `omicron detach` inside it) lets go and leaves it running, and
/// `omicron open <name>` jumps back in. A session exists only while it
/// runs: quitting Claude ends it. With `--resume` it starts from an existing
/// Claude conversation.
pub fn open(name: Option<String>, project: Option<String>, resume: Option<String>, folder: Option<PathBuf>) -> Result<()> {
    // Run from inside a Claude window: it can't start Claude in there, so
    // say exactly what to run once this window is closed.
    if let Some(here) = std::env::var("CLAUDE_CODE_SESSION_ID").ok().filter(|v| !v.is_empty()) {
        if let Some(session) = std::env::var("OMICRON_SESSION").ok().filter(|s| !s.is_empty()) {
            bail!("this is already the session {session}. `omicron detach` lets go of it and leaves it running.");
        }
        let name = match name {
            Some(n) => n,
            None => std::env::current_dir()?.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| "<name>".into()),
        };
        let project = project.map(|p| format!(" --project {}", shell_quote(&p))).unwrap_or_default();
        let name = shell_quote(&name);
        bail!(
            "this is already a Claude Code window, and `omicron open` starts Claude Code itself, so it can't start one inside it.\n\
             \n\
             Two ways to make this conversation an Omicron session:\n\
             \n\
             - Keep this window as it is: type `! omicron link {name}{project}` in Claude.\n\
             \x20 It becomes a session now, and ends when you quit this window.\n\
             \n\
             - Or have Omicron run it, so it keeps going in the background and gets\n\
             \x20 messages from the web page: quit Claude (/exit), then in this terminal run\n\
             \x20   omicron open {name}{project} --resume {}\n\
             \x20 That reopens this same conversation.",
            resume.unwrap_or(here)
        );
    }
    let board = sign_in(true).context("this computer isn't ready for sessions yet (`omicron doctor` says what's missing)")?;
    let me = omicron::config::Config::load()?.machine_key()?.machine_id.to_string();
    let project = project.map(|p| board.project(&p)).transpose()?;
    let mine: Vec<_> = board.sessions(project.as_ref())?.into_iter().filter(|s| s.machine_id == me).collect();
    if let Some(id) = &resume {
        uuid::Uuid::parse_str(id).context("--resume takes Claude Code's session id (a UUID)")?;
        if let Some(s) = mine.iter().find(|s| s.claude_session_id.as_deref() == Some(id.as_str())) {
            return jump_in(&board, s);
        }
        if !omicron::windows::transcript_exists(id) {
            bail!("there's no conversation {id} on this machine");
        }
    }
    if let Some(n) = &name {
        let named: Vec<_> = mine.iter().filter(|s| &s.name == n).collect();
        if named.len() > 1 {
            bail!(
                "{n} is a session in more than one Project here; say which with --project ({})",
                named.iter().map(|s| s.project.as_str()).collect::<Vec<_>>().join(", ")
            );
        }
        if let Some(s) = named.first() {
            return jump_in(&board, s);
        }
    }

    // A new session, in a folder: a known one is its Project's.
    let folder = match folder {
        Some(f) => f.canonicalize().with_context(|| format!("there's no folder {}", f.display()))?,
        None => std::env::current_dir()?,
    };
    let known = crate::folders_cmd::here(&board, &folder)?;
    let project = match (project, &known) {
        (Some(p), _) => p,
        (None, Some(f)) => board.project(&f.project)?,
        (None, None) => crate::folders_cmd::only_project(&board)?,
    };
    let name = match name {
        Some(n) => n,
        None => {
            let suggested = folder.file_name().map(|f| f.to_string_lossy().into_owned());
            ask_name(suggested.as_deref())?
        }
    };
    // Its name must work for the background runner, and be free here.
    omicron::host::socket_path(&name)?;
    if omicron::host::is_running(&name) {
        bail!("something called {name} is already running on this machine");
    }
    let claude_id = resume.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let record = board.add_session(&project, &name, &claude_id, &folder.to_string_lossy())?;
    // Remembered as the Project's folder here, for next time.
    if known.as_ref().is_none_or(|f| f.project != project.name) {
        if let Err(e) = crate::folders_cmd::remember(&board, &project, &folder) {
            eprintln!("couldn't remember {} as a folder for {}: {e:#}", folder.display(), project.name);
        }
    }
    // So the start hook ties Claude's window to the session.
    let mut windows = Windows::load()?;
    windows.links.insert(claude_id.clone(), record.id.clone());
    windows.save()?;
    let command = claude_command(&record.name, &claude_id, resume.is_some())?;
    if let Err(e) = omicron::host::start(&record.name, &folder, &command, &[]) {
        // Never ran: no session.
        let _ = board.end_session(&record.id);
        return Err(e);
    }
    attach_here(&record.name)
}

/// A chat starting in one of this machine's folders becomes a session of
/// its Project, named after the folder. Returns the session's id and what
/// to tell the chat, or None outside a known folder (no Supabase then).
pub fn link_in_folder(claude_id: &str, folder: &str) -> Result<Option<(String, String)>> {
    let Some((_, project)) = omicron::known_folders::find(std::path::Path::new(folder)) else { return Ok(None) };
    let board = sign_in(true)?;
    let project = board.project(&project)?;
    let base = std::path::Path::new(folder).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| "claude".into());
    let name = free_name(&board, &base)?;
    let record = board.add_session(&project, &name, claude_id, folder)?;
    let said = format!(
        "Omicron: this chat is the session {name} in the Project {}. Its tasks: `omicron tasks mine`.",
        project.name
    );
    Ok(Some((record.id, said)))
}

/// A session name not taken on this machine: the name, or name-2, name-3...
fn free_name(board: &omicron::board::Board, base: &str) -> Result<String> {
    let me = board.me();
    let taken: Vec<String> = board.sessions(None)?.into_iter().filter(|s| s.machine_id == me).map(|s| s.name.to_lowercase()).collect();
    let mut name = base.to_string();
    let mut n = 1;
    while taken.contains(&name.to_lowercase()) || omicron::host::is_running(&name) {
        n += 1;
        name = format!("{base}-{n}");
    }
    Ok(name)
}

/// `omicron link`, typed into a Claude chat (`! omicron link`): the chat
/// becomes an Omicron session where it is, without quitting it. Its folder
/// is remembered as the Project's, so the next chat there links itself.
pub fn link(name: Option<String>, project: Option<String>) -> Result<()> {
    let claude_id = std::env::var("CLAUDE_CODE_SESSION_ID")
        .ok()
        .filter(|v| !v.is_empty())
        .context("run this inside a Claude chat: type `! omicron link` there")?;
    if let Ok(session) = std::env::var("OMICRON_SESSION") {
        bail!("this chat is already the session {session}");
    }
    let mut windows = Windows::load()?;
    let pid = this_window(&windows)?.context("couldn't find this chat's Claude process")?;
    if let Some(id) = windows.windows.get(&pid).and_then(|w| w.session_id.clone()).or_else(|| windows.links.get(&claude_id).cloned()) {
        bail!("this chat is already linked (session {id})");
    }
    let board = sign_in(true).context("this computer isn't ready for sessions yet (`omicron doctor` says what's missing)")?;
    let folder = std::env::current_dir()?;
    let known = crate::folders_cmd::here(&board, &folder)?;
    let project = match (project, &known) {
        (Some(p), _) => board.project(&p)?,
        (None, Some(f)) => board.project(&f.project)?,
        (None, None) => crate::folders_cmd::only_project(&board)?,
    };
    let base = folder.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| "claude".into());
    let name = match name {
        Some(n) => n,
        None => free_name(&board, &base)?,
    };
    let record = board.add_session(&project, &name, &claude_id, &folder.to_string_lossy())?;
    windows.links.insert(claude_id.clone(), record.id.clone());
    windows.windows.insert(pid, Window { claude_session_id: claude_id, folder: folder.to_string_lossy().into_owned(), session_id: Some(record.id), clearing: false });
    windows.save()?;
    if known.as_ref().is_none_or(|f| f.project != project.name) {
        crate::folders_cmd::remember(&board, &project, &folder)?;
    }
    println!(
        "This chat is now the session {name} in {}. Get its tasks with `omicron tasks mine`. The next Claude started in {} links itself.",
        project.name,
        folder.display()
    );
    Ok(())
}

/// One of this machine's sessions, by its record: jump in if it's running.
/// A record whose Claude stopped unseen (a crash) ends, and says so.
fn jump_in(board: &omicron::board::Board, s: &omicron::board::SessionRecord) -> Result<()> {
    if omicron::host::is_running(&s.name) {
        return attach_here(&s.name);
    }
    board.end_session(&s.id)?;
    bail!("{} had stopped, so it's ended. `omicron open` starts a new one (`--resume {}` picks its conversation up).", s.name, s.claude_session_id.as_deref().unwrap_or("<id>"))
}

/// Jump into a running session in this terminal, if there is one.
fn attach_here(name: &str) -> Result<()> {
    if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        println!("{name} is running. Jump in with `omicron open {name}`.");
        return Ok(());
    }
    if omicron::host::attach(name)? {
        eprintln!("{name} ended.");
    }
    Ok(())
}

/// The command that runs Claude Code for a session: a new conversation
/// (`--session-id`) or an old one (`--resume`), with Omicron's hooks and
/// add-on.
pub fn claude_command(name: &str, claude_id: &str, resume: bool) -> Result<Vec<String>> {
    let settings = omicron_claude_settings()?;
    let mut command = vec!["claude".to_string()];
    command.extend([if resume { "--resume" } else { "--session-id" }.to_string(), claude_id.to_string()]);
    command.extend(["--name".into(), name.to_string(), "--settings".into(), settings.to_string_lossy().into_owned()]);
    command.extend(["--plugin-dir".into(), addon_dir()?.to_string_lossy().into_owned()]);
    command.extend(omicron::config::Config::load()?.claude_args);
    Ok(command)
}

/// A new session's name: asked for in a terminal (Enter takes the
/// suggestion, the folder's name), otherwise the suggestion.
fn ask_name(suggested: Option<&str>) -> Result<String> {
    use std::io::{BufRead, IsTerminal, Write};
    if !std::io::stdin().is_terminal() {
        return suggested.map(String::from).context("give it a name: omicron open <name>");
    }
    loop {
        match suggested {
            Some(s) => eprint!("Name for the session ({s}): "),
            None => eprint!("Name for the session: "),
        }
        std::io::stderr().flush()?;
        let mut line = String::new();
        if std::io::stdin().lock().read_line(&mut line)? == 0 {
            bail!("no name given");
        }
        match (line.trim(), suggested) {
            ("", Some(s)) => return Ok(s.to_string()),
            ("", None) => continue,
            (n, _) => return Ok(n.to_string()),
        }
    }
}
