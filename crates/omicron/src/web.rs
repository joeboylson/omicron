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
    /// Host names (besides localhost) the page may be opened at, like this
    /// machine's Tailscale name. Anything else is refused, so another website
    /// can't trick a browser into asking for a login (DNS rebinding).
    pub extra_hosts: Vec<String>,
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

    fn handle(&self, request: Request) {
        let (status, content_type, body) = match self.route(&request) {
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

    fn route(&self, request: &Request) -> Result<(u16, &'static str, Vec<u8>)> {
        let host = request_header(request, "Host").unwrap_or_default();
        if !allowed_host(&host, &self.extra_hosts) {
            return Ok((421, "application/json", json!({ "error": format!("this page isn't served at {host}") }).to_string().into_bytes()));
        }
        let path = request.url().split('?').next().unwrap_or("/");
        match (request.method(), path) {
            (Method::Get, "/config.json") => Ok((
                200,
                "application/json",
                json!({ "supabase_url": self.supabase.url, "supabase_key": self.supabase.key }).to_string().into_bytes(),
            )),
            (Method::Post, "/api/session") => self.session(request),
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

    fn session(&self, request: &Request) -> Result<(u16, &'static str, Vec<u8>)> {
        let peer: IpAddr = request.remote_addr().map(|a| a.ip()).context("no address for this visit")?;
        let visit = match identity::visitor(peer, |name| request_header(request, name), identity::local_person) {
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
