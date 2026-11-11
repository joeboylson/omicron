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
}

pub fn sessions(cmd: Sessions, as_machine: bool) -> Result<()> {
    match cmd {
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
                println!("{}\t{}\t{}\t{}\t{}", s.name, s.project, s.machine, s.state, s.folder);
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
        Sessions::SetupClaude { settings } => {
            let path = match settings {
                Some(p) => p,
                None => PathBuf::from(std::env::var_os("HOME").context("HOME isn't set")?).join(".claude/settings.json"),
            };
            let exe = std::env::current_exe()?.canonicalize()?;
            add_hooks(&path, &exe.to_string_lossy())?;
            println!("Added Omicron's hooks to {}. Restart open Claude Code sessions to pick them up.", path.display());
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
    for (event, arg) in [("SessionStart", "session-start"), ("SessionEnd", "session-end")] {
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

fn is_ours(group: &Value) -> bool {
    group["hooks"].as_array().is_some_and(|hs| {
        hs.iter().any(|h| h["command"].as_str().is_some_and(|c| c.contains("omicron") && c.contains(" hook session-")))
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
    if let Err(e) = run_hook(event, &input) {
        eprintln!("omicron: {e:#}");
    }
    Ok(())
}

fn run_hook(event: Hook, input: &str) -> Result<()> {
    let input: Value = serde_json::from_str(input).context("the hook's input isn't JSON")?;
    let claude_id = input["session_id"].as_str().context("the hook's input has no session_id")?.to_string();
    let mut windows = Windows::load()?;
    let gone = windows.sweep();
    let Some(pid) = this_window(&windows)? else {
        windows.save()?;
        return Ok(());
    };
    // What to tell Supabase, if anything. Untracked windows never call it.
    let mut updates: Vec<(String, Value)> = gone.into_iter().map(|id| (id, json!({ "state": "gone" }))).collect();
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
            }
            windows.windows.insert(pid, Window { claude_session_id: claude_id, folder, session_id, clearing: false });
        }
        Hook::SessionEnd => {
            if input["reason"] == "clear" {
                // The window stays; SessionStart follows with the new id.
                if let Some(w) = windows.windows.get_mut(&pid) {
                    w.clearing = true;
                }
            } else if let Some(w) = windows.windows.remove(&pid) {
                if let Some(id) = w.session_id {
                    updates.push((id, json!({ "state": "closed" })));
                }
            }
        }
    }
    windows.save()?;
    if !updates.is_empty() {
        let board = sign_in(true)?;
        for (id, change) in updates {
            board.update_session(&id, change)?;
        }
    }
    Ok(())
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
    }
}
