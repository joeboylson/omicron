//! Following `/rename`: Claude Code writes the new name into the session's
//! transcript as a `custom-title` line. Omicron's hooks at each prompt and
//! each turn's end, in the session's own window, read what's been added to
//! its transcript since they last looked and rename the Omicron session to
//! match. (A /rename with no turn after it shows at the next prompt.)

use crate::board::Board;
use anyhow::Result;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

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

/// How far a conversation's transcript has been read, and the name last
/// given from it: kept in a file of its own per conversation (hooks run as
/// a new process each time).
#[derive(Default, serde::Serialize, serde::Deserialize)]
struct Followed {
    read_to: u64,
    named: Option<String>,
}

fn followed_path(claude_session_id: &str) -> Result<PathBuf> {
    Ok(crate::config::home()?.join("titles").join(format!("{claude_session_id}.json")))
}

/// From a hook in a tracked session's window: if a /rename was added to its
/// transcript since last time, rename the Omicron session `session_id`.
/// `board` is only signed in when there's a rename to make.
pub fn follow(board: impl FnOnce() -> Result<Board>, session_id: &str, claude_session_id: &str, transcript: &Path) -> Result<()> {
    let file = followed_path(claude_session_id)?;
    let mut f: Followed = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let (title, read_to) = new_title(transcript, f.read_to)?;
    let changed = read_to != f.read_to;
    f.read_to = read_to;
    let name = title.as_deref().and_then(title_to_name).filter(|n| f.named.as_ref() != Some(n));
    if let Some(name) = &name {
        rename(board()?, session_id, name);
        f.named = Some(name.clone());
    }
    if changed || name.is_some() {
        std::fs::create_dir_all(file.parent().unwrap())?;
        std::fs::write(&file, serde_json::to_string(&f)?)?;
    }
    Ok(())
}

/// Rename the session (if it isn't already), and its runner with it. A
/// refusal (the name's taken) is said, not tried again.
fn rename(board: Board, session_id: &str, name: &str) {
    let session = match board.session_by_id(session_id) {
        Ok(s) => s,
        Err(e) => return eprintln!("omicron: couldn't rename this session: {e:#}"),
    };
    if session.name == name {
        return;
    }
    if let Err(e) = board.rename_session(session_id, name) {
        return eprintln!("omicron: couldn't rename {} to {name}: {e:#}", session.name);
    }
    // A hosted session keeps answering under its new name.
    if let (Ok(old), Ok(new)) = (crate::host::socket_path(&session.name), crate::host::socket_path(name)) {
        if old.exists() && !new.exists() {
            let _ = std::fs::rename(old, new);
        }
    }
    eprintln!("omicron: renamed {} to {name} (/rename)", session.name);
}

/// The newest title in what's been added to `path` after `from`, and how
/// far it's now read (whole lines only; a half-written one is read next
/// time).
fn new_title(path: &Path, from: u64) -> Result<(Option<String>, u64)> {
    let len = std::fs::metadata(path)?.len();
    let from = from.min(len);
    if from == len {
        return Ok((None, from));
    }
    let mut file = std::fs::File::open(path)?;
    file.seek(SeekFrom::Start(from))?;
    let mut added = Vec::new();
    file.take(len - from).read_to_end(&mut added)?;
    let whole = added.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1);
    Ok((last_title(&String::from_utf8_lossy(&added[..whole])), from + whole as u64))
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

    #[test]
    fn only_whole_new_lines_are_read() {
        let dir = std::env::temp_dir().join(format!("omicron-names-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.jsonl");
        std::fs::write(&path, "{\"type\":\"custom-title\",\"customTitle\":\"one\"}\n{\"type\":\"custom-ti").unwrap();
        let (title, to) = new_title(&path, 0).unwrap();
        assert_eq!(title.as_deref(), Some("one"));
        // Nothing new, nothing found; the half line waits.
        assert_eq!(new_title(&path, to).unwrap().0, None);
        std::fs::write(&path, "{\"type\":\"custom-title\",\"customTitle\":\"one\"}\n{\"type\":\"custom-title\",\"customTitle\":\"two\"}\n").unwrap();
        assert_eq!(new_title(&path, to).unwrap().0.as_deref(), Some("two"));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
