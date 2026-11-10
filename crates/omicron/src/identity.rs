//! Who is using Omicron, worked out from Tailscale.
//!
//! The web page only listens on this machine (localhost). A visit reaches it
//! one of two ways:
//! - Straight from this machine. The visitor is the person this machine is
//!   signed in to Tailscale as.
//! - From another device, through `tailscale serve`. Tailscale adds the
//!   visitor's login in the `Tailscale-User-Login` header.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::collections::HashMap;
use std::net::IpAddr;
use std::process::Command;

/// A person as Tailscale knows them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TailscalePerson {
    /// Tailscale's login, like `someone@github`. This is what an Omicron
    /// person is linked to; one person can have several.
    pub login: String,
    pub display_name: String,
}

/// How a visitor reached the page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Visit {
    /// From this machine itself.
    Local(TailscalePerson),
    /// From another device, through `tailscale serve`.
    Tailnet(TailscalePerson),
}

impl Visit {
    pub fn person(&self) -> &TailscalePerson {
        match self {
            Visit::Local(p) | Visit::Tailnet(p) => p,
        }
    }
}

/// The login Tailscale gives servers that are owned by tags instead of a person.
const TAGGED_LOGIN: &str = "tagged-devices";

#[derive(Deserialize)]
struct Status {
    #[serde(rename = "Self")]
    me: Option<SelfNode>,
    // Tailscale sends `null` here when signed out.
    #[serde(rename = "User", default)]
    users: Option<HashMap<String, User>>,
}

#[derive(Deserialize)]
struct SelfNode {
    #[serde(rename = "UserID")]
    user_id: u64,
}

#[derive(Deserialize)]
struct User {
    #[serde(rename = "LoginName")]
    login_name: String,
    #[serde(rename = "DisplayName", default)]
    display_name: String,
}

/// The person this machine is signed in to Tailscale as, from the output of
/// `tailscale status --json`.
pub fn person_from_status(status_json: &str) -> Result<TailscalePerson> {
    let status: Status = serde_json::from_str(status_json).context("couldn't read Tailscale's status")?;
    let me = status.me.context("Tailscale isn't signed in on this machine")?;
    let user = status
        .users
        .as_ref()
        .and_then(|users| users.get(&me.user_id.to_string()))
        .context("Tailscale's status doesn't say who this machine belongs to")?;
    if user.login_name == TAGGED_LOGIN {
        bail!("this machine belongs to tags, not a person, so it has no one to sign in as. Use the machine's API key instead.");
    }
    Ok(TailscalePerson { login: user.login_name.clone(), display_name: user.display_name.clone() })
}

/// The person this machine is signed in to Tailscale as.
///
/// Reads the file in `OMICRON_TAILSCALE_STATUS` instead of asking Tailscale
/// when it's set (for test machines that aren't on Tailscale).
pub fn local_person() -> Result<TailscalePerson> {
    let json = match std::env::var_os("OMICRON_TAILSCALE_STATUS") {
        Some(path) => std::fs::read_to_string(&path)
            .with_context(|| format!("couldn't read {}", path.to_string_lossy()))?,
        None => {
            let out = Command::new("tailscale")
                .args(["status", "--json"])
                .output()
                .context("couldn't run `tailscale`. Is Tailscale installed?")?;
            if !out.status.success() {
                bail!("`tailscale status` failed: {}", String::from_utf8_lossy(&out.stderr).trim());
            }
            String::from_utf8(out.stdout).context("Tailscale's status wasn't text")?
        }
    };
    person_from_status(&json)
}

/// Work out who a visitor is.
///
/// `peer` is the address the connection came from. `header` looks up a
/// request header by name. `local` gives this machine's person; it's only
/// called for visits from this machine.
pub fn visitor(
    peer: IpAddr,
    header: impl Fn(&str) -> Option<String>,
    local: impl FnOnce() -> Result<TailscalePerson>,
) -> Result<Visit> {
    // The page only listens on localhost, so anything else is a mistake in
    // how it was started. Refuse rather than trust headers anyone could send.
    if !peer.is_loopback() {
        bail!("refused a visit from {peer}: the page only accepts visits from this machine or through `tailscale serve`");
    }
    match header("Tailscale-User-Login").filter(|l| !l.trim().is_empty()) {
        Some(login) => {
            let display_name = header("Tailscale-User-Name").unwrap_or_else(|| login.clone());
            Ok(Visit::Tailnet(TailscalePerson { login, display_name }))
        }
        None => Ok(Visit::Local(local()?)),
    }
}
