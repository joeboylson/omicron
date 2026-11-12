//! Hearing about things as they happen, through Supabase Realtime.
//!
//! Realtime speaks the Phoenix channel protocol over a websocket: join a
//! channel with a login, send a heartbeat now and then, and messages arrive on
//! their own. Everyone uses one private channel, `omicron`:
//! - **Changes**: new lines in the `changes` table, filtered by the access
//!   rules, so each listener only gets what it may see.
//! - **Who's connected** (presence): each machine announces itself when it
//!   joins, and Supabase tells everyone the moment anyone joins or leaves.

use crate::supa::{Session, Supabase};
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

/// One changed row.
#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    pub table: String,
    /// `INSERT`, `UPDATE`, or `DELETE`.
    pub kind: String,
    pub record: Value,
    pub old_record: Value,
}

/// What `listen` reports.
pub enum Event {
    /// Joined and ready: changes from now on will arrive.
    Listening,
    /// The connection dropped and will be retried.
    Reconnecting(String),
    Change(Change),
    /// Everyone connected right now, by key, with what they announced.
    Connected(BTreeMap<String, Value>),
}

/// What to listen for.
pub struct Listen<'a> {
    /// Tables to hear changes from (they must be in the Realtime publication).
    pub tables: &'a [&'a str],
    /// Announce this listener as connected, under this key, with these details.
    pub announce: Option<(String, Value)>,
}

/// What a listener wants next.
pub enum Next {
    Continue,
    Stop,
}

const TOPIC_NAME: &str = "omicron";
const TOPIC: &str = "realtime:omicron";
/// Phoenix closes silent sockets after about a minute.
const HEARTBEAT: Duration = Duration::from_secs(25);
/// How long to wait for a message before checking the clock again.
const READ_SLICE: Duration = Duration::from_millis(250);

/// Listen until `stop` is set or `on_event` says to stop.
///
/// `login` gives a fresh login (on connect, and before the current one runs
/// out). Dropped connections are retried with a growing pause; errors from
/// `login` or `on_event` end the loop.
pub fn listen(
    supabase: &Supabase,
    what: &Listen,
    mut login: impl FnMut() -> Result<Session>,
    stop: &AtomicBool,
    mut on_event: impl FnMut(Event) -> Result<Next>,
) -> Result<()> {
    let mut pause = Duration::from_secs(1);
    while !stop.load(Ordering::Relaxed) {
        let session = login()?;
        match connection(supabase, what, session, &mut login, stop, &mut on_event) {
            Ok(()) => return Ok(()),
            Err(Failure::Fatal(e)) => return Err(e),
            Err(Failure::Dropped(e)) => {
                if let Next::Stop = on_event(Event::Reconnecting(format!("{e:#}")))? {
                    return Ok(());
                }
                let until = Instant::now() + pause;
                while Instant::now() < until && !stop.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(100));
                }
                pause = (pause * 2).min(Duration::from_secs(30));
            }
        }
    }
    Ok(())
}

enum Failure {
    /// Worth reconnecting.
    Dropped(anyhow::Error),
    /// Not worth retrying.
    Fatal(anyhow::Error),
}

struct Channel {
    ws: WebSocket<MaybeTlsStream<TcpStream>>,
    next_ref: u64,
}

impl Channel {
    fn send(&mut self, topic: &str, event: &str, payload: Value) -> Result<()> {
        let msg = json!({ "topic": topic, "event": event, "payload": payload, "ref": self.next_ref.to_string() });
        self.next_ref += 1;
        self.ws.send(Message::Text(msg.to_string().into())).context("couldn't send to Realtime")
    }
}

fn refresh_time(session: &Session) -> Instant {
    Instant::now() + Duration::from_secs(session.expires_in.saturating_sub(300).max(60))
}

fn connection(
    supabase: &Supabase,
    what: &Listen,
    mut session: Session,
    login: &mut impl FnMut() -> Result<Session>,
    stop: &AtomicBool,
    on_event: &mut impl FnMut(Event) -> Result<Next>,
) -> Result<(), Failure> {
    use Failure::{Dropped, Fatal};
    let fatal = |r: Result<Next>| -> Result<bool, Failure> {
        match r {
            Ok(Next::Continue) => Ok(true),
            Ok(Next::Stop) => Ok(false),
            Err(e) => Err(Fatal(e)),
        }
    };
    let mut ch = Channel { ws: connect(supabase).map_err(Dropped)?, next_ref: 1 };
    let changes: Vec<Value> =
        what.tables.iter().map(|t| json!({ "event": "INSERT", "schema": "public", "table": t })).collect();
    let presence_key = what.announce.as_ref().map(|(k, _)| k.clone()).unwrap_or_default();
    ch.send(
        TOPIC,
        "phx_join",
        json!({
            "config": {
                "broadcast": { "self": false },
                "presence": { "key": presence_key, "enabled": true },
                "postgres_changes": changes,
                "private": true,
            },
            "access_token": session.access_token,
        }),
    )
    .map_err(Dropped)?;

    let mut joined = false;
    let mut connected: BTreeMap<String, Value> = BTreeMap::new();
    let mut last_heartbeat = Instant::now();
    let mut refresh_at = refresh_time(&session);

    let ready = |ch: &mut Channel, on_event: &mut dyn FnMut(Event) -> Result<Next>| -> Result<bool, Failure> {
        if let Some((_, details)) = &what.announce {
            ch.send(TOPIC, "presence", json!({ "type": "presence", "event": "track", "payload": details })).map_err(Dropped)?;
        }
        fatal(on_event(Event::Listening))
    };

    while !stop.load(Ordering::Relaxed) {
        if last_heartbeat.elapsed() >= HEARTBEAT {
            ch.send("phoenix", "heartbeat", json!({})).map_err(Dropped)?;
            last_heartbeat = Instant::now();
        }
        if Instant::now() >= refresh_at {
            session = login().map_err(Fatal)?;
            ch.send(TOPIC, "access_token", json!({ "access_token": session.access_token })).map_err(Dropped)?;
            refresh_at = refresh_time(&session);
        }

        let text = match ch.ws.read() {
            Ok(Message::Text(t)) => t.to_string(),
            Ok(Message::Close(_)) => return Err(Dropped(anyhow!("Realtime closed the connection"))),
            Ok(_) => continue,
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {
                continue
            }
            Err(e) => return Err(Dropped(anyhow!("lost the Realtime connection: {e}"))),
        };
        let Ok(msg) = serde_json::from_str::<Value>(&text) else { continue };
        if msg["topic"] != TOPIC {
            continue;
        }
        let payload = &msg["payload"];
        let keep_going = match msg["event"].as_str().unwrap_or("") {
            // Refused: just after Realtime restarts it refuses for a moment
            // (its rules aren't loaded yet), so try again shortly rather
            // than stopping. A bad login fails earlier, when signing in.
            "phx_reply" if payload["status"] == "error" => {
                return Err(Dropped(anyhow!("Realtime refused the channel: {}", payload["response"])));
            }
            // With no tables to watch, the join reply is all there is.
            "phx_reply" if !joined && what.tables.is_empty() && payload["status"] == "ok" => {
                joined = true;
                ready(&mut ch, on_event)?
            }
            // With tables, wait until the database side is ready too.
            "system" if payload["extension"] == "postgres_changes" => {
                if payload["status"] != "ok" {
                    return Err(Dropped(anyhow!("Realtime couldn't watch the database: {}", payload["message"])));
                }
                if joined {
                    true
                } else {
                    joined = true;
                    ready(&mut ch, on_event)?
                }
            }
            "postgres_changes" => {
                let data = &payload["data"];
                fatal(on_event(Event::Change(Change {
                    table: data["table"].as_str().unwrap_or("").to_string(),
                    kind: data["type"].as_str().or_else(|| data["eventType"].as_str()).unwrap_or("").to_string(),
                    record: data["record"].clone(),
                    old_record: data["old_record"].clone(),
                })))?
            }
            "presence_state" => {
                connected = latest_details(payload.as_object());
                fatal(on_event(Event::Connected(connected.clone())))?
            }
            "presence_diff" => {
                for key in payload["leaves"].as_object().into_iter().flat_map(|m| m.keys()) {
                    connected.remove(key);
                }
                connected.extend(latest_details(payload["joins"].as_object()));
                fatal(on_event(Event::Connected(connected.clone())))?
            }
            "phx_error" => return Err(Dropped(anyhow!("Realtime reported an error on the channel"))),
            "phx_close" => return Err(Dropped(anyhow!("Realtime closed the channel"))),
            _ => true,
        };
        if !keep_going {
            break;
        }
    }
    let _ = ch.ws.close(None);
    Ok(())
}

/// `{ key: { metas: [details, ...] } }` to `{ key: latest details }`.
fn latest_details(state: Option<&Map<String, Value>>) -> BTreeMap<String, Value> {
    state
        .into_iter()
        .flatten()
        .filter_map(|(key, v)| {
            let meta = v["metas"].as_array()?.last()?.clone();
            Some((key.clone(), meta))
        })
        .collect()
}

fn connect(supabase: &Supabase) -> Result<WebSocket<MaybeTlsStream<TcpStream>>> {
    let base = if let Some(rest) = supabase.url.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = supabase.url.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        bail!("the Supabase URL should start with http:// or https://");
    };
    let url = format!("{base}/realtime/v1/websocket?apikey={}&vsn=1.0.0", supabase.key);
    let (ws, _) = tungstenite::connect(url.as_str()).context("couldn't connect to Supabase Realtime")?;
    match ws.get_ref() {
        MaybeTlsStream::Plain(s) => s.set_read_timeout(Some(READ_SLICE))?,
        MaybeTlsStream::Rustls(s) => s.get_ref().set_read_timeout(Some(READ_SLICE))?,
        _ => {}
    }
    Ok(ws)
}

/// The channel's name, for anything else that needs it.
pub fn channel_name() -> &'static str {
    TOPIC_NAME
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presence_keeps_the_latest_details_per_key() {
        let state = json!({
            "a": { "metas": [{ "name": "old" }, { "name": "mini" }] },
            "b": { "metas": [{ "name": "laptop" }] },
            "c": { "metas": [] },
        });
        let got = latest_details(state.as_object());
        assert_eq!(got.len(), 2);
        assert_eq!(got["a"]["name"], "mini");
        assert_eq!(got["b"]["name"], "laptop");
    }
}
