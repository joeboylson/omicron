use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use omicron::config::{self, Config};
use omicron::identity;

mod accounts_cmd;
mod board_cmd;
mod daemon;
mod daemon_reactions;
mod dispatch_cmd;
mod doctor_cmd;
mod folders_cmd;
mod guide;
mod handoff_cmd;
mod loops_cmd;
mod machines_cmd;
mod people_cmd;
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
    Machines(machines_cmd::Machines),
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
    People(people_cmd::People),
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
        Command::Daemon { action: None } => daemon::daemon(),
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
        Command::Machines(machines_cmd::Machines::List) => board_cmd::list_machines(cli.as_machine),
        Command::Machines(machines_cmd::Machines::Add { machine, project }) => board_cmd::add_machine(&machine, &project, cli.as_machine),
        Command::Machines(machines_cmd::Machines::Remove { machine, project }) => board_cmd::remove_machine(&machine, &project, cli.as_machine),
        Command::Machines(m) => machines_cmd::machines(m),
        Command::People(people_cmd::People::List) => board_cmd::list_people(cli.as_machine),
        Command::People(people_cmd::People::Add { person, project }) => board_cmd::add_person(&person, &project, cli.as_machine),
        Command::People(people_cmd::People::Remove { person, project }) => board_cmd::remove_person(&person, &project, cli.as_machine),
        Command::People(p) => people_cmd::people(p),
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

