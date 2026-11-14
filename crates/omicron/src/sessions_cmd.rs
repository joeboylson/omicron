//! `omicron open`, `omicron sessions` and the Claude Code hooks that keep
//! sessions' records up to date. Every session runs the same way: opened
//! in a terminal with `omicron open`, which records it and loads Omicron's
//! hooks and add-on. Messages for it (Dispatch, loops, `sessions send`) go
//! into its inbox, and the add-on puts them into its window.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use clap::Subcommand;
use omicron::windows::{this_window, Window, Windows};
use serde_json::{json, Value};
use std::io::Read;
use std::path::PathBuf;

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

#[derive(Subcommand)]
pub enum Hook {
    /// Claude Code's SessionStart hook
    SessionStart,
    /// Claude Code's SessionEnd hook
    SessionEnd,
    /// Claude Code's Stop hook: the turn ended
    Stop,
    /// Claude Code's UserPromptSubmit hook: a turn started
    Prompt,
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

/// Take Omicron's hooks out of a settings file, leaving the rest. Nothing
/// to do if there's no file.
pub fn remove_hooks(path: &std::path::Path) -> Result<()> {
    let Ok(text) = std::fs::read_to_string(path) else { return Ok(()) };
    let mut settings: Value = serde_json::from_str(&text).with_context(|| format!("{} isn't valid JSON", path.display()))?;
    if let Some(hooks) = settings["hooks"].as_object_mut() {
        for list in hooks.values_mut() {
            if let Some(list) = list.as_array_mut() {
                list.retain(|group| !is_ours(group));
            }
        }
        hooks.retain(|_, list| list.as_array().is_none_or(|l| !l.is_empty()));
        if hooks.is_empty() {
            settings.as_object_mut().unwrap().remove("hooks");
        }
    }
    std::fs::write(path, serde_json::to_string_pretty(&settings)? + "\n")?;
    Ok(())
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

/// A Project's run rules, said with its tasks: how to work on them, beside
/// the folder's CLAUDE.md.
pub fn rules_message(project: &str, rules: &str) -> String {
    if rules.trim().is_empty() {
        return format!("\n{project} has no run rules; follow this folder's CLAUDE.md.\n");
    }
    format!("\nRun rules for {project} (how to work on its tasks; this folder's CLAUDE.md applies too):\n{}\n", rules.trim())
}

/// How a session writes its report, said with every task handed over.
pub const REPORT_RULES: &str = "\nHow to write the report: short and plain, like a /s answer. No jargon and no made-up terms; say what changed and what's left in everyday words. At most 500 words (longer reports are refused).\n";

/// The most words a report (a comment marked for review) may have.
pub const REPORT_WORDS: usize = 500;

/// What a window starting or ending means, worked out from the hook's
/// input and the windows Omicron knows (which it updates), before anything
/// is said to Supabase.
#[derive(Debug, Default, PartialEq)]
struct WindowChange {
    /// Changes to sessions' records.
    updates: Vec<(String, Value)>,
    /// Sessions whose window closed: they end.
    ended: Vec<String>,
    /// A session whose waiting handoff note is cancelled (its window closed).
    cancel_handoff: Option<String>,
    /// A session whose waiting handoff note goes to its new conversation (/clear).
    handoff: Option<String>,
    /// What to tell a chat that just linked itself.
    linked: Option<String>,
    /// A session no longer busy (its window closed).
    free: Option<String>,
}

/// Work out a SessionStart or SessionEnd. `link` makes a session of a chat
/// that starts in one of this machine's folders: (its id, what to tell it).
fn plan_window_change(
    event: &Hook,
    input: &Value,
    claude_id: &str,
    pid: u32,
    windows: &mut Windows,
    link: impl FnOnce(&str, &str) -> Option<(String, String)>,
) -> WindowChange {
    let mut change = WindowChange::default();
    match event {
        Hook::SessionStart => {
            let folder = input["cwd"].as_str().unwrap_or("").to_string();
            // A /clear in a tracked window, or `claude --resume` of a
            // tracked conversation in a new one; or, failing those, a chat
            // starting in one of this machine's folders.
            let known = windows.windows.get(&pid).and_then(|w| w.session_id.clone()).or_else(|| windows.links.get(claude_id).cloned());
            let session_id = known.or_else(|| {
                link(claude_id, &folder).map(|(id, said)| {
                    change.linked = Some(said);
                    id
                })
            });
            if let Some(id) = &session_id {
                windows.links.insert(claude_id.to_string(), id.clone());
                change.updates.push((id.clone(), json!({ "claude_session_id": claude_id, "folder": folder, "state": "open" })));
                if input["source"] == "clear" {
                    change.handoff = Some(id.clone());
                }
            }
            windows.windows.insert(pid, Window { claude_session_id: claude_id.to_string(), folder, session_id, clearing: false });
        }
        Hook::SessionEnd => {
            if input["reason"] == "clear" {
                // The window stays; SessionStart follows with the new id.
                if let Some(w) = windows.windows.get_mut(&pid) {
                    w.clearing = true;
                }
            } else if let Some(id) = windows.windows.remove(&pid).and_then(|w| w.session_id) {
                change.free = Some(id.clone());
                change.cancel_handoff = Some(id.clone());
                change.ended.push(id);
            }
        }
        Hook::Stop | Hook::Prompt => {}
    }
    change
}

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
    if every_turn {
        if let (Some(id), Some(transcript)) = (windows.windows.get(&pid).and_then(|w| w.session_id.clone()), input["transcript_path"].as_str()) {
            // A /rename since last time renames the session here too.
            if let Err(e) = omicron::names::follow(|| sign_in(true), &id, &claude_id, std::path::Path::new(transcript)) {
                eprintln!("omicron: following /rename: {e:#}");
            }
        }
    }
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
        // The turn is over: free for a loop's next prompt. Tasks aren't
        // handed over here: a session only gets them when told (`omicron
        // tasks mine`) or by Dispatch.
        omicron::windows::set_busy(&id, false)?;
        return Ok(None);
    }
    let plan = plan_window_change(&event, &input, &claude_id, pid, &mut windows, |claude_id, folder| match link_in_folder(claude_id, folder) {
        Ok(linked) => linked,
        Err(e) => {
            eprintln!("omicron: couldn't link this chat: {e:#}");
            None
        }
    });
    if let Some(id) = &plan.free {
        omicron::windows::set_busy(id, false)?;
    }
    let (updates, mut ended, cancel_handoff, handoff, linked) = (plan.updates, plan.ended, plan.cancel_handoff, plan.handoff, plan.linked);
    ended.splice(0..0, gone);
    windows.save()?;
    if updates.is_empty() && ended.is_empty() && handoff.is_none() && linked.is_none() {
        return Ok(None);
    }
    let board = sign_in(true)?;
    for (id, change) in updates {
        board.update_session(&id, change)?;
    }
    if let Some(id) = cancel_handoff {
        board.cancel_waiting_handoff(&id)?;
    }
    for id in ended {
        board.end_session(&id)?;
    }
    // A conversation starting gets its handoff note and the tasks waiting
    // for it.
    let mut context: Vec<String> = linked.into_iter().collect();
    if let Some(id) = handoff {
        if let Some(note) = board.waiting_handoff(&id)? {
            board.set_handoff_state(&note.id, "picked_up")?;
            context.push(format!(
                "{}\nPick up from here: check the real state first (git status, anything still running), then carry on.",
                crate::handoff_cmd::note_text(&note)
            ));
        }
    }
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
    fn a_window_starting_clearing_and_closing_is_worked_out_before_supabase() {
        let mut w = Windows::default();
        w.links.insert("conv-1".into(), "s1".into());
        let no_link = |_: &str, _: &str| -> Option<(String, String)> { panic!("a known chat isn't linked again") };
        // A tracked conversation starts: its record says so.
        let c = plan_window_change(&Hook::SessionStart, &json!({ "cwd": "/w", "source": "startup" }), "conv-1", 7, &mut w, no_link);
        assert_eq!(c.updates, vec![("s1".to_string(), json!({ "claude_session_id": "conv-1", "folder": "/w", "state": "open" }))]);
        assert_eq!(c.handoff, None);
        // /clear: the same window, a new conversation that gets the note.
        let c = plan_window_change(&Hook::SessionEnd, &json!({ "reason": "clear" }), "conv-1", 7, &mut w, no_link);
        assert_eq!(c, WindowChange::default());
        assert!(w.windows[&7].clearing);
        let c = plan_window_change(&Hook::SessionStart, &json!({ "cwd": "/w", "source": "clear" }), "conv-2", 7, &mut w, no_link);
        assert_eq!(c.handoff.as_deref(), Some("s1"));
        assert_eq!(w.links.get("conv-2").map(String::as_str), Some("s1"));
        // Closed: it ends, free, and its waiting note is cancelled.
        let c = plan_window_change(&Hook::SessionEnd, &json!({ "reason": "prompt_input_exit" }), "conv-2", 7, &mut w, no_link);
        assert_eq!((c.ended, c.free.as_deref(), c.cancel_handoff.as_deref()), (vec!["s1".to_string()], Some("s1"), Some("s1")));
        assert!(w.windows.is_empty());
        // An unknown chat: linked if its folder is one of the machine's, told so.
        let c = plan_window_change(&Hook::SessionStart, &json!({ "cwd": "/app" }), "conv-3", 8, &mut w, |_, f| (f == "/app").then(|| ("s2".to_string(), "linked".to_string())));
        assert_eq!((c.linked.as_deref(), c.updates.len()), (Some("linked"), 1));
        // Anywhere else: nothing to say to Supabase.
        let c = plan_window_change(&Hook::SessionStart, &json!({ "cwd": "/tmp" }), "conv-4", 9, &mut w, |_, _| None);
        assert_eq!(c, WindowChange::default());
        assert_eq!(w.windows[&9].session_id, None);
    }

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
    add_addon(&exe.to_string_lossy())?;
    Ok(path)
}

const ADDON_PLUGIN: &str = include_str!("claude/addon/plugin.json");
const ADDON_HOOKS: &str = include_str!("claude/addon/hooks.json");
const ADDON_REGISTER: &str = include_str!("claude/addon/register.ts");

/// Omicron's add-on for Claude Code (`~/.omicron/claude/addon`), which puts
/// a session's inbox into its window. Replaced each time, so it follows
/// this program. Load it with `claude --plugin-dir <it>`.
pub fn add_addon(exe: &str) -> Result<PathBuf> {
    let dir = addon_dir()?;
    std::fs::create_dir_all(dir.join(".claude-plugin"))?;
    std::fs::create_dir_all(dir.join("hooks"))?;
    std::fs::write(dir.join(".claude-plugin/plugin.json"), ADDON_PLUGIN)?;
    std::fs::write(dir.join("hooks/hooks.json"), ADDON_HOOKS)?;
    std::fs::write(dir.join("hooks/register.ts"), ADDON_REGISTER.replace("__OMICRON__", &exe.replace('\\', "\\\\").replace('\'', "\\'")))?;
    Ok(dir)
}

pub fn addon_dir() -> Result<PathBuf> {
    Ok(omicron::config::home()?.join("claude/addon"))
}


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
        if let Ok(session) = std::env::var("OMICRON_SESSION") {
            bail!("this is already the session {session}. `omicron detach` lets go of it and leaves it running.");
        }
        let name = match name {
            Some(n) => n,
            None => std::env::current_dir()?.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_else(|| "<name>".into()),
        };
        let project = project.map(|p| format!(" --project {}", shell_quote(&p))).unwrap_or_default();
        bail!(
            "this starts Claude itself, so it can't run inside a Claude window. Quit this window (/exit), then run:\n  omicron open {}{project} --resume {}",
            shell_quote(&name),
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
fn link_in_folder(claude_id: &str, folder: &str) -> Result<Option<(String, String)>> {
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

/// `omicron tasks mine`: "go get your tasks". Everything given to the
/// session this runs in that isn't done, marking the new ones picked up.
pub fn tasks_mine() -> Result<()> {
    let windows = Windows::load()?;
    let session_id = this_window(&windows)?
        .and_then(|pid| windows.windows.get(&pid))
        .and_then(|w| w.session_id.clone())
        .context("run this inside a Claude session Omicron tracks (opened with `omicron open`)")?;
    let board = sign_in(true)?;
    // Only tasks given on this computer are handed over, or, while the gate
    // is open, ones from this machine's owner; the rest are only to read
    // (ref/BRAINSTORM.md, "The gate"). The database applies the same rule
    // when it marks them picked up, told only whether the gate is open.
    let orders = omicron::gate::Orders::new(&board);
    let new: Vec<String> = board.pick_up_tasks(&session_id, orders.gate_open())?.into_iter().map(|(_, t)| t.id).collect();
    let mut tasks = Vec::new();
    let mut to_read = Vec::new();
    for (s, t) in board.session_tasks(&session_id)? {
        if orders.takes(t.given_by.as_deref())? { tasks.push((s, t)) } else { to_read.push((s, t)) }
    }
    if tasks.is_empty() && to_read.is_empty() {
        println!("Nothing is given to this session right now.");
        return Ok(());
    }
    if !tasks.is_empty() {
        print!("{}", tasks_message(&tasks, &new));
        // Each Project's run rules, once.
        let mut seen: Vec<&str> = Vec::new();
        for (project, _) in &tasks {
            if seen.contains(&project.as_str()) {
                continue;
            }
            seen.push(project);
            let rules = board.run_rules(&board.project(project)?)?;
            print!("{}", rules_message(project, &rules));
        }
    }
    if !to_read.is_empty() {
        if !tasks.is_empty() {
            println!();
        }
        print!("{}", to_read_message(&to_read));
    }
    Ok(())
}

/// Tasks given to a session from elsewhere that it may not work on (not
/// from its machine's owner, or the gate is closed): titles only, to read.
pub fn to_read_message(tasks: &[(String, omicron::board::Task)]) -> String {
    let it = if tasks.len() == 1 { "it" } else { "them" };
    let mut text = format!(
        "Given to this session from elsewhere, only to read: don't work on {it}. This computer takes work from elsewhere only from its owner, while its gate is open. Hand {it} over on this computer (`omicron tasks send`), or have its owner give {it} with the gate open (`omicron gate open --until 17:00`).\n"
    );
    for (project, t) in tasks {
        text.push_str(&format!("#{} in {project}: {}\n", t.number, t.title));
    }
    text
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
