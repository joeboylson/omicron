//! Claude Code asks "Do you trust this folder?" the first time it opens in
//! a folder, and nothing is there to answer for a session Omicron starts in
//! the background (the default answer quits). Claude Code has no flag that
//! skips only that question; what's done instead is to set the folder's
//! `hasTrustDialogAccepted` in Claude Code's own file, `~/.claude.json` (or
//! `$CLAUDE_CONFIG_DIR/.claude.json`). Omicron does that for the folders it
//! starts Claude in, and only those: one exact folder at a time, never a
//! folder above it, and never the home folder.

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Claude Code's own file.
pub fn config_file() -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR").filter(|d| !d.is_empty()) {
        return Ok(PathBuf::from(dir).join(".claude.json"));
    }
    Ok(PathBuf::from(std::env::var_os("HOME").context("HOME isn't set")?).join(".claude.json"))
}

/// The names Claude Code may know a folder by: as given, and with links
/// resolved (`/tmp` is `/private/tmp` on a Mac).
fn names(folder: &Path) -> Vec<String> {
    let mut all = vec![folder.to_string_lossy().trim_end_matches('/').to_string()];
    if let Ok(real) = folder.canonicalize() {
        let real = real.to_string_lossy().to_string();
        if !all.contains(&real) {
            all.push(real);
        }
    }
    all
}

/// Is this exact folder trusted?
pub fn is_trusted(config: &Value, folder: &Path) -> bool {
    names(folder).iter().any(|n| config["projects"][n]["hasTrustDialogAccepted"] == json!(true))
}

/// Mark the folder trusted in `config`. Returns whether anything changed.
pub fn mark(config: &mut Value, folder: &Path) -> bool {
    if is_trusted(config, folder) {
        return false;
    }
    if !config.is_object() {
        *config = json!({});
    }
    let projects = config.as_object_mut().unwrap().entry("projects").or_insert_with(|| json!({}));
    if !projects.is_object() {
        *projects = json!({});
    }
    for n in names(folder) {
        let entry = projects.as_object_mut().unwrap().entry(n).or_insert_with(|| json!({}));
        if !entry.is_object() {
            *entry = json!({});
        }
        entry["hasTrustDialogAccepted"] = json!(true);
    }
    true
}

/// Trust a folder for Claude Code, so a session can start there with
/// nobody to answer. Safe to call again; changes nothing if it's trusted.
pub fn trust(folder: &Path) -> Result<()> {
    let folder = std::path::absolute(folder)?;
    if !folder.is_dir() {
        bail!("there's no folder {}", folder.display());
    }
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if home.as_deref().is_some_and(|h| names(h).iter().any(|n| names(&folder).contains(n))) || folder.parent().is_none() {
        bail!("won't trust {} for Claude Code: that would trust everything under it", folder.display());
    }
    let file = config_file()?;
    // Claude Code rewrites this file too: read it, change one entry, write
    // a copy and swap it in, then read it back. If a Claude wrote in
    // between, try again.
    for _ in 0..5 {
        let text = match std::fs::read_to_string(&file) {
            Ok(t) => t,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => "{}".into(),
            Err(e) => return Err(e).with_context(|| format!("couldn't read {}", file.display())),
        };
        let mut config: Value = serde_json::from_str(&text).with_context(|| format!("{} isn't valid JSON; not touching it", file.display()))?;
        if !mark(&mut config, &folder) {
            return Ok(());
        }
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = file.with_extension(format!("json.omicron-{}", std::process::id()));
        std::fs::write(&tmp, serde_json::to_string_pretty(&config)? + "\n")?;
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
        }
        // Only swap if nobody changed the file since it was read.
        if std::fs::read_to_string(&file).unwrap_or_else(|_| "{}".into()) != text {
            let _ = std::fs::remove_file(&tmp);
            continue;
        }
        std::fs::rename(&tmp, &file)?;
        let back: Value = serde_json::from_str(&std::fs::read_to_string(&file)?).unwrap_or(Value::Null);
        if is_trusted(&back, &folder) {
            return Ok(());
        }
    }
    bail!("couldn't mark {} as trusted in {} (it kept changing)", folder.display(), file.display())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marks_one_exact_folder_and_keeps_everything_else() {
        let mut c = json!({ "numStartups": 4, "projects": { "/code": { "allowedTools": ["x"] } } });
        assert!(mark(&mut c, Path::new("/code/app")));
        assert_eq!(c["projects"]["/code/app"]["hasTrustDialogAccepted"], json!(true));
        assert_eq!(c["projects"]["/code"], json!({ "allowedTools": ["x"] }), "the folder above isn't touched");
        assert_eq!(c["numStartups"], json!(4));
        assert!(!mark(&mut c, Path::new("/code/app")), "a second time changes nothing");
        assert!(is_trusted(&c, Path::new("/code/app/")));
        assert!(!is_trusted(&c, Path::new("/code")));
        assert!(!is_trusted(&c, Path::new("/code/app/inner")), "only the exact folder");
        let mut odd = json!([1]);
        assert!(mark(&mut odd, Path::new("/x")));
        assert!(is_trusted(&odd, Path::new("/x")));
    }
}
