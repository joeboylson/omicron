use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use omicron::config::{self, Config};
use omicron::identity::{self, TailscalePerson};
use serde_json::json;
use uuid::Uuid;

mod board_cmd;

/// Tasks, Projects, and Claude sessions in one tool.
#[derive(Parser)]
#[command(name = "omicron", version)]
struct Cli {
    /// Act as this machine instead of as you (how Claude sessions act)
    #[arg(long, global = true)]
    as_machine: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Connect this machine to a Supabase project
    Setup {
        /// The Supabase project URL
        #[arg(long)]
        url: Option<String>,
        /// The publishable (or anon) key
        #[arg(long)]
        key: Option<String>,
        /// The secret key. Only for Web Machines.
        #[arg(long)]
        secret_key: Option<String>,
    },
    /// Who this machine is signed in to Tailscale as
    Whoami,
    /// Serve the web page on this machine (makes it a Web Machine)
    Serve {
        /// The port on 127.0.0.1 to listen on (0 picks a free one)
        #[arg(long, default_value_t = 8787)]
        port: u16,
        /// Another host name the page may be opened at, like this machine's
        /// Tailscale name. Can be given more than once.
        #[arg(long = "host")]
        hosts: Vec<String>,
    },
    /// Run in the background: show this machine as awake, catch up on
    /// missed changes, then print each new change as one JSON line
    Daemon,
    /// Machines: register this one, check in
    #[command(subcommand)]
    Machines(Machines),
    /// Projects: list them, start one
    #[command(subcommand)]
    Projects(board_cmd::Projects),
    /// A Project's statuses (its columns)
    #[command(subcommand)]
    Statuses(board_cmd::Statuses),
    /// Tasks: add, move, finish, label, checklists
    #[command(subcommand)]
    Tasks(board_cmd::Tasks),
    /// People: link Tailscale identities
    #[command(subcommand)]
    People(People),
}

#[derive(Subcommand)]
enum Machines {
    /// Register a machine and make its API key. Needs the secret key.
    Register {
        /// A name for the machine, like `mac-mini`
        name: String,
        /// Let the machine use every Project, including future ones
        #[arg(long)]
        all_projects: bool,
        /// Print the key instead of saving it here (to set up another machine)
        #[arg(long)]
        print: bool,
    },
    /// Save an API key made on another machine with `register --print`
    UseKey {
        key: String,
    },
    /// Sign in with this machine's key and record when it was last seen
    CheckIn,
    /// List the machines that are awake right now
    Awake,
    /// List machines and the Projects they can use
    List,
    /// Let a machine use a Project
    Add { machine: String, project: String },
    /// Take a machine out of a Project
    Remove { machine: String, project: String },
    /// Switch a machine back on (after 30 days unseen, or by hand). Needs the secret key.
    SwitchOn { machine: String },
}

#[derive(Subcommand)]
enum People {
    /// The people table: everyone, with their logins and Projects
    List,
    /// Add a person to a Project (by name or Tailscale login)
    Add { person: String, project: String },
    /// Take a person out of a Project
    Remove { person: String, project: String },
    /// Link another Tailscale identity to a person. Needs the secret key.
    Link {
        /// The person's ID
        person: Uuid,
        /// The Tailscale login, like `someone@github`
        login: String,
        /// The name to show for this identity
        #[arg(long)]
        name: Option<String>,
    },
}

fn main() {
    if let Err(e) = run(Cli::parse()) {
        eprintln!("omicron: {e:#}");
        std::process::exit(1);
    }
}

fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Setup { url, key, secret_key } => setup(url, key, secret_key),
        Command::Whoami => {
            let person = identity::local_person()?;
            println!("{} ({})", person.display_name, person.login);
            Ok(())
        }
        Command::Serve { port, hosts } => {
            let supabase = Config::load()?.supabase()?;
            omicron::web::WebMachine { supabase, extra_hosts: hosts }.serve(port)
        }
        Command::Daemon => daemon(),
        Command::Machines(Machines::List) => board_cmd::list_machines(cli.as_machine),
        Command::Machines(Machines::Add { machine, project }) => board_cmd::add_machine(&machine, &project, cli.as_machine),
        Command::Machines(Machines::Remove { machine, project }) => board_cmd::remove_machine(&machine, &project, cli.as_machine),
        Command::Machines(m) => machines(m),
        Command::People(People::List) => board_cmd::list_people(cli.as_machine),
        Command::People(People::Add { person, project }) => board_cmd::add_person(&person, &project, cli.as_machine),
        Command::People(People::Remove { person, project }) => board_cmd::remove_person(&person, &project, cli.as_machine),
        Command::People(p) => people(p),
        Command::Projects(c) => board_cmd::projects(c, cli.as_machine),
        Command::Statuses(c) => board_cmd::statuses(c, cli.as_machine),
        Command::Tasks(c) => board_cmd::tasks(c, cli.as_machine),
    }
}

fn setup(url: Option<String>, key: Option<String>, secret_key: Option<String>) -> Result<()> {
    if url.is_none() && key.is_none() && secret_key.is_none() {
        bail!("give at least one of --url, --key, --secret-key");
    }
    let mut config = Config::load()?;
    if let Some(u) = url {
        config.supabase_url = Some(u);
    }
    if let Some(k) = key {
        config.supabase_key = Some(k);
    }
    if let Some(s) = secret_key {
        config.supabase_secret_key = Some(s);
    }
    config.save()?;
    println!("Saved to {}", config::path()?.display());
    Ok(())
}

fn machines(m: Machines) -> Result<()> {
    let mut config = Config::load()?;
    match m {
        Machines::Register { name, all_projects, print } => {
            if !print && config.machine_key.is_some() {
                bail!("this machine is already registered. Use --print to make a key for another machine.");
            }
            let key = config.supabase()?.register_machine(&name, all_projects)?;
            if print {
                println!("{key}");
                eprintln!("Machine {name} registered. On that machine, run: omicron machines use-key <the key above>");
            } else {
                config.machine_key = Some(key.to_string());
                config.save()?;
                println!("Registered this machine as {name}.");
            }
            Ok(())
        }
        Machines::UseKey { key } => {
            let parsed: omicron::supa::MachineKey = key.parse()?;
            // Check it works before saving it.
            config.supabase()?.sign_in_machine(&parsed)?;
            config.machine_key = Some(parsed.to_string());
            config.save()?;
            println!("Saved this machine's key.");
            Ok(())
        }
        Machines::CheckIn => {
            let supabase = config.supabase()?;
            let key = config.machine_key()?;
            let session = supabase.sign_in_machine(&key)?;
            supabase.request_as(&session, "POST", "/rest/v1/rpc/machine_check_in", Some(json!({})))?;
            let rows = supabase.request_as(&session, "GET", &format!("/rest/v1/machines?id=eq.{}&select=name,active", key.machine_id), None)?;
            let row = rows.get(0).context("this machine's record is missing")?;
            let name = row["name"].as_str().unwrap_or("?");
            if row["active"].as_bool() == Some(false) {
                println!("{name} is switched off.");
            } else {
                println!("{name} checked in.");
            }
            Ok(())
        }
        Machines::List | Machines::Add { .. } | Machines::Remove { .. } => unreachable!("handled in run"),
        Machines::SwitchOn { machine } => {
            let supabase = config.supabase()?;
            let rows = supabase.admin_request(
                "PATCH",
                &format!("/rest/v1/machines?name=eq.{}", machine.replace(' ', "%20")),
                Some(json!({ "active": true })),
            )?;
            if rows.as_array().is_some_and(|a| a.is_empty()) {
                bail!("no machine called {machine}");
            }
            println!("Switched {machine} on.");
            Ok(())
        }
        Machines::Awake => {
            let supabase = config.supabase()?;
            let key = config.machine_key()?;
            for name in awake_machines(&supabase, &key)? {
                println!("{name}");
            }
            Ok(())
        }
    }
}

/// Join the shared channel just long enough to see who's connected.
fn awake_machines(supabase: &omicron::supa::Supabase, key: &omicron::supa::MachineKey) -> Result<Vec<String>> {
    use omicron::realtime::{self, Event, Listen, Next};
    let stop = std::sync::atomic::AtomicBool::new(false);
    let mut names = None;
    let started = std::time::Instant::now();
    realtime::listen(supabase, &Listen { tables: &[], announce: None }, || supabase.sign_in_machine(key), &stop, |event| {
        Ok(match event {
            Event::Connected(who) => {
                names = Some(who.values().filter_map(|d| d["name"].as_str().map(String::from)).collect::<Vec<_>>());
                Next::Stop
            }
            Event::Reconnecting(why) if started.elapsed().as_secs() > 10 => bail!("couldn't reach Realtime: {why}"),
            _ => Next::Continue,
        })
    })?;
    let mut names = names.context("Realtime didn't say who's connected")?;
    names.sort();
    Ok(names)
}

fn people(p: People) -> Result<()> {
    match p {
        People::List | People::Add { .. } | People::Remove { .. } => unreachable!("handled in run"),
        People::Link { person, login, name } => {
            let supabase = Config::load()?.supabase()?;
            let who = TailscalePerson { display_name: name.unwrap_or_else(|| login.clone()), login };
            supabase.link_tailscale_identity(person, &who)?;
            println!("Linked {} to {person}.", who.login);
            Ok(())
        }
    }
}

/// Run in the background.
///
/// Shows this machine as awake on the shared channel (there's no check-in
/// timer: it drops off the moment it disconnects), reads the lines of the
/// change list it missed while it was off, then prints each new line as it
/// arrives. Each line is printed once, in order, even across restarts.
fn daemon() -> Result<()> {
    use omicron::config::State;
    use omicron::realtime::{self, Event, Listen, Next};

    let config = Config::load()?;
    let supabase = config.supabase()?;
    let key = config.machine_key()?;
    let first = supabase.sign_in_machine(&key)?;
    let me = supabase.request_as(&first, "GET", &format!("/rest/v1/machines?id=eq.{}&select=name,active", key.machine_id), None)?;
    let row = me.get(0).context("this machine's record is missing")?;
    let name = row["name"].as_str().unwrap_or("?").to_string();
    if row["active"].as_bool() == Some(false) {
        bail!("{name} is switched off (machines are switched off after 30 days unseen). Switch it back on from a Web Machine with `omicron machines switch-on {name}`.");
    }
    let mut state = State::load()?;
    let stop = std::sync::atomic::AtomicBool::new(false);

    let listen = Listen {
        tables: &["changes"],
        announce: Some((key.machine_id.to_string(), json!({ "kind": "machine", "machine_id": key.machine_id, "name": name }))),
    };
    // Each new login (on connect, and about hourly after) also records that
    // this machine is still around, so one in use never hits the 30-day
    // switch-off.
    let login = || {
        let session = supabase.sign_in_machine(&key)?;
        supabase.request_as(&session, "POST", "/rest/v1/rpc/machine_check_in", Some(json!({})))?;
        Ok(session)
    };
    realtime::listen(&supabase, &listen, login, &stop, |event| {
        match event {
            Event::Listening => {
                let session = supabase.sign_in_machine(&key)?;
                catch_up(&supabase, &session, &mut state)?;
                eprintln!("omicron daemon: {name} is listening for changes");
            }
            Event::Reconnecting(why) => eprintln!("omicron daemon: reconnecting ({why})"),
            Event::Change(c) if c.table == "changes" => handle_change(&c.record, &mut state)?,
            Event::Change(_) | Event::Connected(_) => {}
        }
        Ok(Next::Continue)
    })
}

/// Read the change list from where this machine left off, plus every line
/// from the last second (in case one finished saving late). The first time,
/// start from now instead of replaying all of history.
fn catch_up(supabase: &omicron::supa::Supabase, session: &omicron::supa::Session, state: &mut omicron::config::State) -> Result<()> {
    let window = supabase.request_as(session, "POST", "/rest/v1/rpc/recent_changes", Some(json!({})))?;
    let window = window.as_array().cloned().unwrap_or_default();
    let Some(mut last) = state.last_change else {
        let newest = supabase.request_as(session, "GET", "/rest/v1/changes?select=seq&order=seq.desc&limit=1", None)?;
        // Mark what's there as handled, without printing it.
        for row in &window {
            if let Some(seq) = row["seq"].as_i64() {
                state.mark(seq);
            }
        }
        state.last_change = Some(newest.get(0).and_then(|r| r["seq"].as_i64()).unwrap_or(0).max(state.last_change.unwrap_or(0)));
        return state.save();
    };
    const PAGE: usize = 500;
    loop {
        let rows = supabase.request_as(session, "GET", &format!("/rest/v1/changes?seq=gt.{last}&order=seq.asc&limit={PAGE}"), None)?;
        let rows = rows.as_array().cloned().unwrap_or_default();
        for row in &rows {
            handle_change(row, state)?;
        }
        match state.last_change {
            Some(now) if rows.len() == PAGE && now > last => last = now,
            _ => break,
        }
    }
    for row in &window {
        handle_change(row, state)?;
    }
    Ok(())
}

/// Print one line of the change list, unless it was already handled.
fn handle_change(row: &serde_json::Value, state: &mut omicron::config::State) -> Result<()> {
    use std::io::Write;
    let Some(seq) = row["seq"].as_i64() else { return Ok(()) };
    if !state.is_new(seq) {
        return Ok(());
    }
    let line = json!({
        "seq": seq,
        "at": row["at"],
        "table": row["table_name"],
        "type": row["kind"],
        "project_id": row["project_id"],
        "actor_id": row["actor_id"],
        "record": row["record"],
        "old_record": row["old_record"],
    });
    let mut out = std::io::stdout().lock();
    writeln!(out, "{line}")?;
    out.flush()?;
    state.mark(seq);
    state.save()
}
