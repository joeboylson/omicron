//! `omicron accounts`: Claude accounts on this machine (rewrite of janus).

use anyhow::{Context, Result};
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
    /// Start a Claude Code session that stays on one account, whatever
    /// happens to the shared login. Anything after the name goes to claude.
    Run {
        name: String,
        /// Replace the account's saved long-lived token first
        #[arg(long)]
        new_token: bool,
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
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
        Accounts::Run { name, new_token, args } => run(&name, new_token, &args)?,
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

/// `omicron accounts run`: get the account's long-lived token (asking for
/// one the first time), then become `claude` with it.
fn run(name: &str, new_token: bool, args: &[String]) -> Result<()> {
    use std::io::{BufRead, Write};
    let token = match accounts::session_token(name)? {
        Some(t) if !new_token => t,
        _ => {
            eprintln!("A session that stays on {name} needs a long-lived token for it (it lasts a year).");
            eprintln!("`claude setup-token` opens your browser: sign in there as {name}, then paste the token it prints.\n");
            let status = std::process::Command::new("claude").arg("setup-token").status();
            match status {
                Ok(s) if s.success() => {}
                Ok(_) => anyhow::bail!("`claude setup-token` didn't finish"),
                Err(e) => anyhow::bail!("couldn't run claude: {e}"),
            }
            eprint!("\nPaste the token here: ");
            std::io::stderr().flush()?;
            let mut line = String::new();
            std::io::stdin().lock().read_line(&mut line)?;
            let t = accounts::save_session_token(name, &line)?;
            eprintln!("Saved. `omicron accounts run {name}` won't ask again until it runs out.");
            t
        }
    };
    let left = (token.expires() - chrono::Utc::now()).num_days();
    if left < 0 {
        anyhow::bail!("{name}'s token ran out. Make a new one with `omicron accounts run {name} --new-token`.");
    }
    if left < 30 {
        eprintln!("{name}'s token runs out in {left} days. Replace it with `omicron accounts run {name} --new-token`.");
    }
    use std::os::unix::process::CommandExt;
    let err = std::process::Command::new("claude").args(args).env("CLAUDE_CODE_OAUTH_TOKEN", &token.token).exec();
    Err(err).context("couldn't run claude")
}
