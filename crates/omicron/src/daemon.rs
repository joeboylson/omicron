//! The daemon: shows this machine as awake, follows the change list, and
//! hands each line to its reactions (daemon_reactions.rs).

use crate::{daemon_reactions, loops_cmd};
use anyhow::{bail, Result};
use omicron::config::Config;
use omicron::identity;
use serde_json::json;

/// Run in the background.
///
/// Shows this machine as awake on the shared channel (there's no check-in
/// timer: it drops off the moment it disconnects), reads the lines of the
/// change list it missed while it was off, then prints each new line as it
/// arrives. Each line is printed once, in order, even across restarts.
pub fn daemon() -> Result<()> {
    use omicron::config::State;
    use omicron::realtime::{self, Event, Listen, Next};

    let config = Config::load()?;
    let supabase = config.supabase()?;
    let key = config.machine_key()?;
    let (name, active) = omicron::board::Board::as_machine(&supabase, &key)?.my_machine()?;
    if !active {
        let why = format!("{name} is switched off (machines are switched off after 30 days unseen). Switch it back on from a Web Machine with `omicron machines switch-on {name}`.");
        // Started at login, this is a normal stop, so the service doesn't
        // keep restarting it.
        if std::env::var(omicron::login::SERVICE_ENV).is_ok_and(|v| v == "1") {
            eprintln!("omicron: {why}");
            return Ok(());
        }
        bail!(why);
    }
    // Switching Claude accounts on their own: Anthropic's usage numbers can
    // only be read by asking, so this checks every 2 minutes while it's on.
    // It also tells Supabase which account this machine uses and how much
    // is left (names and numbers only), when that changes.
    {
        let (supabase, key) = (supabase.clone(), key.clone());
        std::thread::spawn(move || {
            let mut last_sent: Option<serde_json::Value> = None;
            loop {
                if !omicron::accounts::saved().unwrap_or_default().is_empty() {
                    match omicron::accounts::refresh_usage() {
                        Ok(Some(m)) => eprintln!("omicron daemon: {m}"),
                        Ok(None) => {}
                        Err(e) => eprintln!("omicron daemon: checking accounts: {e:#}"),
                    }
                    if let Ok(Some(info)) = omicron::accounts::report() {
                        if last_sent.as_ref() != Some(&info) {
                            let sent = omicron::board::Board::as_machine(&supabase, &key).and_then(|b| b.report_claude_accounts(&info));
                            match sent {
                                Ok(_) => last_sent = Some(info),
                                Err(e) => eprintln!("omicron daemon: reporting accounts: {e:#}"),
                            }
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(120));
            }
        });
    }
    let mut state = State::load()?;
    let stop = std::sync::atomic::AtomicBool::new(false);

    let listen = Listen {
        tables: &["changes"],
        // The tailnet name lets other machines open a terminal here.
        announce: Some((
            key.machine_id.to_string(),
            json!({ "kind": "machine", "machine_id": key.machine_id, "name": name, "host": identity::local_tailnet_name() }),
        )),
    };
    // Each new login (on connect, and about hourly after) also records that
    // this machine is still around, so one in use never hits the 30-day
    // switch-off.
    let login = || {
        let board = omicron::board::Board::as_machine(&supabase, &key)?;
        board.check_in()?;
        // And its gate, in case it closed by itself or changed by hand.
        if let Err(e) = omicron::gate::report(&board) {
            eprintln!("couldn't tell Omicron about the gate: {e:#}");
        }
        Ok(board.login().clone())
    };
    // Things this machine does when it hears about them, each in its own
    // thread so listening carries on. Each is safe to run twice.
    // Sessions' loops on this machine, run when due.
    let runner = loops_cmd::Runner::start(supabase.clone(), key.clone());
    let reactions = omicron::reactions::Reactions::start(
        vec![
            std::sync::Arc::new(daemon_reactions::Loops(runner.clone())),
            std::sync::Arc::new(daemon_reactions::RunSteps { supabase: supabase.clone(), key: key.clone() }),
            std::sync::Arc::new(daemon_reactions::Teams { supabase: supabase.clone(), key: key.clone() }),
            std::sync::Arc::new(daemon_reactions::Dispatch { supabase: supabase.clone(), key: key.clone(), name: name.clone() }),
            std::sync::Arc::new(daemon_reactions::StoppedSessions { supabase: supabase.clone(), key: key.clone() }),
        ],
        std::sync::Arc::new(|m| eprintln!("omicron daemon: {m}")),
    );
    let react = |row: &serde_json::Value| reactions.heard(row);
    realtime::listen(&supabase, &listen, login, &stop, |event| {
        match event {
            // On start-up and after every reconnect (Realtime fires it each
            // time it connects): catch up on missed lines, then each
            // reaction's after-listening work (see reactions.rs).
            Event::Listening => {
                // A catch-up that fails can't be skipped (listening on would
                // pass over the missed lines), so connect again and retry.
                // Only a failure to save what's handled (this computer's own
                // disk) ends the daemon.
                let mut disk = None;
                let caught_up = omicron::board::Board::as_machine(&supabase, &key).and_then(|board| {
                    let source = omicron::changes::SupabaseChanges(&board);
                    let mut save = |s: &State| {
                        s.save().inspect_err(|e| disk = Some(anyhow::anyhow!("couldn't save which changes are handled: {e:#}")))
                    };
                    omicron::changes::catch_up(&source, &mut state, &mut save, &mut std::io::stdout().lock(), &react)
                });
                if let Some(e) = disk {
                    return Err(e);
                }
                if let Err(e) = caught_up {
                    eprintln!("omicron daemon: catching up: {e:#}");
                    return Ok(Next::Reconnect);
                }
                reactions.after_listening();
                eprintln!("omicron daemon: {name} is listening for changes");
            }
            Event::Reconnecting(why) => eprintln!("omicron daemon: reconnecting ({why})"),
            Event::Change(c) if c.table == "changes" => {
                omicron::changes::handle(&c.record, &mut state, &mut |s| s.save(), &mut std::io::stdout().lock(), &react)?
            }
            Event::Change(_) | Event::Connected(_) => {}
        }
        Ok(Next::Continue)
    })
}

