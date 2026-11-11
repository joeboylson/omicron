//! `omicron accounts`: Claude accounts on this machine (rewrite of janus).

use anyhow::Result;
use clap::Subcommand;
use omicron::accounts;

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
        }
        Accounts::Remove { name } => {
            accounts::remove(&name)?;
            println!("Forgot {name}.");
        }
    }
    Ok(())
}
