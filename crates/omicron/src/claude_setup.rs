//! Setting up Claude Code for Omicron: its hooks in a settings file, the
//! handoff skill, and the add-on that puts a session's messages into its
//! window.

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::path::PathBuf;

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

pub fn shell_quote(s: &str) -> String {
    if s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
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
