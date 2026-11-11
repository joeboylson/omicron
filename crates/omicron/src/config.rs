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
    /// Where visitors' browsers reach Supabase, when it isn't `supabase_url`
    /// (a Web Machine that reaches Supabase locally, while browsers use its
    /// tailnet address). Only on Web Machines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_supabase_url: Option<String>,
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
    /// The highest line of the change list this machine has handled.
    #[serde(default)]
    pub last_change: Option<i64>,
    /// The most recent lines handled, so a line that finishes saving after a
    /// higher-numbered one still gets handled exactly once.
    #[serde(default)]
    pub recent: Vec<i64>,
}

/// How many handled lines to remember.
const RECENT: usize = 1000;

impl State {
    /// Should this line be handled? Yes unless it already was. Lines far
    /// below the newest handled one count as handled already (they're from
    /// before this machine started remembering).
    pub fn is_new(&self, seq: i64) -> bool {
        if self.recent.binary_search(&seq).is_ok() {
            return false;
        }
        match (self.last_change, self.recent.first()) {
            (None, _) => true,
            (Some(last), _) if seq > last => true,
            (Some(_), Some(&oldest)) => seq > oldest,
            (Some(_), None) => false,
        }
    }

    /// Remember that this line was handled.
    pub fn mark(&mut self, seq: i64) {
        if let Err(i) = self.recent.binary_search(&seq) {
            self.recent.insert(i, seq);
        }
        if self.recent.len() > RECENT {
            let extra = self.recent.len() - RECENT;
            self.recent.drain(..extra);
        }
        self.last_change = Some(self.last_change.map_or(seq, |l| l.max(seq)));
    }

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

#[cfg(test)]
mod tests {
    use super::State;

    #[test]
    fn each_line_is_handled_once() {
        let mut s = State::default();
        assert!(s.is_new(5));
        s.mark(5);
        assert!(!s.is_new(5));
        assert!(s.is_new(6));
    }

    #[test]
    fn a_lower_line_that_finishes_late_is_still_handled() {
        let mut s = State::default();
        s.mark(10);
        s.mark(12);
        // 11 finished saving after 12.
        assert!(s.is_new(11));
        s.mark(11);
        assert!(!s.is_new(11));
        assert_eq!(s.last_change, Some(12));
    }

    #[test]
    fn it_remembers_a_bounded_number_of_lines() {
        let mut s = State::default();
        for seq in 1..=1500 {
            s.mark(seq);
        }
        assert_eq!(s.recent.len(), 1000);
        assert_eq!(s.recent.first(), Some(&501));
        // Lines older than what it remembers count as already handled.
        assert!(!s.is_new(100));
        assert!(s.is_new(1501));
    }

    #[test]
    fn a_machine_that_never_remembered_lines_only_takes_newer_ones() {
        let s = State { last_change: Some(50), recent: vec![] };
        assert!(!s.is_new(49));
        assert!(s.is_new(51));
    }
}
