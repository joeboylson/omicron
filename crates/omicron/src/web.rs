//! The Web Machine: serves the web page and signs visitors in.
//!
//! It listens on this machine only (127.0.0.1). People on other devices reach
//! it through `tailscale serve`, which adds their Tailscale login to each
//! request (see `identity`).
//!
//! - `GET /` and `GET /assets/...`: the web page (built into the program, see
//!   `build.rs`). Any other page address also gets `index.html`, so the page
//!   can have its own addresses like `/p/<id>`.
//! - `GET /config.json`: where Supabase is, and its publishable key.
//! - `POST /api/session`: works out who the visitor is and hands back a
//!   Supabase login for them. The page then talks to Supabase directly.
//! - `POST /api/page-error`: the page reports an error it caught; it's
//!   printed to this program's error output (the Web Machine's log).

use crate::identity::{self, Visit};
use crate::supa::Supabase;
use anyhow::{anyhow, Context, Result};
use serde_json::json;
use std::io::Cursor;
use std::net::IpAddr;
use tiny_http::{Header, Method, Request, Response, Server};

/// Shown when the program was built without the web page.
const STAND_IN_HTML: &str = include_str!("web/index.html");

mod built {
    include!(concat!(env!("OUT_DIR"), "/web_assets.rs"));
}

/// A file of the built web page, if there is one at this address.
fn asset(path: &str) -> Option<&'static [u8]> {
    built::ASSETS.iter().find(|(p, _)| *p == path).map(|(_, b)| *b)
}

fn index_html() -> Vec<u8> {
    asset("/index.html").map_or_else(|| STAND_IN_HTML.as_bytes().to_vec(), |b| b.to_vec())
}

fn content_type(path: &str) -> &'static str {
    match path.rsplit_once('.').map(|(_, ext)| ext) {
        Some("html") => "text/html; charset=utf-8",
        Some("js") => "text/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") => "application/json",
        Some("webmanifest") => "application/manifest+json",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("ico") => "image/x-icon",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

pub struct WebMachine {
    pub supabase: Supabase,
    /// Where visitors' browsers reach Supabase, if not `supabase.url`.
    pub public_supabase_url: Option<String>,
    /// Host names (besides localhost) the page may be opened at, like this
    /// machine's Tailscale name. Anything else is refused, so another website
    /// can't trick a browser into asking for a login (DNS rebinding).
    pub extra_hosts: Vec<String>,
}

/// Was the page opened at localhost (rather than a tailnet name)?
fn is_localhost(host: &str) -> bool {
    allowed_host(host, &[])
}

/// Is this `Host` header one of ours?
pub fn allowed_host(host: &str, extra: &[String]) -> bool {
    let host = host.trim().to_ascii_lowercase();
    // Strip the port: `name:8787`, or `[::1]:8787` for IPv6.
    let name = if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host.rsplit_once(':').map_or(host.as_str(), |(n, _)| n)
    };
    matches!(name, "localhost" | "127.0.0.1" | "::1")
        || extra.iter().any(|e| e.trim_end_matches('.').eq_ignore_ascii_case(name))
}

impl WebMachine {
    /// Serve until the process is stopped. Prints the address once listening.
    pub fn serve(self, port: u16) -> Result<()> {
        self.supabase.secret_key.as_ref().context(
            "a Web Machine needs Supabase's secret key to sign people in. Run `omicron setup --secret-key <key>`.",
        )?;
        let server = Server::http(("127.0.0.1", port)).map_err(|e| anyhow!("couldn't listen on 127.0.0.1:{port}: {e}"))?;
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
        println!("omicron web page on http://127.0.0.1:{port}");
        for request in server.incoming_requests() {
            self.handle(request);
        }
        Ok(())
    }

    fn handle(&self, mut request: Request) {
        let (status, content_type, body) = match self.route(&mut request) {
            Ok(r) => r,
            Err(e) => (500, "application/json", json!({ "error": format!("{e:#}") }).to_string().into_bytes()),
        };
        // Built files have a fingerprint in their name, so they never change.
        let cache = if request.url().starts_with("/assets/") && status == 200 {
            "public, max-age=31536000, immutable"
        } else {
            "no-store"
        };
        let response = Response::new(
            status.into(),
            vec![
                header("Content-Type", content_type),
                header("Cache-Control", cache),
                header("X-Content-Type-Options", "nosniff"),
                header("Referrer-Policy", "no-referrer"),
            ],
            Cursor::new(body),
            None,
            None,
        );
        let _ = request.respond(response);
    }

    fn route(&self, request: &mut Request) -> Result<(u16, &'static str, Vec<u8>)> {
        let host = request_header(request, "Host").unwrap_or_default();
        if !allowed_host(&host, &self.extra_hosts) {
            return Ok((421, "application/json", json!({ "error": format!("this page isn't served at {host}") }).to_string().into_bytes()));
        }
        let path = request.url().split('?').next().unwrap_or("/");
        match (request.method(), path) {
            (Method::Get, "/config.json") => Ok((
                200,
                "application/json",
                json!({
                    // A visit from this machine itself uses the address this
                    // machine reaches Supabase at; anyone else gets the
                    // public one.
                    "supabase_url": if is_localhost(&host) {
                        self.supabase.url.as_str()
                    } else {
                        self.public_supabase_url.as_deref().unwrap_or(&self.supabase.url)
                    },
                    "supabase_key": self.supabase.key,
                })
                .to_string()
                .into_bytes(),
            )),
            (Method::Post, "/api/session") => self.session(request),
            (Method::Post, "/api/page-error") => Ok(page_error(request)),
            (Method::Post, "/api/dispatch") => self.dispatch_api(request),
            (Method::Post, "/api/machines") => self.machines_api(request, None),
            (Method::Post, p) if p.starts_with("/api/machines/") => {
                let rest = p.trim_start_matches("/api/machines/").to_string();
                self.machines_api(request, Some(rest))
            }
            (_, "/api/session") => Ok((405, "application/json", json!({ "error": "use POST" }).to_string().into_bytes())),
            (Method::Get, p) if p.starts_with("/api/") => Ok((404, "application/json", json!({ "error": "not found" }).to_string().into_bytes())),
            (Method::Get, "/") | (Method::Get, "/index.html") => Ok((200, "text/html; charset=utf-8", index_html())),
            (Method::Get, p) => match asset(p) {
                Some(bytes) => Ok((200, content_type(p), bytes.to_vec())),
                // A missing built file is a real 404; any other address is a
                // page of the web app.
                None if p.starts_with("/assets/") || p.contains('.') => {
                    Ok((404, "application/json", json!({ "error": "not found" }).to_string().into_bytes()))
                }
                None => Ok((200, "text/html; charset=utf-8", index_html())),
            },
            _ => Ok((404, "application/json", json!({ "error": "not found" }).to_string().into_bytes())),
        }
    }

    /// API keys, for people on the page (keys are only for machines, and
    /// making one needs the secret key, which only a Web Machine has):
    /// - POST /api/machines {name, project_ids}: register a machine in
    ///   Projects you're in; its key comes back once.
    /// - POST /api/machines/<id>/switch-off, /switch-on, /remove: for
    ///   machines that share a Project with you.
    /// The page sends its own login, and the database's rules say what that
    /// person may see.
    fn machines_api(&self, request: &mut Request, action: Option<String>) -> Result<(u16, &'static str, Vec<u8>)> {
        let fail = |code: u16, msg: &str| Ok((code, "application/json", json!({ "error": msg }).to_string().into_bytes()));
        let Some(token) = request_header(request, "Authorization").and_then(|h| h.strip_prefix("Bearer ").map(String::from)) else {
            return fail(401, "sign in first");
        };
        let Ok(login) = self.supabase.session_for_token(&token) else { return fail(401, "that login doesn't work any more; reload the page") };
        let me = self.supabase.request_as(&login, "GET", &format!("/rest/v1/people?id=eq.{}&select=id", login.user.id), None)?;
        if me.as_array().is_none_or(|a| a.is_empty()) {
            return fail(403, "only people can manage API keys");
        }
        let mut body = Vec::new();
        {
            use std::io::Read;
            let _ = request.as_reader().take(16 * 1024).read_to_end(&mut body);
        }
        let input: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
        match action {
            None => {
                let name = input["name"].as_str().unwrap_or("").trim().to_string();
                if name.is_empty() {
                    return fail(400, "give the machine a name, like mac-mini");
                }
                let projects: Vec<String> = input["project_ids"].as_array().into_iter().flatten().filter_map(|v| v.as_str().map(String::from)).collect();
                if projects.is_empty() {
                    return fail(400, "pick at least one Project for the machine");
                }
                // Only Projects you're in (the rules hide the others).
                let seen = self.supabase.request_as(&login, "GET", &format!("/rest/v1/projects?id=in.({})&select=id", projects.join(",")), None)?;
                if seen.as_array().map_or(0, |a| a.len()) != projects.len() {
                    return fail(403, "you can only add a machine to Projects you're in");
                }
                let key = match self.supabase.register_machine(&name, false, Some(login.user.id)) {
                    Ok(k) => k,
                    Err(e) => return fail(409, &format!("{e:#}")),
                };
                for p in &projects {
                    self.supabase.request_as(&login, "POST", "/rest/v1/project_machines", Some(json!({ "project_id": p, "machine_id": key.machine_id })))?;
                }
                eprintln!("omicron serve: {} registered the machine {name}", login.user.id);
                Ok((200, "application/json", json!({ "machine_id": key.machine_id, "name": name, "key": key.to_string() }).to_string().into_bytes()))
            }
            Some(rest) => {
                let (id, what) = rest.split_once('/').unwrap_or((&rest, ""));
                let Ok(id) = id.parse::<uuid::Uuid>() else { return fail(404, "no such machine") };
                // A machine you share a Project with.
                let shared = self.supabase.request_as(&login, "GET", &format!("/rest/v1/project_machines?machine_id=eq.{id}&select=project_id"), None)?;
                if shared.as_array().is_none_or(|a| a.is_empty()) {
                    return fail(403, "you can only manage machines in a Project you're in");
                }
                let this = crate::config::Config::load().ok().and_then(|c| c.machine_key().ok()).map(|k| k.machine_id);
                match what {
                    "switch-off" if this == Some(id) => fail(400, "this is the machine serving this page; it can't switch itself off"),
                    "switch-off" => self.supabase.set_machine_active(id, false).map(|_| (204, "application/json", Vec::new())),
                    "switch-on" => self.supabase.set_machine_active(id, true).map(|_| (204, "application/json", Vec::new())),
                    "remove" if this == Some(id) => fail(400, "this is the machine serving this page; it can't remove itself"),
                    "remove" => self.supabase.remove_machine(id).map(|_| (204, "application/json", Vec::new())),
                    _ => fail(404, "not found"),
                }
            }
        }
    }

    /// POST /api/dispatch {task_id}: the serving computer's owner hands a
    /// task to a session on this computer, straight from its own page. The
    /// computer itself makes the request, so its gate doesn't stop it
    /// (ref/BRAINSTORM.md, "The gate"). It only counts when this computer
    /// sees the owner's Tailscale login on the visit (through the home lab's
    /// gate) and the page's login is the same person. Anything else answers
    /// `{"elsewhere": true}`, and the page asks through the database, where
    /// the gate applies.
    fn dispatch_api(&self, request: &mut Request) -> Result<(u16, &'static str, Vec<u8>)> {
        let answer = |code: u16, v: serde_json::Value| Ok((code, "application/json", v.to_string().into_bytes()));
        let elsewhere = |why: &str| answer(409, json!({ "elsewhere": true, "error": why }));
        let Some(token) = request_header(request, "Authorization").and_then(|h| h.strip_prefix("Bearer ").map(String::from)) else {
            return answer(401, json!({ "error": "sign in first" }));
        };
        let Ok(login) = self.supabase.session_for_token(&token) else {
            return answer(401, json!({ "error": "that login doesn't work any more; reload the page" }));
        };
        let peer: IpAddr = request.remote_addr().map(|a| a.ip()).context("no address for this visit")?;
        let Ok(visit) = identity::visitor(peer, |name| request_header(request, name), identity::gate_secret().as_deref(), identity::local_person) else {
            return elsewhere("this visit's Tailscale login couldn't be checked");
        };
        if self.supabase.person_for_login(&visit.person().login)? != Some(login.user.id) {
            return elsewhere("the page's login isn't the Tailscale login of this visit");
        }
        let mut body = Vec::new();
        {
            use std::io::Read;
            let _ = request.as_reader().take(4096).read_to_end(&mut body);
        }
        let input: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
        let Some(task_id) = input["task_id"].as_str().and_then(|t| t.parse::<uuid::Uuid>().ok()) else {
            return answer(400, json!({ "error": "which task?" }));
        };
        let Ok(key) = crate::config::Config::load().and_then(|c| c.machine_key()) else {
            return elsewhere("this computer has no machine key");
        };
        let board = crate::board::Board { supabase: self.supabase.clone(), session: self.supabase.sign_in_machine(&key)? };
        if board.machine_owner()?.as_deref() != Some(login.user.id.to_string().as_str()) {
            return elsewhere("you don't own the computer serving this page");
        }
        // The person must see the task too (the rules say what they may see).
        let seen = self.supabase.request_as(&login, "GET", &format!("/rest/v1/tasks?id=eq.{task_id}&select=id"), None)?;
        if seen.as_array().is_none_or(|a| a.is_empty()) {
            return answer(404, json!({ "error": "no such task" }));
        }
        let rows = self.supabase.request_as(&board.session, "GET", &format!("/rest/v1/tasks?id=eq.{task_id}&select=id,session:sessions(machine_id)"), None)?;
        if rows.get(0).and_then(|r| r["session"]["machine_id"].as_str()) != Some(key.machine_id.to_string().as_str()) {
            return elsewhere("its session isn't on the computer serving this page");
        }
        // Given again, by this computer: the session takes it as its own.
        self.supabase.request_as(&board.session, "PATCH", &format!("/rest/v1/tasks?id=eq.{task_id}"), Some(json!({ "given_by": null })))?;
        let made = self.supabase.request_as(&board.session, "POST", "/rest/v1/dispatches?select=id", Some(json!({ "task_id": task_id })))?;
        let id = made.get(0).and_then(|r| r["id"].as_str()).context("the dispatch wasn't saved")?.to_string();
        eprintln!("omicron serve: {} dispatched a task from this computer's own page", login.user.id);
        answer(200, json!({ "id": id }))
    }

    fn session(&self, request: &Request) -> Result<(u16, &'static str, Vec<u8>)> {
        let peer: IpAddr = request.remote_addr().map(|a| a.ip()).context("no address for this visit")?;
        let visit = match identity::visitor(peer, |name| request_header(request, name), identity::gate_secret().as_deref(), identity::local_person) {
            Ok(v) => v,
            Err(e) => return Ok((403, "application/json", json!({ "error": format!("{e:#}") }).to_string().into_bytes())),
        };
        let person = visit.person();
        let session = self.supabase.sign_in_person(person)?;
        Ok((
            200,
            "application/json",
            json!({
                "person_id": session.user.id,
                "display_name": person.display_name,
                "login": person.login,
                "via": match visit { Visit::Local(_) => "local", Visit::Tailnet(_) => "tailnet" },
                "access_token": session.access_token,
                "refresh_token": session.refresh_token,
                "expires_in": session.expires_in,
            })
            .to_string()
            .into_bytes(),
        ))
    }
}

/// Log an error the page caught. Only the first 8 KB is read, and only a
/// few fields are kept, each cut short, so a page can't flood the log.
fn page_error(request: &mut Request) -> (u16, &'static str, Vec<u8>) {
    use std::io::Read;
    let mut body = Vec::new();
    let _ = request.as_reader().take(8192).read_to_end(&mut body);
    let report: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
    let field = |name: &str, max: usize| -> String {
        let v = report[name].as_str().unwrap_or("").replace(['\n', '\r'], " ⏎ ");
        v.chars().take(max).collect()
    };
    eprintln!(
        "page error [{}] {} | at {} | {} | {}",
        field("kind", 20),
        field("message", 500),
        field("url", 200),
        field("agent", 200),
        field("stack", 1500)
    );
    (204, "application/json", Vec::new())
}

fn header(name: &str, value: &str) -> Header {
    Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("valid header")
}

fn request_header(request: &Request, name: &str) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str().to_string())
}

#[cfg(test)]
mod tests {
    use super::allowed_host;

    #[test]
    fn localhost_is_allowed_on_any_port() {
        for h in ["localhost", "localhost:8787", "127.0.0.1:1", "[::1]:8787", "LOCALHOST:80"] {
            assert!(allowed_host(h, &[]), "{h}");
        }
    }

    #[test]
    fn other_hosts_are_refused_unless_listed() {
        let extra = vec!["mini.example.ts.net.".to_string()];
        assert!(allowed_host("mini.example.ts.net:8446", &extra));
        assert!(!allowed_host("evil.example.com", &extra));
        assert!(!allowed_host("localhost.evil.example.com", &extra));
        assert!(!allowed_host("", &extra));
    }
}
