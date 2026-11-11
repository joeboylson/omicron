//! `omicron accounts`: Claude accounts on this machine (rewrite of janus).

use anyhow::Result;
use clap::Subcommand;
use omicron::accounts::{self, Auto, Window};

#[derive(Subcommand)]
pub enum Accounts {
    /// Save the account Claude Code is logged in to now, under a name
    Add { name: String },
    /// The saved accounts, and which one Claude Code is using
    List,
    /// Switch Claude Code to a saved account. Open sessions follow within
    /// about 30 seconds on a Mac; on Linux, when they next start.
    Use { name: String },
    /// Forget a saved account (Claude Code's own login is left alone)
    Remove { name: String },
    /// How much of each account's 5-hour and weekly limits is used
    Usage,
    /// Switch on its own when the primary account reaches a limit, and back
    /// once it resets (checked every 2 minutes by `omicron daemon`)
    #[command(subcommand)]
    Auto(AutoCmd),
    /// After picking an account by hand, let it switch on its own again
    Resume,
}

#[derive(clap::Subcommand)]
pub enum AutoCmd {
    /// Turn it on, or change a setting
    On {
        #[arg(long)]
        primary: Option<String>,
        #[arg(long)]
        secondary: Option<String>,
        /// Switch at this % of the 5-hour limit
        #[arg(long)]
        five_hour: Option<f64>,
        /// Switch at this % of the weekly limit
        #[arg(long)]
        weekly: Option<f64>,
    },
    Off,
    /// The settings and what it would do now
    Show,
    /// Check now (what the daemon does every 2 minutes)
    Check,
}

pub fn accounts(cmd: Accounts) -> Result<()> {
    match cmd {
        Accounts::Add { name } => {
            let login = accounts::add(&name)?;
            println!("Saved {} as {name}.", login.email());
        }
        Accounts::List => {
            let in_use = accounts::in_use()?;
            let all = accounts::saved()?;
            if all.is_empty() {
                println!("No saved accounts yet. Log in to Claude Code, then `omicron accounts add <name>`.");
            }
            for s in all {
                let mark = if in_use.as_deref() == Some(s.name.as_str()) { "  (in use)" } else { "" };
                println!("{}\t{}{mark}", s.name, s.login.email());
            }
            if in_use.is_none() {
                if let Some(now) = accounts::current()? {
                    println!("Claude Code is logged in to {}, which isn't saved.", now.email());
                }
            }
        }
        Accounts::Use { name } => {
            let s = accounts::switch(&name)?;
            println!("Claude Code is now on {name} ({}).", s.login.email());
            // Picked by hand: it stays here until `resume`.
            let mut auto = Auto::load()?;
            if auto.on() {
                auto.held = Some(name.clone());
                auto.away = false;
                auto.save()?;
                println!("It stays on {name} until `omicron accounts resume`.");
            }
        }
        Accounts::Usage => {
            let all = accounts::saved()?;
            if all.is_empty() {
                println!("No saved accounts yet.");
            }
            let in_use = accounts::in_use()?;
            let now = chrono::Utc::now();
            for s in all {
                let (usage, note) = accounts::check_usage(&s.name);
                let mark = if in_use.as_deref() == Some(s.name.as_str()) { " (in use)" } else { "" };
                println!("{}{mark}", s.name);
                match usage {
                    Some(u) => {
                        println!("  5-hour  {}", describe(u.five_hour, now));
                        println!("  weekly  {}", describe(u.weekly, now));
                    }
                    None => println!("  no numbers yet"),
                }
                if let Some(n) = note {
                    println!("  ({n})");
                }
            }
        }
        Accounts::Resume => {
            let mut auto = Auto::load()?;
            auto.held = None;
            auto.save()?;
            println!("It can switch on its own again.");
        }
        Accounts::Auto(cmd) => auto_cmd(cmd)?,
        Accounts::Remove { name } => {
            accounts::remove(&name)?;
            println!("Forgot {name}.");
        }
    }
    Ok(())
}

fn describe(w: Option<Window>, now: chrono::DateTime<chrono::Utc>) -> String {
    let Some(w) = w.map(|w| w.at(now)) else { return "-".into() };
    let bar_len = (w.percent / 10.0).round().clamp(0.0, 10.0) as usize;
    let bar = format!("{}{}", "#".repeat(bar_len), ".".repeat(10 - bar_len));
    match w.resets_at {
        Some(t) => {
            let mins = (t - now).num_minutes().max(0);
            let left = if mins >= 1440 { format!("{}d {}h", mins / 1440, mins % 1440 / 60) } else { format!("{}h {}m", mins / 60, mins % 60) };
            format!("[{bar}] {:>3}%  resets in {left}", w.percent.round())
        }
        None => format!("[{bar}] {:>3}%", w.percent.round()),
    }
}

fn auto_cmd(cmd: AutoCmd) -> Result<()> {
    let mut auto = Auto::load()?;
    match cmd {
        AutoCmd::On { primary, secondary, five_hour, weekly } => {
            let names: Vec<String> = accounts::saved()?.into_iter().map(|s| s.name).collect();
            for n in primary.iter().chain(secondary.iter()) {
                if !names.contains(n) {
                    anyhow::bail!("there's no saved account called {n}");
                }
            }
            auto.primary = primary.or(auto.primary);
            auto.secondary = secondary.or(auto.secondary);
            auto.five_hour = five_hour.or(auto.five_hour);
            auto.weekly = weekly.or(auto.weekly);
            if auto.five_hour.is_none() && auto.weekly.is_none() {
                auto.weekly = Some(99.0);
                auto.five_hour = Some(99.0);
            }
            if !auto.on() {
                anyhow::bail!("give --primary and --secondary (saved accounts)");
            }
            if auto.primary == auto.secondary {
                anyhow::bail!("the primary and secondary must be different accounts");
            }
            auto.save()?;
            show(&auto);
        }
        AutoCmd::Off => {
            auto = Auto { primary: auto.primary, secondary: auto.secondary, ..Auto::default() };
            auto.save()?;
            println!("Switching on its own is off.");
        }
        AutoCmd::Show => show(&auto),
        AutoCmd::Check => match accounts::auto_tick()? {
            Some(m) => println!("{m}"),
            None => println!("Nothing to do."),
        },
    }
    Ok(())
}

fn show(a: &Auto) {
    if !a.on() {
        println!("Switching on its own is off.");
        return;
    }
    let at = |v: Option<f64>| v.map_or("off".into(), |p| format!("{p}%"));
    println!(
        "On: from {} to {} at {} of the 5-hour limit or {} of the weekly one, and back when it resets.",
        a.primary.as_deref().unwrap_or("?"),
        a.secondary.as_deref().unwrap_or("?"),
        at(a.five_hour),
        at(a.weekly)
    );
    if let Some(h) = &a.held {
        println!("Held on {h} (picked by hand) until `omicron accounts resume`.");
    }
}
