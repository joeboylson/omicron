//! `omicron machines`: registering machines and their keys, which Projects
//! they use, who owns one, which are awake, and opening a terminal on another.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use clap::Subcommand;
use omicron::config::Config;
use omicron::identity;

#[derive(Subcommand)]
pub enum Machines {
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

pub fn machines(m: Machines) -> Result<()> {
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
pub fn awake_machines(supabase: &omicron::supa::Supabase, key: &omicron::supa::MachineKey) -> Result<Vec<String>> {
    Ok(awake(supabase, key)?.into_iter().map(|(name, _)| name).collect())
}

/// Machines that are awake, with their tailnet names when they said them.
pub fn awake(supabase: &omicron::supa::Supabase, key: &omicron::supa::MachineKey) -> Result<Vec<(String, Option<String>)>> {
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

pub fn list_machines(as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    for m in board.machines()? {
        let access = if m.all_projects {
            "every Project".to_string()
        } else if m.projects.is_empty() {
            "no Projects".to_string()
        } else {
            m.projects.join(", ")
        };
        println!("{}  {access}{}", m.name, if m.active { "" } else { "  (switched off)" });
    }
    Ok(())
}

pub fn add_machine(name: &str, project: &str, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    let (p, m) = (board.project(project)?, board.machine(name)?);
    board.add_machine(&p, &m)?;
    println!("Added {} to {}.", m.name, p.name);
    Ok(())
}

pub fn remove_machine(name: &str, project: &str, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    let (p, m) = (board.project(project)?, board.machine(name)?);
    board.remove_machine(&p, &m)?;
    println!("Took {} out of {}.", m.name, p.name);
    Ok(())
}
