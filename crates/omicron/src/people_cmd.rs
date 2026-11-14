//! `omicron people`: the people table, adding and taking people out of a
//! Project, deleting a person and linking another login to one (those two
//! need the secret key).

use crate::board_cmd;
use crate::board_cmd::sign_in;
use anyhow::{bail, Result};
use clap::Subcommand;
use omicron::config::Config;
use omicron::identity::TailscalePerson;
use uuid::Uuid;

#[derive(Subcommand)]
pub enum People {
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

pub fn people(p: People) -> Result<()> {
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

pub fn list_people(as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    for p in board.people()? {
        let projects = if p.projects.is_empty() { "no Projects".to_string() } else { p.projects.join(", ") };
        println!("{}  ({})  {projects}", p.name, p.logins.join(", "));
    }
    Ok(())
}

pub fn add_person(who: &str, project: &str, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    let (p, person) = (board.project(project)?, board.person(who)?);
    board.add_member(&p, &person)?;
    println!("Added {} to {}.", person.name, p.name);
    Ok(())
}

pub fn remove_person(who: &str, project: &str, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    let (p, person) = (board.project(project)?, board.person(who)?);
    board.remove_member(&p, &person)?;
    println!("Took {} out of {}.", person.name, p.name);
    Ok(())
}
