//! This machine's folders (`omicron folders`), kept on this computer too:
//! the hook that runs when Claude starts looks here to see whether the chat
//! is in a Project's folder, without asking Supabase for every window.
//! Written whenever this machine's folders change here.

use anyhow::Result;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn path() -> Result<PathBuf> {
    Ok(crate::config::home()?.join("folders.json"))
}

/// Folder path → its Project's name.
pub fn load() -> BTreeMap<String, String> {
    path().ok().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

pub fn save(all: &BTreeMap<String, String>) -> Result<()> {
    let file = path()?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(file, serde_json::to_string_pretty(all)?)?;
    Ok(())
}

/// The known folder a path is in (itself, or inside it; the deepest), and its Project.
pub fn find(dir: &Path) -> Option<(String, String)> {
    load()
        .into_iter()
        .filter(|(folder, _)| dir == Path::new(folder) || dir.starts_with(folder))
        .max_by_key(|(folder, _)| folder.len())
}
