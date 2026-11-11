//! Talking to Supabase: signing people and machines in, and plain requests.
//!
//! People and machines are both Supabase Auth users with made-up email
//! addresses under `.omicron.invalid` (a name that can never receive mail).
//! Nobody ever types these; they only exist so Supabase Auth can hand out a
//! normal login.
//! - A person is signed in by a Web Machine, which holds the secret key. It has
//!   already checked who they are with Tailscale (see `identity`).
//! - A machine signs itself in with its API key, which is its Auth email and
//!   password packed into one string. That needs only the publishable key.

use crate::identity::TailscalePerson;
use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fmt;
use std::str::FromStr;
use uuid::Uuid;

/// Where Supabase is and the keys to reach it.
#[derive(Clone)]
pub struct Supabase {
    pub url: String,
    /// The publishable (or anon) key. Safe to give out.
    pub key: String,
    /// The secret (or service role) key. Only Web Machines and setup steps have it.
    pub secret_key: Option<String>,
}

/// A login handed out by Supabase Auth.
#[derive(Debug, Clone, Deserialize)]
pub struct Session {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub user: SessionUser,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SessionUser {
    pub id: Uuid,
}

pub fn person_email(id: Uuid) -> String {
    format!("{id}@people.omicron.invalid")
}

pub fn machine_email(id: Uuid) -> String {
    format!("{id}@machines.omicron.invalid")
}

/// A machine's API key: `omk_<machine id>_<secret>`.
#[derive(Clone, PartialEq, Eq)]
pub struct MachineKey {
    pub machine_id: Uuid,
    secret: String,
}

const KEY_PREFIX: &str = "omk_";

impl MachineKey {
    fn new(machine_id: Uuid) -> Result<Self> {
        let mut bytes = [0u8; 32];
        getrandom::getrandom(&mut bytes).map_err(|e| anyhow!("couldn't make a random key: {e}"))?;
        let secret = bytes.iter().map(|b| format!("{b:02x}")).collect();
        Ok(MachineKey { machine_id, secret })
    }
}

impl fmt::Display for MachineKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{KEY_PREFIX}{}_{}", self.machine_id.simple(), self.secret)
    }
}

// Never print the secret by accident.
impl fmt::Debug for MachineKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "MachineKey({})", self.machine_id)
    }
}

impl FromStr for MachineKey {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self> {
        let bad = || anyhow!("that isn't a machine API key (they start with `{KEY_PREFIX}`)");
        let rest = s.trim().strip_prefix(KEY_PREFIX).ok_or_else(bad)?;
        let (id, secret) = rest.split_once('_').ok_or_else(bad)?;
        let machine_id = Uuid::parse_str(id).map_err(|_| bad())?;
        if secret.len() != 64 || !secret.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(bad());
        }
        Ok(MachineKey { machine_id, secret: secret.to_string() })
    }
}

/// Encode a value for use in a URL query.
fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

impl Supabase {
    /// From `OMICRON_SUPABASE_URL`, `OMICRON_SUPABASE_KEY`, and (optional)
    /// `OMICRON_SUPABASE_SECRET_KEY`.
    pub fn from_env() -> Result<Self> {
        let var = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
        Ok(Supabase {
            url: var("OMICRON_SUPABASE_URL").context("OMICRON_SUPABASE_URL isn't set")?.trim_end_matches('/').to_string(),
            key: var("OMICRON_SUPABASE_KEY").context("OMICRON_SUPABASE_KEY isn't set")?,
            secret_key: var("OMICRON_SUPABASE_SECRET_KEY"),
        })
    }

    fn secret(&self) -> Result<&str> {
        self.secret_key
            .as_deref()
            .context("this needs Supabase's secret key (OMICRON_SUPABASE_SECRET_KEY), which only Web Machines have")
    }

    /// One request. `key` goes in `apikey`; `bearer` is the login to act as
    /// (defaults to `key`). Errors carry Supabase's own message.
    fn call(&self, method: &str, path: &str, key: &str, bearer: Option<&str>, body: Option<Value>, prefer: Option<&str>) -> Result<Value> {
        let mut req = ureq::request(method, &format!("{}{path}", self.url))
            .set("apikey", key)
            .set("Authorization", &format!("Bearer {}", bearer.unwrap_or(key)));
        if let Some(p) = prefer {
            req = req.set("Prefer", p);
        }
        let res = match body {
            Some(b) => req.send_json(b),
            None => req.call(),
        };
        match res {
            Ok(r) => {
                let text = r.into_string()?;
                Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text)? })
            }
            Err(ureq::Error::Status(code, r)) => {
                let text = r.into_string().unwrap_or_default();
                Err(anyhow!(SupabaseError { code, message: text }))
            }
            Err(e) => Err(anyhow!("couldn't reach Supabase at {}: {e}", self.url)),
        }
    }

    /// A request made with the secret key, which gets past every rule.
    pub fn admin_request(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        self.admin(method, path, body, Some("return=representation"))
    }

    fn admin(&self, method: &str, path: &str, body: Option<Value>, prefer: Option<&str>) -> Result<Value> {
        let secret = self.secret()?.to_string();
        self.call(method, path, &secret, None, body, prefer)
    }

    /// Save a file in Storage as a signed-in person or machine.
    pub fn upload_as(&self, session: &Session, bucket: &str, path: &str, bytes: &[u8], content_type: &str) -> Result<()> {
        let res = ureq::post(&format!("{}/storage/v1/object/{bucket}/{path}", self.url))
            .set("apikey", &self.key)
            .set("Authorization", &format!("Bearer {}", session.access_token))
            .set("Content-Type", content_type)
            .send_bytes(bytes);
        match res {
            Ok(_) => Ok(()),
            Err(ureq::Error::Status(code, r)) => Err(anyhow!(SupabaseError { code, message: r.into_string().unwrap_or_default() })),
            Err(e) => Err(anyhow!("couldn't reach Supabase at {}: {e}", self.url)),
        }
    }

    /// Read a file from Storage as a signed-in person or machine.
    pub fn download_as(&self, session: &Session, bucket: &str, path: &str) -> Result<Vec<u8>> {
        let res = ureq::get(&format!("{}/storage/v1/object/authenticated/{bucket}/{path}", self.url))
            .set("apikey", &self.key)
            .set("Authorization", &format!("Bearer {}", session.access_token))
            .call();
        match res {
            Ok(r) => {
                let mut bytes = Vec::new();
                std::io::Read::read_to_end(&mut r.into_reader(), &mut bytes)?;
                Ok(bytes)
            }
            Err(ureq::Error::Status(code, r)) => Err(anyhow!(SupabaseError { code, message: r.into_string().unwrap_or_default() })),
            Err(e) => Err(anyhow!("couldn't reach Supabase at {}: {e}", self.url)),
        }
    }

    /// A request made as a signed-in person or machine. The database's own
    /// rules decide what they can see and change.
    pub fn request_as(&self, session: &Session, method: &str, path: &str, body: Option<Value>) -> Result<Value> {
        self.call(method, path, &self.key, Some(&session.access_token), body, Some("return=representation"))
    }

    /// Sign in a person that a Web Machine has checked with Tailscale. The
    /// first time a Tailscale identity shows up, it gets a new person, who
    /// sees nothing until someone adds them to a Project.
    pub fn sign_in_person(&self, who: &TailscalePerson) -> Result<Session> {
        let person_id = match self.person_for_login(&who.login)? {
            Some(id) => {
                self.admin(
                    "PATCH",
                    &format!("/rest/v1/tailscale_identities?login=eq.{}", enc(&who.login)),
                    Some(json!({ "last_seen": "now", "display_name": who.display_name })),
                    None,
                )?;
                id
            }
            None => self.add_person(who)?,
        };
        self.session_for(&person_email(person_id))
    }

    fn person_for_login(&self, login: &str) -> Result<Option<Uuid>> {
        let rows = self.admin("GET", &format!("/rest/v1/tailscale_identities?login=eq.{}&select=person_id", enc(login)), None, None)?;
        Ok(rows.get(0).and_then(|r| r["person_id"].as_str()).map(Uuid::parse_str).transpose()?)
    }

    fn add_person(&self, who: &TailscalePerson) -> Result<Uuid> {
        let id = Uuid::new_v4();
        self.admin(
            "POST",
            "/auth/v1/admin/users",
            Some(json!({ "id": id, "email": person_email(id), "email_confirm": true, "user_metadata": { "kind": "person" } })),
            None,
        )?;
        self.admin("POST", "/rest/v1/people", Some(json!({ "id": id, "display_name": who.display_name })), None)?;
        match self.link_tailscale_identity(id, who) {
            Ok(()) => Ok(id),
            // Two first visits at once: the other one won. Drop ours and use theirs.
            Err(e) if is_conflict(&e) => {
                self.admin("DELETE", &format!("/auth/v1/admin/users/{id}"), None, None)?;
                self.person_for_login(&who.login)?.context("lost a race adding a person and couldn't find the winner")
            }
            Err(e) => Err(e),
        }
    }

    /// Link another Tailscale identity to an existing person (like a work
    /// login and a personal one).
    pub fn link_tailscale_identity(&self, person_id: Uuid, who: &TailscalePerson) -> Result<()> {
        self.admin(
            "POST",
            "/rest/v1/tailscale_identities",
            Some(json!({ "login": who.login, "person_id": person_id, "display_name": who.display_name })),
            None,
        )?;
        Ok(())
    }

    /// A login for an Auth user, without a password: make a one-time sign-in
    /// link with the secret key, then use it straight away.
    fn session_for(&self, email: &str) -> Result<Session> {
        let link = self.admin("POST", "/auth/v1/admin/generate_link", Some(json!({ "type": "magiclink", "email": email })), None)?;
        let token = link["hashed_token"]
            .as_str()
            .or_else(|| link["properties"]["hashed_token"].as_str())
            .context("Supabase didn't return a sign-in link")?;
        let session = self.call("POST", "/auth/v1/verify", &self.key, None, Some(json!({ "type": "magiclink", "token_hash": token })), None)?;
        Ok(serde_json::from_value(session).context("Supabase's sign-in reply wasn't a login")?)
    }

    /// Register a machine and make its API key. The key is shown once and
    /// never stored anywhere but on the machine.
    pub fn register_machine(&self, name: &str, all_projects: bool) -> Result<MachineKey> {
        let id = Uuid::new_v4();
        let key = MachineKey::new(id)?;
        self.admin(
            "POST",
            "/auth/v1/admin/users",
            Some(json!({ "id": id, "email": machine_email(id), "password": key.secret, "email_confirm": true, "user_metadata": { "kind": "machine" } })),
            None,
        )?;
        if let Err(e) = self.admin("POST", "/rest/v1/machines", Some(json!({ "id": id, "name": name, "all_projects": all_projects })), None) {
            let _ = self.admin("DELETE", &format!("/auth/v1/admin/users/{id}"), None, None);
            if is_conflict(&e) {
                bail!("there's already a machine called {name}");
            }
            return Err(e);
        }
        Ok(key)
    }

    /// Sign a machine in with its API key. Only needs the publishable key.
    pub fn sign_in_machine(&self, key: &MachineKey) -> Result<Session> {
        let reply = self
            .call(
                "POST",
                "/auth/v1/token?grant_type=password",
                &self.key,
                None,
                Some(json!({ "email": machine_email(key.machine_id), "password": key.secret })),
                None,
            )
            .map_err(|e| if is_status(&e, 400) { anyhow!("that machine API key doesn't work (wrong, or the machine was removed)") } else { e })?;
        Ok(serde_json::from_value(reply).context("Supabase's sign-in reply wasn't a login")?)
    }
}

/// An error reply from Supabase.
#[derive(Debug)]
pub struct SupabaseError {
    pub code: u16,
    pub message: String,
}

impl fmt::Display for SupabaseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Supabase said {}: {}", self.code, self.message)
    }
}

impl std::error::Error for SupabaseError {}

fn is_status(e: &anyhow::Error, code: u16) -> bool {
    e.downcast_ref::<SupabaseError>().is_some_and(|s| s.code == code)
}

fn is_conflict(e: &anyhow::Error) -> bool {
    is_status(e, 409)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn machine_keys_round_trip() {
        let key = MachineKey::new(Uuid::new_v4()).unwrap();
        let text = key.to_string();
        assert!(text.starts_with("omk_"));
        assert_eq!(text.parse::<MachineKey>().unwrap(), key);
    }

    #[test]
    fn bad_machine_keys_are_refused() {
        for bad in ["", "omk_", "omk_nope_nope", "abc_123", &format!("omk_{}_short", Uuid::new_v4().simple())] {
            assert!(bad.parse::<MachineKey>().is_err(), "{bad}");
        }
    }

    #[test]
    fn debug_never_shows_the_secret() {
        let key = MachineKey::new(Uuid::new_v4()).unwrap();
        assert!(!format!("{key:?}").contains(&key.secret));
    }

    #[test]
    fn query_values_are_encoded() {
        assert_eq!(enc("a+b@c.d"), "a%2Bb%40c.d");
    }
}
