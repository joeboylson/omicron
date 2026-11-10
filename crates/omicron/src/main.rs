use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use omicron::config::{self, Config};
use omicron::identity::{self, TailscalePerson};
use serde_json::json;
use uuid::Uuid;

/// Tasks, Projects, and Claude sessions in one tool.
#[derive(Parser)]
#[command(name = "omicron", version)]
struct Cli {
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
    /// Machines: register this one, check in
    #[command(subcommand)]
    Machines(Machines),
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
    /// Sign in with this machine's key and say it's awake
    CheckIn,
}

#[derive(Subcommand)]
enum People {
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
        Command::Machines(m) => machines(m),
        Command::People(p) => people(p),
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
    }
}

fn people(p: People) -> Result<()> {
    match p {
        People::Link { person, login, name } => {
            let supabase = Config::load()?.supabase()?;
            let who = TailscalePerson { display_name: name.unwrap_or_else(|| login.clone()), login };
            supabase.link_tailscale_identity(person, &who)?;
            println!("Linked {} to {person}.", who.login);
            Ok(())
        }
    }
}
