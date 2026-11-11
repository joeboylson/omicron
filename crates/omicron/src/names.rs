//! Following `/rename`: Claude Code writes the new name into the session's
//! transcript as a `custom-title` line. The daemon reads what's been added
//! to the transcripts of this machine's tracked sessions every few seconds
//! (local files only) and renames the Omicron session to match.

use crate::board::Board;
use anyhow::Result;
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;

/// A title as a session name: lowercase letters, numbers, - _ and . (what
/// the host allows), spaces and anything else as dashes. None if nothing's
/// left.
pub fn title_to_name(title: &str) -> Option<String> {
    let mut name = String::new();
    for c in title.trim().to_lowercase().chars() {
        if c.is_ascii_alphanumeric() || "_.".contains(c) {
            name.push(c);
        } else if !name.ends_with('-') {
            name.push('-');
        }
    }
    let name = name.trim_matches(|c| c == '-' || c == '.').chars().take(40).collect::<String>();
    let name = name.trim_end_matches('-').to_string();
    (!name.is_empty()).then_some(name)
}

/// The last title in `text` (whole lines of a transcript), if any.
pub fn last_title(text: &str) -> Option<String> {
    text.lines()
        .filter(|l| l.contains("\"custom-title\""))
        .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
        .filter(|v| v["type"] == "custom-title")
        .filter_map(|v| v["customTitle"].as_str().map(String::from))
        .last()
}

/// Where Claude Code keeps this conversation's transcript, if it's here.
pub fn transcript_path(claude_session_id: &str) -> Option<PathBuf> {
    let base = match std::env::var_os("CLAUDE_CONFIG_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(std::env::var_os("HOME")?).join(".claude"),
    };
    let file = format!("{claude_session_id}.jsonl");
    std::fs::read_dir(base.join("projects")).ok()?.flatten().map(|f| f.path().join(&file)).find(|p| p.is_file())
}

/// Follows transcripts, remembering how far each was read.
#[derive(Default)]
pub struct Follower {
    read_to: HashMap<PathBuf, u64>,
    /// Session id → the name it was last given here.
    named: HashMap<String, String>,
}

impl Follower {
    /// One look at every tracked session on this machine. `board` is only
    /// signed in when there's a rename to make.
    pub fn check(&mut self, board: impl Fn() -> Result<Board>) -> Result<()> {
        let windows = crate::windows::Windows::load()?;
        for w in windows.windows.values() {
            let Some(session_id) = &w.session_id else { continue };
            let Some(path) = transcript_path(&w.claude_session_id) else { continue };
            let Some(title) = self.new_title(&path)? else { continue };
            let Some(name) = title_to_name(&title) else { continue };
            if self.named.get(session_id) == Some(&name) {
                continue;
            }
            let board = board()?;
            let session = board.session_by_id(session_id)?;
            if session.name != name {
                if let Err(e) = board.update_session(session_id, serde_json::json!({ "name": name })) {
                    eprintln!("omicron daemon: couldn't rename {} to {name}: {e:#}", session.name);
                    self.named.insert(session_id.clone(), name);
                    continue;
                }
                // A hosted session keeps answering under its new name.
                if let (Ok(old), Ok(new)) = (crate::host::socket_path(&session.name), crate::host::socket_path(&name)) {
                    if old.exists() && !new.exists() {
                        let _ = std::fs::rename(old, new);
                    }
                }
                eprintln!("omicron daemon: renamed {} to {name} (/rename)", session.name);
            }
            self.named.insert(session_id.clone(), name);
        }
        Ok(())
    }

    /// The newest title in what's been added to `path` since last time.
    fn new_title(&mut self, path: &PathBuf) -> Result<Option<String>> {
        let len = std::fs::metadata(path)?.len();
        let from = self.read_to.get(path).copied().unwrap_or(0).min(len);
        if from == len {
            return Ok(None);
        }
        let mut file = std::fs::File::open(path)?;
        file.seek(SeekFrom::Start(from))?;
        let mut added = Vec::new();
        file.take(len - from).read_to_end(&mut added)?;
        // Only whole lines; a half-written one is read next time.
        let whole = added.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
        self.read_to.insert(path.clone(), from + whole as u64);
        Ok(last_title(&String::from_utf8_lossy(&added[..whole])))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_become_names() {
        assert_eq!(title_to_name("Parser Work").as_deref(), Some("parser-work"));
        assert_eq!(title_to_name("  fix: the #12 bug!! ").as_deref(), Some("fix-the-12-bug"));
        assert_eq!(title_to_name("web_page.v2").as_deref(), Some("web_page.v2"));
        assert_eq!(title_to_name("!!!"), None);
    }

    #[test]
    fn the_last_title_wins() {
        let text = "{\"type\":\"user\",\"message\":\"custom-title\"}\n\
                    {\"type\":\"custom-title\",\"customTitle\":\"first\",\"sessionId\":\"x\"}\n\
                    {\"type\":\"custom-title\",\"customTitle\":\"second\",\"sessionId\":\"x\"}\n";
        assert_eq!(last_title(text).as_deref(), Some("second"));
        assert_eq!(last_title("{\"type\":\"user\"}\n"), None);
    }
}
