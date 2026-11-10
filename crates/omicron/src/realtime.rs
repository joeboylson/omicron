//! Hearing about database changes as they happen, through Supabase Realtime.
//!
//! Realtime speaks the Phoenix channel protocol over a websocket: join a
//! topic with the tables to watch and a login, send a heartbeat every so
//! often, and change messages arrive on their own. Supabase only sends each
//! listener the rows its access rules let it see.

use crate::supa::{Session, Supabase};
use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
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
    /// The row after the change (empty for a delete).
    pub record: Value,
    /// The row before the change. For deletes, only its key.
    pub old_record: Value,
}

/// What `listen` tells the caller about, besides changes.
pub enum Event {
    /// Subscribed, so changes from now on will arrive.
    Listening,
    /// The connection dropped and will be retried.
    Reconnecting(String),
    Change(Change),
}

/// How often Phoenix wants a heartbeat (it closes silent sockets after ~60s).
const HEARTBEAT: Duration = Duration::from_secs(25);
/// How long to wait for a message before checking the clock again.
const READ_SLICE: Duration = Duration::from_millis(500);

/// Listen for changes to `tables` until `stop` is set.
///
/// `login` gives a fresh login each time it's called (on connect, and before
/// the current one expires). `tick` runs every `tick_every`, for work like
/// checking in. Connection problems are retried with a growing pause;
/// errors from `on_event` or `login` stop the loop.
pub fn listen(
    supabase: &Supabase,
    tables: &[&str],
    mut login: impl FnMut() -> Result<Session>,
    tick_every: Duration,
    mut tick: impl FnMut() -> Result<()>,
    stop: &AtomicBool,
    mut on_event: impl FnMut(Event) -> Result<()>,
) -> Result<()> {
    let mut pause = Duration::from_secs(1);
    let mut last_tick: Option<Instant> = None;
    while !stop.load(Ordering::Relaxed) {
        let session = login()?;
        match run_connection(supabase, tables, session, &mut login, tick_every, &mut tick, &mut last_tick, stop, &mut on_event) {
            Ok(()) => return Ok(()),
            Err(ConnectionError::Fatal(e)) => return Err(e),
            Err(ConnectionError::Dropped(e)) => {
                on_event(Event::Reconnecting(format!("{e:#}")))?;
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

enum ConnectionError {
    /// Worth reconnecting.
    Dropped(anyhow::Error),
    /// Not worth retrying (bad login, the caller wants to stop).
    Fatal(anyhow::Error),
}

const TOPIC: &str = "realtime:omicron";

#[allow(clippy::too_many_arguments)]
fn run_connection(
    supabase: &Supabase,
    tables: &[&str],
    mut session: Session,
    login: &mut impl FnMut() -> Result<Session>,
    tick_every: Duration,
    tick: &mut impl FnMut() -> Result<()>,
    last_tick: &mut Option<Instant>,
    stop: &AtomicBool,
    on_event: &mut impl FnMut(Event) -> Result<()>,
) -> Result<(), ConnectionError> {
    use ConnectionError::{Dropped, Fatal};
    let mut ws = connect(supabase).map_err(Dropped)?;
    let mut next_ref = 1u64;
    let mut send = |ws: &mut WebSocket<MaybeTlsStream<TcpStream>>, topic: &str, event: &str, payload: Value| -> Result<()> {
        let msg = json!({ "topic": topic, "event": event, "payload": payload, "ref": next_ref.to_string() });
        next_ref += 1;
        ws.send(Message::Text(msg.to_string().into())).context("couldn't send to Realtime")
    };

    let changes: Vec<Value> = tables.iter().map(|t| json!({ "event": "*", "schema": "public", "table": t })).collect();
    send(
        &mut ws,
        TOPIC,
        "phx_join",
        json!({
            "config": { "broadcast": { "self": false }, "presence": { "key": "" }, "postgres_changes": changes, "private": false },
            "access_token": session.access_token,
        }),
    )
    .map_err(Dropped)?;

    let mut last_heartbeat = Instant::now();
    // Get a new login a few minutes before this one runs out.
    let mut refresh_at = Instant::now() + Duration::from_secs(session.expires_in.saturating_sub(300).max(60));

    while !stop.load(Ordering::Relaxed) {
        if last_tick.map_or(true, |t| t.elapsed() >= tick_every) {
            tick().map_err(Fatal)?;
            *last_tick = Some(Instant::now());
        }
        if last_heartbeat.elapsed() >= HEARTBEAT {
            send(&mut ws, "phoenix", "heartbeat", json!({})).map_err(Dropped)?;
            last_heartbeat = Instant::now();
        }
        if Instant::now() >= refresh_at {
            session = login().map_err(Fatal)?;
            send(&mut ws, TOPIC, "access_token", json!({ "access_token": session.access_token })).map_err(Dropped)?;
            refresh_at = Instant::now() + Duration::from_secs(session.expires_in.saturating_sub(300).max(60));
        }

        let text = match ws.read() {
            Ok(Message::Text(t)) => t.to_string(),
            Ok(Message::Close(_)) => return Err(Dropped(anyhow!("Realtime closed the connection"))),
            Ok(_) => continue,
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(e) => return Err(Dropped(anyhow!("lost the Realtime connection: {e}"))),
        };
        let msg: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if msg["topic"] != TOPIC {
            continue;
        }
        match msg["event"].as_str().unwrap_or("") {
            "phx_reply" if msg["payload"]["status"] == "error" => {
                return Err(Fatal(anyhow!("Realtime refused to listen: {}", msg["payload"]["response"])));
            }
            // Realtime confirms the database side separately, once it's ready.
            "system" if msg["payload"]["extension"] == "postgres_changes" => {
                if msg["payload"]["status"] == "ok" {
                    on_event(Event::Listening).map_err(Fatal)?;
                } else {
                    return Err(Dropped(anyhow!("Realtime couldn't watch the database: {}", msg["payload"]["message"])));
                }
            }
            "postgres_changes" => {
                let data = &msg["payload"]["data"];
                let change = Change {
                    table: data["table"].as_str().unwrap_or("").to_string(),
                    kind: data["type"].as_str().or_else(|| data["eventType"].as_str()).unwrap_or("").to_string(),
                    record: data["record"].clone(),
                    old_record: data["old_record"].clone(),
                };
                on_event(Event::Change(change)).map_err(Fatal)?;
            }
            "phx_error" => return Err(Dropped(anyhow!("Realtime reported an error on the channel"))),
            "phx_close" => return Err(Dropped(anyhow!("Realtime closed the channel"))),
            _ => {}
        }
    }
    let _ = ws.close(None);
    Ok(())
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
    // Short reads so heartbeats, ticks and stopping happen on time.
    match ws.get_ref() {
        MaybeTlsStream::Plain(s) => s.set_read_timeout(Some(READ_SLICE))?,
        MaybeTlsStream::Rustls(s) => s.get_ref().set_read_timeout(Some(READ_SLICE))?,
        _ => {}
    }
    Ok(ws)
}
