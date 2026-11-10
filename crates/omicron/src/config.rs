//! This machine's Omicron settings, in `~/.omicron/config.json`.
//!
//! `OMICRON_HOME` moves the folder. Each setting can also be overridden with
//! an environment variable (`OMICRON_SUPABASE_URL`, `OMICRON_SUPABASE_KEY`,
//! `OMICRON_SUPABASE_SECRET_KEY`, `OMICRON_MACHINE_KEY`).

use crate::supa::{MachineKey, Supabase};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Config {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supabase_url: Option<String>,
    /// The publishable (or anon) key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supabase_key: Option<String>,
    /// The secret key. Only on Web Machines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub supabase_secret_key: Option<String>,
    /// This machine's API key, from `omicron machines register`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub machine_key: Option<String>,
}

pub fn home() -> Result<PathBuf> {
    if let Some(h) = std::env::var_os("OMICRON_HOME").filter(|h| !h.is_empty()) {
        return Ok(PathBuf::from(h));
    }
    let user_home = std::env::var_os("HOME").context("HOME isn't set")?;
    Ok(PathBuf::from(user_home).join(".omicron"))
}

pub fn path() -> Result<PathBuf> {
    Ok(home()?.join("config.json"))
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

impl Config {
    /// The saved settings, or empty ones if there's no file yet.
    pub fn load() -> Result<Config> {
        let path = path()?;
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).with_context(|| format!("{} isn't valid settings", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
            Err(e) => Err(e).with_context(|| format!("couldn't read {}", path.display())),
        }
    }

    /// Save, readable only by this user (it holds keys).
    pub fn save(&self) -> Result<()> {
        let path = path()?;
        let dir = path.parent().context("settings path has no folder")?;
        std::fs::create_dir_all(dir).with_context(|| format!("couldn't make {}", dir.display()))?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(self)? + "\n")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(&tmp, &path).with_context(|| format!("couldn't save {}", path.display()))?;
        Ok(())
    }

    /// Where Supabase is, with environment variables winning over the file.
    pub fn supabase(&self) -> Result<Supabase> {
        let url = env("OMICRON_SUPABASE_URL")
            .or_else(|| self.supabase_url.clone())
            .context("Omicron isn't set up yet. Run `omicron setup --url <supabase url> --key <publishable key>`.")?;
        let key = env("OMICRON_SUPABASE_KEY")
            .or_else(|| self.supabase_key.clone())
            .context("there's no Supabase publishable key. Run `omicron setup --key <publishable key>`.")?;
        Ok(Supabase {
            url: url.trim_end_matches('/').to_string(),
            key,
            secret_key: env("OMICRON_SUPABASE_SECRET_KEY").or_else(|| self.supabase_secret_key.clone()),
        })
    }

    /// This machine's API key, if it has been registered.
    pub fn machine_key(&self) -> Result<MachineKey> {
        env("OMICRON_MACHINE_KEY")
            .or_else(|| self.machine_key.clone())
            .context("this machine isn't registered yet. Run `omicron machines register <name>`.")?
            .parse()
    }
}

/// What this machine has done so far, in `~/.omicron/state.json`.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct State {
    /// The last line of the change list this machine has handled.
    #[serde(default)]
    pub last_change: Option<i64>,
}

impl State {
    pub fn load() -> Result<State> {
        let path = home()?.join("state.json");
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).with_context(|| format!("{} isn't valid", path.display())),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(State::default()),
            Err(e) => Err(e).with_context(|| format!("couldn't read {}", path.display())),
        }
    }

    pub fn save(&self) -> Result<()> {
        let path = home()?.join("state.json");
        std::fs::create_dir_all(home()?)?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string(self)?)?;
        std::fs::rename(&tmp, &path).with_context(|| format!("couldn't save {}", path.display()))?;
        Ok(())
    }
}
