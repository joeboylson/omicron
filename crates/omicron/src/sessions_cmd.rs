//! `omicron sessions` and the Claude Code hooks that keep sessions' records
//! up to date. Omicron doesn't start sessions: you open Claude Code as usual,
//! and `omicron sessions add` (run inside it) records it.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use clap::Subcommand;
use omicron::windows::{this_window, Window, Windows};
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;

#[derive(Subcommand)]
pub enum Sessions {
    /// Start a new Claude session in a Project, in Omicron's session host
    /// (asks for whatever isn't given), and jump into it
    New {
        /// Its name, like `parser-work`. The Claude session gets it too.
        name: Option<String>,
        #[arg(long)]
        project: Option<String>,
        /// The folder to work in (this one if left out)
        #[arg(long)]
        folder: Option<PathBuf>,
        /// Start it without jumping in
        #[arg(long)]
        no_attach: bool,
        /// Bring in an existing conversation (Claude Code's session id)
        /// instead of starting a new one
        #[arg(long)]
        resume: Option<String>,
    },
    /// Pick one of this machine's sessions from a full-screen list and jump
    /// in (a closed one is reopened first)
    Pick,
    /// Record the Claude session this runs in, under a Project
    Add {
        /// A name for it, like `parser-work`
        name: String,
        #[arg(long)]
        project: String,
    },
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
    /// Give a session's open tasks to a member or to another session (for a
    /// session that's gone)
    GiveTasks {
        name: String,
        #[arg(long)]
        project: String,
        /// A member of the Project, by name
        #[arg(long, conflicts_with = "to_session", required_unless_present = "to_session")]
        to: Option<String>,
        /// Another session in the Project
        #[arg(long)]
        to_session: Option<String>,
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
    /// Type text into a hosted session (add \r to press Enter)
    Send { name: String, text: String },
    /// The hosted sessions running on this machine
    Hosted,
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

#[derive(Subcommand)]
pub enum Hook {
    /// Claude Code's SessionStart hook
    SessionStart,
    /// Claude Code's SessionEnd hook
    SessionEnd,
    /// Claude Code's Stop hook: the turn ended (passes on chat that names
    /// the session)
    Stop,
    /// Claude Code's UserPromptSubmit hook: a turn started
    Prompt,
}

pub fn sessions(cmd: Sessions, as_machine: bool) -> Result<()> {
    match cmd {
        Sessions::New { name, project, folder, no_attach, resume } => new_session(name, project, folder, no_attach, resume)?,
        Sessions::Add { name, project } => {
            let mut windows = Windows::load()?;
            let pid = this_window(&windows)?.context("run this inside a Claude Code session")?;
            let window = windows.windows.get(&pid).cloned().context(
                "Omicron hasn't heard from this Claude session. Run `omicron sessions setup-claude`, then restart Claude Code.",
            )?;
            if window.session_id.is_some() {
                bail!("this window is already a session. Remove it first to add it again.");
            }
            // Sessions belong to the machine they run on.
            let board = sign_in(true)?;
            let project = board.project(&project)?;
            let record = board.add_session(&project, &name, &window.claude_session_id, &window.folder)?;
            windows.links.insert(window.claude_session_id.clone(), record.id.clone());
            windows.windows.insert(pid, Window { session_id: Some(record.id), ..window });
            windows.save()?;
            println!("Added session {name} to {}.", project.name);
        }
        Sessions::List { project } => {
            let board = sign_in(as_machine)?;
            let project = project.map(|p| board.project(&p)).transpose()?;
            let rows = board.sessions(project.as_ref())?;
            if rows.is_empty() {
                println!("No sessions yet. In a Claude Code session, run `omicron sessions add <name> --project <Project>`.");
            }
            for s in rows {
                let why = s.gone_why.map(|w| format!("\t({w})")).unwrap_or_default();
                println!("{}\t{}\t{}\t{}\t{}{why}", s.name, s.project, s.machine, s.state, s.folder);
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
        Sessions::GiveTasks { name, project, to, to_session } => {
            let board = sign_in(as_machine)?;
            let p = board.project(&project)?;
            let n = board.give_session_tasks(&p, &name, to.as_deref(), to_session.as_deref())?;
            let who = to.or(to_session).unwrap_or_default();
            match n {
                0 => println!("{name} has no open tasks."),
                1 => println!("Gave {name}'s open task to {who}."),
                n => println!("Gave {name}'s {n} open tasks to {who}."),
            }
        }
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
        Sessions::Send { name, text } => {
            let text = text.replace("\\r", "\r").replace("\\n", "\n");
            omicron::host::send(&name, &text)?;
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
            println!("Added Omicron's hooks to {}. Restart open Claude Code sessions to pick them up.", path.display());
            println!("Added the /omicron-handoff command ({}).", skill.display());
        }
    }
    Ok(())
}

/// Put our SessionStart and SessionEnd hooks in a Claude Code settings file,
/// replacing older ones (the program may have moved). Other settings and
/// other hooks are left as they are.
pub fn add_hooks(path: &std::path::Path, exe: &str) -> Result<()> {
    let mut settings: Value = match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).with_context(|| format!("{} isn't valid JSON", path.display()))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(e) => return Err(e.into()),
    };
    if !settings.is_object() {
        bail!("{} isn't a JSON object", path.display());
    }
    let hooks = settings.as_object_mut().unwrap().entry("hooks").or_insert_with(|| json!({}));
    for (event, arg) in [("SessionStart", "session-start"), ("SessionEnd", "session-end"), ("Stop", "stop"), ("UserPromptSubmit", "prompt")] {
        let list = hooks.as_object_mut().context("`hooks` isn't an object")?.entry(event).or_insert_with(|| json!([]));
        let list = list.as_array_mut().with_context(|| format!("`hooks.{event}` isn't a list"))?;
        list.retain(|group| !is_ours(group));
        list.push(json!({ "hooks": [{ "type": "command", "command": format!("{} hook {arg}", shell_quote(exe)) }] }));
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(&settings)? + "\n")?;
    Ok(())
}

/// The /omicron-handoff skill, next to the settings file. Replaced each time,
/// so it follows the program's version.
const HANDOFF_SKILL: &str = include_str!("claude/omicron-handoff.md");

pub fn add_skill(claude_dir: &std::path::Path) -> Result<PathBuf> {
    let dir = claude_dir.join("skills/omicron-handoff");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("SKILL.md");
    std::fs::write(&path, HANDOFF_SKILL)?;
    Ok(path)
}

fn is_ours(group: &Value) -> bool {
    group["hooks"].as_array().is_some_and(|hs| {
        hs.iter().any(|h| h["command"].as_str().is_some_and(|c| c.contains("omicron") && c.contains(" hook ")))
    })
}

fn shell_quote(s: &str) -> String {
    if s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

/// Run a hook. A hook must never get in Claude's way, so problems are only
/// printed, and it always finishes cleanly.
pub fn hook(event: Hook) -> Result<()> {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    match run_hook(event, &input) {
        Ok(Some(out)) => println!("{out}"),
        Ok(None) => {}
        Err(e) => eprintln!("omicron: {e:#}"),
    }
    Ok(())
}

/// What a session is told about the tasks given to it. `new` marks the ones
/// it hadn't been given before.
pub fn tasks_message(tasks: &[(String, omicron::board::Task)], new: &[String]) -> String {
    let mut text = format!(
        "Omicron: {} given to this session.\n",
        if tasks.len() == 1 { "1 task is".to_string() } else { format!("{} tasks are", tasks.len()) }
    );
    for (project, t) in tasks {
        let mark = if new.contains(&t.id) { " (new)" } else { "" };
        text.push_str(&format!("\n#{} in {project}: {}{mark}\n", t.number, t.title));
        if !t.notes.is_empty() {
            text.push_str(&format!("{}\n", t.notes));
        }
        text.push_str(&format!(
            "Full task: `omicron tasks show '{project}' {n} --as-machine`. When it's done, report on it and mark it for review: `omicron tasks comment '{project}' {n} \"<what you did>\" --review --as-machine`.\n",
            n = t.number
        ));
    }
    text.push_str(REPORT_RULES);
    text
}

/// How a session writes its report, said with every task handed over.
pub const REPORT_RULES: &str = "\nHow to write the report: short and plain, like a /s answer. No jargon and no made-up terms; say what changed and what's left in everyday words. At most 500 words (longer reports are refused).\n";

/// The most words a report (a comment marked for review) may have.
pub const REPORT_WORDS: usize = 500;

/// Returns what to print for Claude Code, if anything.
fn run_hook(event: Hook, input: &str) -> Result<Option<String>> {
    let input: Value = serde_json::from_str(input).context("the hook's input isn't JSON")?;
    let claude_id = input["session_id"].as_str().context("the hook's input has no session_id")?.to_string();
    if let Hook::Stop = event {
        // A team member whose conversation is getting full hands it over.
        if let Some(reason) = crate::teams_run::handover_reason(&input)? {
            return Ok(Some(json!({ "decision": "block", "reason": reason }).to_string()));
        }
    }
    let mut windows = Windows::load()?;
    // Stop and Prompt run every turn, in every window: they only read.
    let every_turn = matches!(event, Hook::Stop | Hook::Prompt);
    let gone = if every_turn { Vec::new() } else { windows.sweep() };
    let Some(pid) = this_window(&windows)? else {
        if !every_turn {
            windows.save()?;
        }
        return Ok(None);
    };
    if let Hook::Prompt = event {
        // A turn started: busy until it ends (for loops).
        if let Some(id) = windows.windows.get(&pid).and_then(|w| w.session_id.clone()) {
            omicron::windows::set_busy(&id, true)?;
        }
        return Ok(None);
    }
    if let Hook::Stop = event {
        // The common case, each turn: nothing tracked, nothing to do.
        let Some(id) = windows.windows.get(&pid).and_then(|w| w.session_id.clone()) else {
            return Ok(None);
        };
        // The turn is over: free for a loop's next prompt. First, so a
        // failure below can't leave it marked busy.
        omicron::windows::set_busy(&id, false)?;
        // Tasks aren't handed over here: a session only gets them when told
        // (`omicron tasks mine`) or by Dispatch. Chat that names it is a
        // message, and is passed on.
        let board = sign_in(true)?;
        let (project, mentions) = board.take_chat_mentions(&id)?;
        let mut reason = Vec::new();
        if !mentions.is_empty() {
            let mut text = format!("Omicron: you were named in {project}'s chat.\n");
            for m in &mentions {
                text.push_str(&format!("\n{}", crate::chat_cmd::line(m)));
            }
            text.push_str(&format!("\n\nAnswer with `omicron chat send '{project}' \"...\" --as-machine`, or read more with `omicron chat read '{project}' --as-machine`.\n"));
            reason.push(text);
        }
        if reason.is_empty() {
            return Ok(None);
        }
        // Blocking the stop makes Claude carry on, with this as the reason:
        // still busy.
        omicron::windows::set_busy(&id, true)?;
        return Ok(Some(json!({ "decision": "block", "reason": reason.join("\n\n") }).to_string()));
    }
    let mut pick_up = None;
    // After /clear, the window's waiting handoff note goes to the new
    // conversation. When the window closes, it's cancelled.
    let mut handoff = None;
    let mut cancel_handoff = None;
    // What to tell Supabase, if anything. Untracked windows never call it.
    let mut updates: Vec<(String, Value)> = gone.into_iter().map(|id| (id, json!({ "state": "gone", "gone_why": omicron::windows::STOPPED }))).collect();
    match event {
        Hook::SessionStart => {
            let folder = input["cwd"].as_str().unwrap_or("").to_string();
            // A /clear in a tracked window, or `claude --resume` of a
            // tracked conversation in a new one.
            let session_id = windows
                .windows
                .get(&pid)
                .and_then(|w| w.session_id.clone())
                .or_else(|| windows.links.get(&claude_id).cloned());
            if let Some(id) = &session_id {
                windows.links.insert(claude_id.clone(), id.clone());
                updates.push((id.clone(), json!({ "claude_session_id": claude_id, "folder": folder, "state": "open" })));
                pick_up = Some(id.clone());
                if input["source"] == "clear" {
                    handoff = Some(id.clone());
                }
            }
            windows.windows.insert(pid, Window { claude_session_id: claude_id, folder, session_id, clearing: false });
        }
        Hook::Stop | Hook::Prompt => unreachable!(),
        Hook::SessionEnd => {
            if input["reason"] == "clear" {
                // The window stays; SessionStart follows with the new id.
                if let Some(w) = windows.windows.get_mut(&pid) {
                    w.clearing = true;
                }
            } else if let Some(w) = windows.windows.remove(&pid) {
                if let Some(id) = w.session_id {
                    omicron::windows::set_busy(&id, false)?;
                    updates.push((id.clone(), json!({ "state": "closed" })));
                    cancel_handoff = Some(id);
                }
            }
        }
    }
    windows.save()?;
    if updates.is_empty() && pick_up.is_none() {
        return Ok(None);
    }
    let board = sign_in(true)?;
    for (id, change) in updates {
        board.update_session(&id, change)?;
    }
    if let Some(id) = cancel_handoff {
        board.cancel_waiting_handoff(&id)?;
    }
    // A conversation starting gets its handoff note and the tasks waiting
    // for it.
    let mut context = Vec::new();
    if let Some(id) = handoff {
        if let Some(note) = board.waiting_handoff(&id)? {
            board.set_handoff_state(&note.id, "picked_up")?;
            context.push(format!(
                "{}\nPick up from here: check the real state first (git status, anything still running), then carry on.",
                crate::handoff_cmd::note_text(&note)
            ));
        }
    }
    let _ = pick_up;
    if context.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        json!({ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": context.join("\n\n") } }).to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hooks_are_added_once_and_other_settings_are_kept() {
        let dir = std::env::temp_dir().join(format!("omicron-hooks-{}", uuid::Uuid::new_v4().simple()));
        let path = dir.join("settings.json");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            &path,
            r#"{"model":"opus","hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"lethe hook start"}]}]}}"#,
        )
        .unwrap();
        add_hooks(&path, "/old/omicron").unwrap();
        add_hooks(&path, "/new place/omicron").unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v["model"], "opus");
        let start = v["hooks"]["SessionStart"].as_array().unwrap();
        assert_eq!(start.len(), 2, "{start:?}");
        assert_eq!(start[0]["hooks"][0]["command"], "lethe hook start");
        assert_eq!(start[1]["hooks"][0]["command"], "'/new place/omicron' hook session-start");
        assert_eq!(v["hooks"]["SessionEnd"].as_array().unwrap().len(), 1);
        assert_eq!(v["hooks"]["Stop"][0]["hooks"][0]["command"], "'/new place/omicron' hook stop");
        let skill = add_skill(&dir).unwrap();
        assert!(std::fs::read_to_string(skill).unwrap().starts_with("---\nname: omicron-handoff\n"));
    }
}

/// Omicron's own Claude Code settings file, with its hooks: sessions it
/// starts load it with `claude --settings`, so Claude Code's settings are
/// left alone.
pub fn omicron_claude_settings() -> Result<PathBuf> {
    let path = omicron::config::home()?.join("claude/settings.json");
    let exe = std::env::current_exe()?.canonicalize()?;
    add_hooks(&path, &exe.to_string_lossy())?;
    Ok(path)
}

fn ask(question: &str) -> Result<String> {
    use std::io::{BufRead, IsTerminal, Write};
    if !std::io::stdin().is_terminal() {
        bail!("{question} (give it as an option when there's no one to ask)");
    }
    eprint!("{question} ");
    std::io::stderr().flush()?;
    let mut line = String::new();
    std::io::stdin().lock().read_line(&mut line)?;
    Ok(line.trim().to_string())
}

/// `omicron sessions new`: record the session, then start Claude Code in the
/// session host with that name and session id. Its start hook links the
/// window to the record, so /clear and closing are followed as usual.
fn new_session(
    name: Option<String>,
    project: Option<String>,
    folder: Option<PathBuf>,
    no_attach: bool,
    resume: Option<String>,
) -> Result<()> {
    // Sessions belong to the machine they run on.
    let board = sign_in(true)?;
    let project = match project {
        Some(p) => board.project(&p)?,
        None => {
            let all = board.projects()?;
            if all.is_empty() {
                bail!("this machine isn't in any Project yet. Add it with `omicron machines add <machine> <Project>`.");
            }
            for (i, p) in all.iter().enumerate() {
                eprintln!("{}. {}", i + 1, p.name);
            }
            let n: usize = ask("Which Project?")?.parse().context("type the Project's number")?;
            all.into_iter().nth(n.wrapping_sub(1)).context("there's no Project with that number")?
        }
    };
    let name = match name {
        Some(n) => n,
        None => ask("Name for the session (like parser-work):")?,
    };
    // Check the name works for the host before recording anything.
    omicron::host::socket_path(&name)?;
    if omicron::host::is_running(&name) {
        bail!("a session called {name} is already running on this machine");
    }
    let folder = match folder {
        Some(f) => f.canonicalize().with_context(|| format!("there's no folder {}", f.display()))?,
        None => std::env::current_dir()?,
    };
    if let Some(id) = &resume {
        uuid::Uuid::parse_str(id).context("--resume takes Claude Code's session id (a UUID)")?;
        if !omicron::windows::transcript_exists(id) {
            bail!("there's no conversation {id} on this machine");
        }
    }
    let claude_id = resume.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let record = board.add_session(&project, &name, &claude_id, &folder.to_string_lossy())?;
    let mut windows = Windows::load()?;
    windows.links.insert(claude_id.clone(), record.id.clone());
    windows.save()?;
    let command = claude_command(&name, &claude_id, resume.is_some(), None)?;
    if let Err(e) = omicron::host::start(&name, &folder, &command, &[]) {
        // Don't leave a record for a session that never started.
        let _ = board.remove_session(&project, &name);
        return Err(e);
    }
    println!("Started {name} in {} on this machine.", project.name);
    if no_attach || !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        println!("Jump in with `omicron sessions attach {name}`.");
        return Ok(());
    }
    omicron::host::attach(&name)?;
    Ok(())
}

/// The command that runs Claude Code for a session in the host: a new
/// conversation (`--session-id`) or an old one (`--resume`), with Omicron's
/// hooks and an optional first message.
pub fn claude_command(name: &str, claude_id: &str, resume: bool, first: Option<&str>) -> Result<Vec<String>> {
    let settings = omicron_claude_settings()?;
    let mut command = vec!["claude".to_string()];
    command.extend([if resume { "--resume" } else { "--session-id" }.to_string(), claude_id.to_string()]);
    command.extend(["--name".into(), name.to_string(), "--settings".into(), settings.to_string_lossy().into_owned()]);
    command.extend(omicron::config::Config::load()?.claude_args);
    if let Some(text) = first {
        command.push(text.to_string());
    }
    Ok(command)
}

/// Reopen a session that isn't running, in the host on this machine, with
/// an optional first message. Refuses when it's open in a window Omicron
/// doesn't host, gone for good (not just crashed), or its conversation or
/// folder is gone (marking it gone then).
pub fn reopen(board: &omicron::board::Board, session: &omicron::board::SessionRecord, machine: &str, first: Option<&str>) -> Result<()> {
    let name = &session.name;
    let mut windows = Windows::load()?;
    let gone = windows.sweep();
    if windows.windows.values().any(|w| w.session_id.as_deref() == Some(session.id.as_str())) {
        bail!("{name} is open in a window Omicron doesn't host");
    }
    for g in gone {
        board.update_session(&g, json!({ "state": "gone", "gone_why": omicron::windows::STOPPED }))?;
    }
    if session.state == "gone" && session.gone_why.as_deref() != Some(omicron::windows::STOPPED) {
        bail!("{name} is gone ({}), so it can't be opened. Give its work to someone else.", session.gone_why.as_deref().unwrap_or("no reason saved"));
    }
    let folder = PathBuf::from(&session.folder);
    if session.folder.is_empty() || !folder.is_dir() {
        bail!("{name}'s folder ({}) isn't on {machine} any more", session.folder);
    }
    let (claude_id, resume) = match &session.claude_session_id {
        Some(id) if !omicron::windows::transcript_exists(id) => {
            board.update_session(&session.id, json!({ "state": "gone", "gone_why": omicron::windows::DELETED }))?;
            bail!("{name}'s conversation was deleted on {machine}, so it can't be reopened. Give its work to someone else.");
        }
        Some(id) => (id.clone(), true),
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            board.update_session(&session.id, json!({ "claude_session_id": id }))?;
            (id, false)
        }
    };
    let command = claude_command(name, &claude_id, resume, first)?;
    // So the start hook ties the new window to this session.
    windows.links.insert(claude_id, session.id.clone());
    windows.save()?;
    omicron::host::start(name, &folder, &command, &[])
}

/// `omicron tasks mine`: "go get your tasks". Everything given to the
/// session this runs in that isn't done, marking the new ones picked up.
pub fn tasks_mine() -> Result<()> {
    let windows = Windows::load()?;
    let session_id = this_window(&windows)?
        .and_then(|pid| windows.windows.get(&pid))
        .and_then(|w| w.session_id.clone())
        .context("run this inside a Claude session Omicron tracks (`omicron sessions add` or `omicron sessions new`)")?;
    let board = sign_in(true)?;
    let new: Vec<String> = board.pick_up_tasks(&session_id)?.into_iter().map(|(_, t)| t.id).collect();
    let tasks = board.session_tasks(&session_id)?;
    if tasks.is_empty() {
        println!("Nothing is given to this session right now.");
    } else {
        print!("{}", tasks_message(&tasks, &new));
    }
    Ok(())
}
