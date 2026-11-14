//! `omicron doctor`: what this computer still needs set up, and the command
//! that does each. It only looks; it never changes anything.

use anyhow::{bail, Result};
use omicron::config::{self, Config};
use omicron::supa::{MachineKey, Supabase};
use omicron::{identity, login};

/// One line of the report: fine, or what to run.
enum Check {
    Ok(String),
    Fix(String),
    /// Couldn't be checked because something before it is missing.
    Skip(String),
}

pub fn doctor() -> Result<()> {
    let checks = checks();
    let mut left = 0;
    for (what, check) in &checks {
        match check {
            Check::Ok(s) => println!("ok    {what}: {s}"),
            Check::Fix(s) => {
                left += 1;
                println!("fix   {what}: {s}");
            }
            Check::Skip(s) => println!("--    {what}: {s}"),
        }
    }
    match left {
        0 => {
            println!("\nAll set.");
            Ok(())
        }
        1 => bail!("1 thing left to set up"),
        n => bail!("{n} things left to set up"),
    }
}

fn checks() -> Vec<(&'static str, Check)> {
    let mut out = Vec::new();
    let config = match Config::load() {
        Ok(c) => c,
        Err(e) => {
            out.push(("Settings", Check::Fix(format!("{e:#}"))));
            return out;
        }
    };

    // The database keys.
    let supabase = match config.supabase() {
        Ok(s) => {
            out.push(("Settings", Check::Ok(format!("Supabase at {}", s.url))));
            Some(s)
        }
        Err(_) => {
            out.push(("Settings", Check::Fix(format!(
                "no Supabase saved in {}. Run `omicron setup --url <supabase url> --key <publishable key>`.",
                config::path().map(|p| p.display().to_string()).unwrap_or_default()
            ))));
            None
        }
    };

    // This computer as a machine, and what it can use.
    let machine = match (&supabase, config.machine_key()) {
        (None, _) => {
            out.push(("Machine", Check::Skip("needs the settings first".into())));
            None
        }
        (Some(_), Err(_)) => {
            out.push(("Machine", Check::Fix("this computer isn't added. Run `omicron machines register <name>`.".into())));
            None
        }
        (Some(s), Ok(key)) => {
            let (check, name) = machine(s, &key);
            out.push(("Machine", check));
            name.map(|n| (s.clone(), key, n))
        }
    };

    // You, through your Tailscale login.
    out.push(("You", match &supabase {
        None => Check::Skip("needs the settings first".into()),
        Some(s) => you(s),
    }));

    // The daemon: running now, and coming back after a restart.
    out.push(("Daemon", match &machine {
        None => Check::Skip("needs the machine first".into()),
        Some((s, key, name)) => match super::awake_machines(s, key) {
            Ok(awake) if awake.iter().any(|a| a == name) => Check::Ok(format!("running ({name} is awake)")),
            Ok(_) => Check::Fix("not running. Run `omicron daemon start-at-login` (or `omicron daemon` in a terminal).".into()),
            Err(e) => Check::Fix(format!("couldn't tell if it's running: {e:#}")),
        },
    }));
    out.push(("Start at login", start_at_login()));

    // Claude Code's hooks, so Omicron knows which window is which session.
    out.push(("Claude hooks and add-on", claude_hooks()));
    out
}

fn machine(s: &Supabase, key: &MachineKey) -> (Check, Option<String>) {
    let session = match s.sign_in_machine(key) {
        Ok(x) => x,
        Err(e) => return (Check::Fix(format!("its key doesn't work: {e:#}")), None),
    };
    let board = omicron::board::Board { supabase: s.clone(), session };
    let me = match board.machines().map(|ms| ms.into_iter().find(|m| m.id == key.machine_id.to_string())) {
        Ok(Some(m)) => m,
        Ok(None) => return (Check::Fix("its record is missing. Register it again with `omicron machines register <name>`.".into()), None),
        Err(e) => return (Check::Fix(format!("couldn't read its record: {e:#}")), None),
    };
    let check = if !me.active {
        Check::Fix(format!("{} is switched off. Run `omicron machines switch-on {}` on a computer with the secret key.", me.name, me.name))
    } else if me.all_projects {
        Check::Ok(format!("{}, can use every Project", me.name))
    } else if me.projects.is_empty() {
        Check::Fix(format!("{} can't use any Project yet. Run `omicron machines add {} <Project>`.", me.name, me.name))
    } else if board.machine_owner().ok().flatten().is_none() {
        Check::Fix(format!("{} has no owner, so it takes orders only from itself. Run `omicron machines owner` here.", me.name))
    } else {
        Check::Ok(format!("{}, can use {}", me.name, me.projects.join(", ")))
    };
    (check, Some(me.name))
}

fn you(s: &Supabase) -> Check {
    let me = match identity::local_person() {
        Ok(p) => p,
        Err(e) => return Check::Skip(format!("no person here ({e:#}). This computer can still act as its machine.")),
    };
    if s.secret_key.is_none() {
        return Check::Skip(format!("{}: only computers with the secret key sign people in. This one acts as its machine.", me.login));
    }
    let person = match s.person_for_login(&me.login) {
        Ok(Some(id)) => id,
        Ok(None) => {
            return Check::Fix(format!(
                "{} hasn't been used here yet. If you already use Omicron under another login, run `omicron people link <your person id> {}`.",
                me.login, me.login
            ))
        }
        Err(e) => return Check::Fix(format!("couldn't look up {}: {e:#}", me.login)),
    };
    let names: Vec<String> = match s.person_project_names(&person.to_string()) {
        Ok(names) => names,
        Err(e) => return Check::Fix(format!("couldn't read your Projects: {e:#}")),
    };
    if names.is_empty() {
        Check::Fix(format!(
            "{} isn't in any Project. If you already use Omicron under another login, link this one to it: `omicron people link <your person id> {}`.",
            me.login, me.login
        ))
    } else {
        Check::Ok(format!("{} is in {}", me.login, names.join(", ")))
    }
}

fn start_at_login() -> Check {
    match login::this_service_file() {
        Ok(f) if f.path.exists() => Check::Ok(format!("set ({})", f.path.display())),
        Ok(_) => Check::Fix("the daemon won't come back after a restart. Run `omicron daemon start-at-login`.".into()),
        Err(e) => Check::Skip(format!("{e:#}")),
    }
}

/// Omicron's hooks and add-on for Claude Code: `omicron open` writes them
/// each time it starts a session, so there's nothing to do by hand.
fn claude_hooks() -> Check {
    Check::Ok("set up by `omicron open` when it starts a session".into())
}
