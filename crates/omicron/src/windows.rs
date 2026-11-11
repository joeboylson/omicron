//! Which Claude Code window a command runs in, kept on this machine.
//!
//! Claude Code runs our hooks (SessionStart, SessionEnd) and the commands a
//! session types, all as child processes of the Claude process. So the Claude
//! process's id names the window, and we keep, per window, Claude's current
//! session id and the Omicron session it belongs to, if any. `/clear` keeps
//! the window and gives it a new Claude session id, so the Omicron session
//! carries on.
//!
//! Saved in `~/.omicron/windows.json`. Windows whose process has ended are
//! dropped when the file is next read (and their Omicron session marked gone
//! by the caller, if it was still open).

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::process::Command;

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Windows {
    #[serde(default)]
    pub windows: BTreeMap<u32, Window>,
    /// Claude session id → Omicron session id, kept after a window closes,
    /// so `claude --resume` in a new window picks the Omicron session back up.
    #[serde(default)]
    pub links: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Window {
    pub claude_session_id: String,
    #[serde(default)]
    pub folder: String,
    /// The Omicron session this window is, once added.
    #[serde(default)]
    pub session_id: Option<String>,
    /// Set by SessionEnd with reason "clear": a new Claude session follows.
    #[serde(default)]
    pub clearing: bool,
}

fn path() -> Result<std::path::PathBuf> {
    Ok(crate::config::home()?.join("windows.json"))
}

impl Windows {
    pub fn load() -> Result<Windows> {
        match std::fs::read_to_string(path()?) {
            Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Windows::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self) -> Result<()> {
        let path = path()?;
        std::fs::create_dir_all(path.parent().unwrap())?;
        // Write then rename, so two hooks at once can't leave half a file.
        let tmp = path.with_extension(format!("tmp{}", std::process::id()));
        std::fs::write(&tmp, serde_json::to_string_pretty(self)?)?;
        std::fs::rename(tmp, path)?;
        Ok(())
    }

    /// Drop windows whose Claude process has ended. Returns the Omicron
    /// sessions they were, so the caller can mark them gone.
    pub fn sweep(&mut self) -> Vec<String> {
        let dead: Vec<u32> = self.windows.keys().copied().filter(|pid| !alive(*pid)).collect();
        dead.into_iter().filter_map(|pid| self.windows.remove(&pid).and_then(|w| w.session_id)).collect()
    }
}

/// The Claude window this process runs in: `OMICRON_CLAUDE_PID` if set
/// (tests), else the nearest ancestor that is a Claude Code process, else
/// the nearest ancestor `known` lists.
pub fn this_window(known: &Windows) -> Result<Option<u32>> {
    if let Some(pid) = std::env::var("OMICRON_CLAUDE_PID").ok().and_then(|p| p.parse().ok()) {
        return Ok(Some(pid));
    }
    let chain = ancestors()?;
    if let Some((pid, _)) = chain.iter().find(|(_, args)| is_claude(args)) {
        return Ok(Some(*pid));
    }
    Ok(chain.iter().map(|(pid, _)| *pid).find(|pid| known.windows.contains_key(pid)))
}

/// A Claude Code process: its program is `claude`, or lives in Claude's
/// install folder (`.../claude/versions/2.1.0`), or is node running Claude.
fn is_claude(args: &str) -> bool {
    let mut words = args.split_whitespace();
    let program = words.next().unwrap_or("");
    let name = program.rsplit('/').next().unwrap_or("");
    // A script run through its interpreter shows as `sh /path/claude ...`.
    let script = matches!(name, "sh" | "bash" | "zsh")
        && words.next().is_some_and(|w| w.rsplit('/').next() == Some("claude"));
    name == "claude" || script || program.contains("/claude/versions/") || (name == "node" && args.contains("claude-code"))
}

/// Parent process ids and command lines, nearest first.
fn ancestors() -> Result<Vec<(u32, String)>> {
    let mut chain = Vec::new();
    let mut pid = std::process::id();
    for _ in 0..20 {
        let out = Command::new("ps").args(["-o", "ppid=", "-p", &pid.to_string()]).output().context("couldn't run ps")?;
        let ppid: u32 = match String::from_utf8_lossy(&out.stdout).trim().parse() {
            Ok(p) if p > 1 => p,
            _ => break,
        };
        let out = Command::new("ps").args(["-o", "args=", "-p", &ppid.to_string()]).output()?;
        chain.push((ppid, String::from_utf8_lossy(&out.stdout).trim().to_string()));
        pid = ppid;
    }
    Ok(chain)
}

/// Mark an Omicron session busy (a prompt went in) or free (its turn
/// ended). Kept as a file per session in `~/.omicron/run/busy/`, so the
/// daemon can tell when it's free to type a loop's prompt in.
pub fn set_busy(session_id: &str, busy: bool) -> Result<()> {
    let dir = crate::config::home()?.join("run/busy");
    let file = dir.join(session_id);
    if busy {
        std::fs::create_dir_all(&dir)?;
        std::fs::write(file, "")?;
    } else {
        match std::fs::remove_file(file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.into()),
            _ => {}
        }
    }
    Ok(())
}

pub fn is_busy(session_id: &str) -> bool {
    crate::config::home().is_ok_and(|h| h.join("run/busy").join(session_id).exists())
}

/// Why a session is gone when its window stopped without saying.
pub const STOPPED: &str = "it stopped without saying (a crash or a restart)";
/// Why a session is gone when its conversation was deleted.
pub const DELETED: &str = "its conversation was deleted";

/// Is Claude Code's transcript of this conversation still on this machine?
/// It's `<id>.jsonl` in one of the folders under `~/.claude/projects`
/// (or `$CLAUDE_CONFIG_DIR/projects`). Without it, the conversation can't
/// be reopened.
pub fn transcript_exists(claude_session_id: &str) -> bool {
    let base = match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) => std::path::PathBuf::from(dir),
        None => match std::env::var_os("HOME") {
            Some(home) => std::path::PathBuf::from(home).join(".claude"),
            // Can't tell: don't call it deleted.
            None => return true,
        },
    };
    let Ok(folders) = std::fs::read_dir(base.join("projects")) else { return false };
    let file = format!("{claude_session_id}.jsonl");
    folders.flatten().any(|f| f.path().join(&file).is_file())
}

fn alive(pid: u32) -> bool {
    Command::new("ps")
        .args(["-o", "pid=", "-p", &pid.to_string()])
        .output()
        .map(|o| !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::is_claude;

    #[test]
    fn spots_claude_code_processes() {
        assert!(is_claude("/Users/pat/.local/share/claude/versions/2.1.317 --resume"));
        assert!(is_claude("claude remote-control --name x"));
        assert!(is_claude("/usr/local/bin/claude"));
        assert!(is_claude("/bin/sh /home/pat/bin/claude --name x"));
        assert!(!is_claude("/bin/sh -c claude"));
        assert!(is_claude("node /usr/lib/node_modules/@anthropic-ai/claude-code/cli.js"));
        assert!(!is_claude("/bin/zsh -l"));
        assert!(!is_claude("sh -c omicron hook session-start"));
        assert!(!is_claude("vim claude-notes.md"));
    }
}
