use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use omicron::config::{self, Config};
use omicron::identity::{self, TailscalePerson};
use serde_json::json;
use uuid::Uuid;

mod accounts_cmd;
mod board_cmd;
mod daemon_reactions;
mod dispatch_cmd;
mod doctor_cmd;
mod folders_cmd;
mod guide;
mod handoff_cmd;
mod loops_cmd;
mod picker;
mod runs_cmd;
mod teams_cmd;
mod teams_run;
mod teams_view;
mod sessions_cmd;

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
enum GateCmd {
    /// Open it until a time, like 17:00 or 5pm (today, or tomorrow if that's passed)
    Open {
        #[arg(long)]
        until: String,
    },
    /// Close it now
    Close,
    /// Whether it's open, and until when
    Status,
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
        /// Where visitors' browsers reach Supabase, if not --url (a Web
        /// Machine that reaches Supabase locally)
        #[arg(long)]
        public_url: Option<String>,
    },
    /// Who this machine is signed in to Tailscale as
    Whoami,
    /// What this computer still needs set up, and the command for each
    Doctor,
    /// Tell Claude Code to trust a folder (this one if left out), so a
    /// session Omicron starts there doesn't stop to ask. Omicron does this
    /// itself for folders it starts Claude in.
    Trust { folder: Option<std::path::PathBuf> },
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
    Daemon {
        #[command(subcommand)]
        action: Option<DaemonAction>,
    },
    /// Machines: register this one, check in
    #[command(subcommand)]
    Machines(Machines),
    /// Projects: list them, start one
    #[command(subcommand)]
    Projects(board_cmd::Projects),
    /// A Project's statuses (its columns)
    #[command(subcommand)]
    Statuses(board_cmd::Statuses),
    /// A Project's labels and their colors
    #[command(subcommand)]
    Labels(board_cmd::Labels),
    /// A Project's topics: a second way to group tasks, as rows on the board
    #[command(subcommand)]
    Topics(board_cmd::Topics),
    /// Loops: Omicron types a prompt into a session every so often
    #[command(subcommand)]
    Loops(loops_cmd::Loops),
    /// Teams of Claude sessions: set a folder up, start a team, give it jobs
    #[command(subcommand)]
    Teams(teams_cmd::Teams),
    /// Tasks: add, move, finish, label, checklists
    #[command(subcommand)]
    Tasks(board_cmd::Tasks),
    /// People: link Tailscale identities
    #[command(subcommand)]
    People(People),
    /// Open a Claude session and jump in: one of this machine's by name, or
    /// a new one (asks for its name; --resume starts from an existing Claude
    /// conversation). It runs in the background and gets messages from the
    /// web page and other machines. Ctrl-\ lets go and leaves it running;
    /// quitting Claude ends it.
    /// Link the Claude chat this runs in (type `! omicron link` in it): it
    /// becomes an Omicron session without quitting. Named after its folder
    /// if no name is given.
    Link {
        name: Option<String>,
        /// Its Project (not needed in a known folder, or when this machine is in only one)
        #[arg(long)]
        project: Option<String>,
    },
    Open {
        /// The session's name (a new one is named after the folder if left out)
        name: Option<String>,
        /// Its Project (not needed when this machine is in only one)
        #[arg(long)]
        project: Option<String>,
        /// An existing Claude conversation (Claude Code's session id) to
        /// bring in
        #[arg(long)]
        resume: Option<String>,
        /// The folder to work in, for a new session (this one if left out)
        #[arg(long)]
        folder: Option<std::path::PathBuf>,
    },
    /// Let go of the session this runs in, leaving it running (like
    /// Ctrl-\): `! omicron detach` from inside it
    Detach,
    /// The gate: whether this computer takes work from elsewhere (the web
    /// page, other machines). Closed unless opened here; at most 24 hours
    #[command(subcommand)]
    Gate(GateCmd),
    /// Claude sessions: list them, pick one, send one a message
    #[command(subcommand)]
    Sessions(sessions_cmd::Sessions),
    /// Handoff notes: write where a session stopped; the next conversation
    /// in its window (after /clear) starts with it
    #[command(subcommand)]
    Handoff(handoff_cmd::HandoffCmd),
    /// Folders on this machine where a Project's sessions start: add, list, remove
    #[command(subcommand)]
    Folders(folders_cmd::FoldersCmd),
    /// Runs: a session works down a Project's To do column on its own
    #[command(subcommand)]
    Runs(runs_cmd::RunsCmd),
    /// Claude accounts on this machine: save, switch (rewrite of janus)
    #[command(subcommand)]
    Accounts(accounts_cmd::Accounts),
    /// Claude Code hooks (set up by `omicron sessions setup-claude`)
    #[command(subcommand, hide = true)]
    Hook(sessions_cmd::Hook),
}

#[derive(Subcommand)]
enum DaemonAction {
    /// Start the daemon now and each time you log in (launchd on macOS,
    /// systemd on Linux)
    StartAtLogin {
        /// Only print the service file and where it would go
        #[arg(long)]
        print: bool,
    },
    /// Stop the daemon and stop starting it at login
    StopAtLogin,
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
    /// Open a terminal on another awake machine (ssh over Tailscale). Lists
    /// them to choose from when none is named.
    Pick { machine: Option<String> },
    /// Save an API key made on another machine with `register --print`
    UseKey {
        key: String,
    },
    /// Set who owns this machine: the only person who can send it orders
    /// (dispatches, loops), while its gate is open. Run on the machine
    /// itself; without a login, it's you (your Tailscale login).
    Owner { login: Option<String> },
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
    /// Delete a person for good: their login and their place in every
    /// Project (tasks given to them are given to nobody). Needs the secret key.
    Delete { person: String },
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
    // When what we print is cut short (`omicron tasks list | head`), stop
    // quietly like other command-line tools, instead of crashing.
    unsafe {
        nix::libc::signal(nix::libc::SIGPIPE, nix::libc::SIG_DFL);
    }
    // Missing parts of the command are asked for, when someone's here to answer.
    let args = match guide::complete::<Cli>(std::env::args().collect()) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("omicron: {e:#}");
            std::process::exit(1);
        }
    };
    if let Err(e) = run(Cli::parse_from(args)) {
        eprintln!("omicron: {e:#}");
        std::process::exit(1);
    }
}

fn run(cli: Cli) -> Result<()> {
    match cli.command {
        Command::Setup { url, key, secret_key, public_url } => setup(url, key, secret_key, public_url),
        Command::Trust { folder } => {
            let folder = match folder {
                Some(f) => f,
                None => std::env::current_dir()?,
            };
            omicron::trust::trust(&folder)?;
            println!("Claude Code trusts {}.", std::path::absolute(&folder)?.display());
            Ok(())
        }
        Command::Whoami => {
            let person = identity::local_person()?;
            println!("{} ({})", person.display_name, person.login);
            Ok(())
        }
        Command::Doctor => doctor_cmd::doctor(),
        Command::Serve { port, hosts } => {
            let config = Config::load()?;
            let supabase = config.supabase()?;
            let public_supabase_url = config.public_supabase_url.clone();
            // This computer's own Tailscale name is always fine, so
            // `tailscale serve` works without saying it.
            let mut hosts = hosts;
            if let Some(name) = identity::local_tailnet_name() {
                hosts.push(name);
            }
            omicron::web::WebMachine { supabase, public_supabase_url, extra_hosts: hosts }.serve(port)
        }
        Command::Open { name, project, resume, folder } => sessions_cmd::open(name, project, resume, folder),
        Command::Detach => {
            let name = std::env::var("OMICRON_SESSION").ok().filter(|n| !n.is_empty()).context("run this inside a session opened with `omicron open`")?;
            omicron::host::detach(&name)
        }
        Command::Gate(cmd) => {
            let changes = !matches!(cmd, GateCmd::Status);
            match cmd {
                GateCmd::Open { until } => {
                    omicron::gate::open(&until)?;
                    // Pass on what waited for the gate: team answers and jobs.
                    let config = Config::load()?;
                    if let (Ok(supabase), Ok(key)) = (config.supabase(), config.machine_key()) {
                        if let Err(e) = teams_run::pass_waiting(&supabase, &key, true) {
                            eprintln!("couldn't pass on what waited for the gate: {e:#}");
                        }
                    }
                }
                GateCmd::Close => omicron::gate::close()?,
                GateCmd::Status => {}
            }
            // Pages show it (the computer still decides).
            if changes {
                let config = Config::load()?;
                if let (Ok(supabase), Ok(key)) = (config.supabase(), config.machine_key()) {
                    if let Err(e) = omicron::board::Board::as_machine(&supabase, &key).and_then(|b| omicron::gate::report(&b)) {
                        eprintln!("couldn't tell Omicron about the gate: {e:#}");
                    }
                }
            }
            println!("{}", omicron::gate::status());
            Ok(())
        }
        Command::Sessions(cmd) => sessions_cmd::sessions(cmd, cli.as_machine),
        Command::Labels(cmd) => board_cmd::labels(cmd, cli.as_machine),
        Command::Topics(cmd) => board_cmd::topics(cmd, cli.as_machine),
        Command::Loops(cmd) => loops_cmd::loops(cmd, cli.as_machine),
        Command::Teams(cmd) => teams_cmd::teams(cmd, cli.as_machine),
        Command::Hook(event) => sessions_cmd::hook(event),
        Command::Handoff(cmd) => handoff_cmd::handoff(cmd, cli.as_machine),
        Command::Folders(cmd) => folders_cmd::folders(cmd, cli.as_machine),
        Command::Runs(cmd) => runs_cmd::runs(cmd, cli.as_machine),
        Command::Link { name, project } => sessions_cmd::link(name, project),
        Command::Accounts(cmd) => accounts_cmd::accounts(cmd),
        Command::Daemon { action: None } => daemon(),
        Command::Daemon { action: Some(DaemonAction::StartAtLogin { print: true }) } => {
            let file = omicron::login::this_service_file()?;
            println!("# {}", file.path.display());
            print!("{}", file.contents);
            Ok(())
        }
        Command::Daemon { action: Some(DaemonAction::StartAtLogin { print: false }) } => {
            // Check it can run before asking the system to keep starting it.
            Config::load()?.machine_key()?;
            let path = omicron::login::start_at_login()?;
            println!("The daemon is running and will start each time you log in ({}).", path.display());
            println!("Its errors go to {}.", config::home()?.join("daemon.log").display());
            if omicron::login::System::here()? == omicron::login::System::Linux {
                println!("On a machine nobody logs in to, also run `loginctl enable-linger` so it starts at boot.");
            }
            Ok(())
        }
        Command::Daemon { action: Some(DaemonAction::StopAtLogin) } => {
            match omicron::login::stop_at_login()? {
                Some(path) => println!("Stopped the daemon and removed {}.", path.display()),
                None => println!("The daemon wasn't set to start at login."),
            }
            Ok(())
        }
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

fn setup(url: Option<String>, key: Option<String>, secret_key: Option<String>, public_url: Option<String>) -> Result<()> {
    if url.is_none() && key.is_none() && secret_key.is_none() && public_url.is_none() {
        bail!("give at least one of --url, --key, --secret-key, --public-url");
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
    if let Some(p) = public_url {
        config.public_supabase_url = Some(p.trim_end_matches('/').to_string());
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
            // Its owner: the person making the key, if they've signed in to Omicron.
            let supabase = config.supabase()?;
            let owner = match omicron::identity::local_person() {
                Ok(me) => supabase.person_for_login(&me.login)?,
                Err(_) => None,
            };
            let key = supabase.register_machine(&name, all_projects, owner)?;
            if owner.is_none() {
                eprintln!("It has no owner yet, so it takes orders only from itself. On it, run `omicron machines owner <your Tailscale login>`.");
            }
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
        Machines::Owner { login } => {
            let board = omicron::board::Board::as_machine(&config.supabase()?, &config.machine_key()?)?;
            let login = match login {
                Some(l) => l,
                None => omicron::identity::local_person().context("couldn't tell who you are: give a Tailscale login")?.login,
            };
            let name = board.set_owner(&login)?;
            println!("{} owns this machine now: only they can send it orders, while its gate is open.", name.as_deref().unwrap_or(&login));
            Ok(())
        }
        Machines::CheckIn => {
            let board = omicron::board::Board::as_machine(&config.supabase()?, &config.machine_key()?)?;
            board.check_in()?;
            let (name, active) = board.my_machine()?;
            if !active {
                println!("{name} is switched off.");
            } else {
                println!("{name} checked in.");
            }
            Ok(())
        }
        Machines::List | Machines::Add { .. } | Machines::Remove { .. } => unreachable!("handled in run"),
        Machines::SwitchOn { machine } => {
            if !config.supabase()?.switch_on_machine(&machine)? {
                bail!("no machine called {machine}");
            }
            println!("Switched {machine} on.");
            Ok(())
        }
        Machines::Pick { machine } => {
            let supabase = config.supabase()?;
            let key = config.machine_key()?;
            let me = identity::local_tailnet_name();
            let others: Vec<(String, String)> = awake(&supabase, &key)?
                .into_iter()
                .filter_map(|(name, host)| Some((name, host?)))
                .filter(|(_, host)| Some(host) != me.as_ref())
                .collect();
            let (name, host) = match machine {
                Some(want) => others
                    .into_iter()
                    .find(|(n, h)| n.eq_ignore_ascii_case(&want) || h.split('.').next() == Some(want.as_str()))
                    .with_context(|| format!("{want} isn't awake (its daemon isn't running), or it's this machine"))?,
                None => pick_one(others)?,
            };
            eprintln!("Opening a terminal on {name} ({host})…");
            exec_ssh(&host)
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
    Ok(awake(supabase, key)?.into_iter().map(|(name, _)| name).collect())
}

/// Machines that are awake, with their tailnet names when they said them.
fn awake(supabase: &omicron::supa::Supabase, key: &omicron::supa::MachineKey) -> Result<Vec<(String, Option<String>)>> {
    use omicron::realtime::{self, Event, Listen, Next};
    let stop = std::sync::atomic::AtomicBool::new(false);
    let mut names = None;
    let started = std::time::Instant::now();
    realtime::listen(supabase, &Listen { tables: &[], announce: None }, || supabase.sign_in_machine(key), &stop, |event| {
        Ok(match event {
            Event::Connected(who) => {
                names = Some(
                    who.values()
                        .filter_map(|d| Some((d["name"].as_str()?.to_string(), d["host"].as_str().map(String::from))))
                        .collect::<Vec<_>>(),
                );
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
        People::Delete { person } => {
            let board = board_cmd::sign_in(false)?;
            let p = board.person(&person)?;
            if p.id == board.me() {
                bail!("you can't delete yourself");
            }
            board.supabase().delete_person(p.id.parse()?)?;
            println!("Deleted {}: their login and their place in every Project.", p.name);
            Ok(())
        }
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

/// Ask which machine, by number.
fn pick_one(machines: Vec<(String, String)>) -> Result<(String, String)> {
    use std::io::{BufRead, IsTerminal, Write};
    if machines.is_empty() {
        bail!("no other machine is awake (a machine is awake while its `omicron daemon` runs)");
    }
    for (i, (name, host)) in machines.iter().enumerate() {
        eprintln!("{}. {name}  {host}", i + 1);
    }
    if !std::io::stdin().is_terminal() {
        bail!("name one: `omicron machines pick <machine>`");
    }
    eprint!("Which one? ");
    std::io::stderr().flush()?;
    let mut answer = String::new();
    std::io::stdin().lock().read_line(&mut answer)?;
    let n: usize = answer.trim().parse().context("type the number of the machine")?;
    machines.into_iter().nth(n.wrapping_sub(1)).context("there's no machine with that number")
}

/// Replace this process with `ssh <host>`, so the terminal tab becomes the
/// other machine's.
fn exec_ssh(host: &str) -> Result<()> {
    use std::os::unix::process::CommandExt;
    let err = std::process::Command::new("ssh").arg(host).exec();
    Err(err).context("couldn't run ssh")
}
