//! A guided command line. Every input still comes from its argument when
//! given, so scripts and Claude sessions work as before. When something is
//! missing and there's a person at a terminal, Omicron asks for it instead
//! of failing: a menu of what to do (`omicron` on its own, or `omicron
//! tasks`), and a pick-list or a question for each missing value. A
//! pick-list with one choice picks it without asking. Without a terminal,
//! the usual error says what's missing.
//!
//! It works from the command definitions themselves: it finds where the
//! typed words stop matching, asks for the next one, and tries again, until
//! the command is complete.

use crate::board_cmd::sign_in;
use anyhow::{bail, Result};
use clap::error::ErrorKind;
use clap::CommandFactory;
use omicron::board::{Board, Project};
use std::io::IsTerminal;

/// Is a person here to answer?
pub fn interactive() -> bool {
    std::io::stdin().is_terminal() && std::io::stdout().is_terminal() && std::env::var_os("OMICRON_NO_GUIDE").is_none()
}

/// The command line, with whatever was missing asked for and filled in.
pub fn complete<C: CommandFactory + clap::Parser>(mut args: Vec<String>) -> Result<Vec<String>> {
    if !interactive() {
        return Ok(args);
    }
    let mut board: Option<Board> = None;
    let mut started = false;
    for _ in 0..20 {
        let err = match C::try_parse_from(&args) {
            Ok(_) => {
                if started {
                    // The whole command, to type straight in next time.
                    let shown: Vec<String> = args.iter().skip(1).map(|a| shell_word(a)).collect();
                    let line = format!("omicron {}", shown.join(" "));
                    // Something that can't be undone: say so and ask first.
                    let place = locate(&C::command(), &args);
                    if let Some(what) = undoable(&place.path) {
                        let sure = cancelled(cliclack::confirm(format!("{what} This can't be undone. Go ahead?\n  {line}")).initial_value(false).interact())?;
                        if !sure {
                            let _ = cliclack::outro_cancel("Nothing changed.");
                            bail!("cancelled");
                        }
                    }
                    let _ = cliclack::outro(line);
                }
                return Ok(args);
            }
            Err(e) => e,
        };
        let missing = matches!(
            err.kind(),
            ErrorKind::MissingSubcommand | ErrorKind::DisplayHelpOnMissingArgumentOrSubcommand | ErrorKind::MissingRequiredArgument
        );
        if !missing {
            return Ok(args);
        }
        if !started {
            let _ = cliclack::intro(" omicron ");
            started = true;
        }
        let as_machine = args.iter().any(|a| a == "--as-machine");
        let place = locate(&C::command(), &args);
        if err.kind() == ErrorKind::MissingRequiredArgument {
            let mut context = given(&place, &args);
            if let Some((name, help, flag)) = missing_flag(&place, &args) {
                // A required --flag: asked for like a value, added at the end.
                let value = ask_value(&place.path, &name, &help, &context, || {
                    if board.is_none() {
                        board = Some(sign_in(as_machine)?);
                    }
                    Ok(board.clone().unwrap())
                })?;
                args.push(flag);
                args.push(value);
                continue;
            }
            let Some((name, help, at)) = next_missing(&place, &args) else { return Ok(args) };
            context.retain(|_| true);
            let value = ask_value(&place.path, &name, &help, &context, || {
                if board.is_none() {
                    board = Some(sign_in(as_machine)?);
                }
                Ok(board.clone().unwrap())
            })?;
            args.insert(at, value);
        } else {
            let choices: Vec<(String, String)> = place
                .node
                .get_subcommands()
                .filter(|c| !c.is_hide_set())
                .map(|c| (c.get_name().to_string(), about(c)))
                .collect();
            if choices.is_empty() {
                return Ok(args);
            }
            let prompt = if place.path.is_empty() { "What do you want to do?".to_string() } else { format!("{}: what do you want to do?", place.path.join(" ")) };
            let chosen = pick(&prompt, choices.iter().map(|(n, a)| (n.clone(), n.clone(), a.clone())).collect())?;
            args.insert(place.end, chosen);
        }
    }
    bail!("couldn't put the command together")
}

/// What a command does that can't be undone, if it does.
fn undoable(path: &[String]) -> Option<&'static str> {
    let p: Vec<&str> = path.iter().map(String::as_str).collect();
    Some(match p.as_slice() {
        ["labels", "remove"] => "The label comes off every task that has it.",
        ["topics", "remove"] => "Its tasks are kept, without a topic.",
        ["sessions", "remove"] => "The session is forgotten.",
        ["machines", "remove"] => "The machine loses this Project, and its sessions here stop.",
        ["people", "remove"] => "They lose this Project.",
        ["accounts", "remove"] => "The saved login is deleted from this machine.",
        ["teams", "stop"] => "The team's lead and workers stop (its jobs are kept).",
        ["teams", "stop-worker"] => "The worker's conversation ends.",
        ["loops", "stop"] => "The loop stops for good.",
        _ => return None,
    })
}

/// A word as it would be typed in a shell (quoted when it needs to be).
fn shell_word(w: &str) -> String {
    if !w.is_empty() && w.chars().all(|c| c.is_ascii_alphanumeric() || "-_./:=@#".contains(c)) {
        w.to_string()
    } else {
        format!("'{}'", w.replace('\'', "'\\''"))
    }
}

fn about(c: &clap::Command) -> String {
    c.get_about().map(|a| a.to_string()).unwrap_or_default().lines().next().unwrap_or("").to_string()
}

/// Where the typed words lead in the command tree.
struct Place {
    /// The command reached (e.g. `tasks add`).
    node: clap::Command,
    /// Its names, from the top.
    path: Vec<String>,
    /// Where in `args` the words after the command's names start.
    end: usize,
}

fn takes_value(node: &clap::Command, word: &str) -> bool {
    let long = word.trim_start_matches("--");
    let long = long.split('=').next().unwrap_or(long);
    if word.contains('=') {
        return false;
    }
    node.get_arguments().any(|a| a.get_long() == Some(long) && a.get_action().takes_values())
}

fn locate(top: &clap::Command, args: &[String]) -> Place {
    let mut node = top.clone();
    let mut path = Vec::new();
    let mut i = 1;
    while i < args.len() {
        let w = &args[i];
        if w.starts_with('-') {
            i += if takes_value(&node, w) { 2 } else { 1 };
            continue;
        }
        match node.find_subcommand(w).cloned() {
            Some(sub) => {
                path.push(w.clone());
                node = sub;
                i += 1;
            }
            None => break,
        }
    }
    Place { node, path, end: i.min(args.len()) }
}

/// The positional values given after the command's names: (name, value).
fn given(place: &Place, args: &[String]) -> Vec<(String, String)> {
    let names: Vec<String> = place.node.get_positionals().map(|a| a.get_id().to_string()).collect();
    let mut out = Vec::new();
    let mut i = place.end;
    while i < args.len() {
        let w = &args[i];
        if w.starts_with('-') && w.len() > 1 {
            i += if takes_value(&place.node, w) { 2 } else { 1 };
            continue;
        }
        if let Some(n) = names.get(out.len()) {
            out.push((n.clone(), w.clone()));
        }
        i += 1;
    }
    out
}

/// A required `--flag` not given: its name, help and the flag.
fn missing_flag(place: &Place, args: &[String]) -> Option<(String, String, String)> {
    place.node.get_arguments().filter(|a| a.is_required_set() && !a.is_positional()).find_map(|a| {
        let long = a.get_long()?;
        let flag = format!("--{long}");
        let there = args.iter().skip(1).any(|w| w == &flag || w.starts_with(&format!("{flag}=")));
        (!there).then(|| (a.get_id().to_string(), a.get_help().map(|h| h.to_string()).unwrap_or_default(), flag))
    })
}

/// The first required positional value not given: its name, its help, and
/// where to put it in `args`.
fn next_missing(place: &Place, args: &[String]) -> Option<(String, String, usize)> {
    let have = given(place, args).len();
    let arg = place.node.get_positionals().nth(have)?;
    if !arg.is_required_set() {
        return None;
    }
    // After the last positional given (or right after the command's names).
    let mut at = place.end;
    let mut seen = 0;
    let mut i = place.end;
    while i < args.len() && seen < have {
        let w = &args[i];
        if w.starts_with('-') && w.len() > 1 {
            i += if takes_value(&place.node, w) { 2 } else { 1 };
            continue;
        }
        seen += 1;
        i += 1;
        at = i;
    }
    let help = arg.get_help().map(|h| h.to_string()).unwrap_or_default();
    Some((arg.get_id().to_string(), help, at))
}

fn cancelled<T>(r: std::io::Result<T>) -> Result<T> {
    r.map_err(|e| match e.kind() {
        std::io::ErrorKind::Interrupted => anyhow::anyhow!("cancelled"),
        _ => e.into(),
    })
}

/// Pick one of (value, label, hint). One choice is picked without asking.
fn pick(prompt: &str, items: Vec<(String, String, String)>) -> Result<String> {
    if items.len() == 1 {
        let (v, label, _) = &items[0];
        let _ = cliclack::log::info(format!("{prompt} {label}"));
        return Ok(v.clone());
    }
    let count = items.len();
    let mut menu = cliclack::select(prompt.to_string());
    for (v, label, hint) in items {
        menu = menu.item(v, label, hint);
    }
    if count > 7 {
        // Long lists: type to narrow them.
        menu = menu.filter_mode().max_rows(12);
    }
    cancelled(menu.interact())
}

fn text(prompt: &str, placeholder: &str) -> Result<String> {
    cancelled(
        cliclack::input(prompt.to_string())
            .placeholder(placeholder)
            .validate(|s: &String| if s.trim().is_empty() { Err("say something") } else { Ok(()) })
            .interact(),
    )
}

fn project_of(board: &Board, context: &[(String, String)]) -> Result<Project> {
    let name = context.iter().find(|(n, _)| n == "project").map(|(_, v)| v.clone()).unwrap_or_default();
    board.project(&name)
}

/// Ask for one value, by what kind of thing it is.
fn ask_value(path: &[String], name: &str, help: &str, context: &[(String, String)], board: impl FnOnce() -> Result<Board>) -> Result<String> {
    let none_left = |what: &str| anyhow::anyhow!("there are no {what} to pick from");
    let path: Vec<&str> = path.iter().map(String::as_str).collect();
    // Names that mean different things in different commands.
    let name = match (path.as_slice(), name) {
        (["topics", "rename" | "remove"], "name") => "topic",
        (["sessions", "remove"], "name") => "session",
        (["sessions", "attach" | "send"], "name") => "hosted",
        (["accounts", "use" | "remove" | "run"], "name") => "account",
        (["tasks", "tick"], "item") => "item",
        (_, n) => n,
    };
    match name {
        "color" => pick(
            "Which color?",
            omicron::board::COLORS.iter().map(|c| (c.to_string(), c.to_string(), String::new())).collect(),
        ),
        "every" => {
            let items = [("10m", "every 10 minutes"), ("30m", "every 30 minutes"), ("1h", "every hour"), ("4h", "every 4 hours"), ("", "something else…")];
            match pick("How often?", items.iter().map(|(v, l)| (v.to_string(), l.to_string(), String::new())).collect())? {
                v if v.is_empty() => text("How often? (like 15m, 2h, 1d)", "15m"),
                v => Ok(v),
            }
        }
        "hosted" => {
            let items: Vec<_> = omicron::host::hosted()?.into_iter().map(|n| (n.clone(), n, String::new())).collect();
            if items.is_empty() {
                return Err(none_left("sessions running in Omicron's host here"));
            }
            pick("Which session?", items)
        }
        "account" => {
            let in_use = omicron::accounts::in_use()?;
            let items: Vec<_> = omicron::accounts::saved()?
                .into_iter()
                .map(|a| {
                    let hint = if in_use.as_deref() == Some(a.name.as_str()) { format!("{} · in use", a.login.email()) } else { a.login.email().to_string() };
                    (a.name.clone(), a.name, hint)
                })
                .collect();
            if items.is_empty() {
                return Err(none_left("saved Claude accounts (log in, then `omicron accounts add <name>`)"));
            }
            pick("Which account?", items)
        }
        "item" => {
            let b = board()?;
            let p = project_of(&b, context)?;
            let number: i64 = context.iter().find(|(n, _)| n == "number").and_then(|(_, v)| v.parse().ok()).unwrap_or(0);
            let task = b.tasks(&p)?.into_iter().find(|t| t.number == number).ok_or_else(|| anyhow::anyhow!("no task #{number}"))?;
            let items: Vec<_> = task
                .checklist
                .iter()
                .enumerate()
                .map(|(i, c)| ((i + 1).to_string(), format!("{} {}", if c.done { "☑" } else { "☐" }, omicron::text::line(&c.text)), String::new()))
                .collect();
            if items.is_empty() {
                return Err(none_left("checklist items on this task"));
            }
            pick("Which item?", items)
        }
        "project" => {
            let b = board()?;
            let items: Vec<_> = b.projects()?.into_iter().map(|p| (p.name.clone(), p.name, String::new())).collect();
            if items.is_empty() {
                return Err(none_left("Projects (start one with `omicron projects new`)"));
            }
            pick("Which Project?", items)
        }
        "number" => {
            let b = board()?;
            let p = project_of(&b, context)?;
            let statuses = b.statuses(&p)?;
            let mut tasks = b.tasks(&p)?;
            // Open tasks first, newest first.
            let done: Vec<String> = statuses.iter().filter(|s| s.is_done).map(|s| s.id.clone()).collect();
            tasks.sort_by_key(|t| (done.contains(&t.status_id), -t.number));
            let items: Vec<_> = tasks
                .iter()
                .map(|t| {
                    let status = statuses.iter().find(|s| s.id == t.status_id).map(|s| s.name.clone()).unwrap_or_default();
                    (t.number.to_string(), format!("#{} {}", t.number, omicron::text::line(&t.title)), status)
                })
                .collect();
            if items.is_empty() {
                return Err(none_left("tasks in this Project"));
            }
            pick("Which task?", items)
        }
        "session" => {
            let b = board()?;
            let p = project_of(&b, context).ok();
            let items: Vec<_> = b
                .sessions(p.as_ref())?
                .into_iter()
                .filter(|s| s.state != "gone")
                .map(|s| (s.name.clone(), s.name.clone(), format!("{} · {}", s.machine, s.state)))
                .collect();
            if items.is_empty() {
                return Err(none_left("Claude sessions"));
            }
            pick("Which session?", items)
        }
        "status" => {
            let b = board()?;
            let p = project_of(&b, context)?;
            let items: Vec<_> = b.statuses(&p)?.into_iter().map(|s| (s.name.clone(), s.name, String::new())).collect();
            pick("Which status?", items)
        }
        "label" => {
            let b = board()?;
            let p = project_of(&b, context)?;
            let labels = b.labels(&p)?;
            // Only a task can get a new label; the others act on one that's there.
            let can_add = path == ["tasks", "label"];
            if labels.is_empty() {
                if !can_add {
                    return Err(none_left("labels in this Project"));
                }
                return text("Which label?", "a new label's name");
            }
            let mut items: Vec<_> = labels.into_iter().map(|(n, c)| (n.clone(), n, c.unwrap_or_default())).collect();
            if can_add {
                items.push((String::new(), "A new label…".into(), String::new()));
            }
            match pick("Which label?", items)? {
                v if v.is_empty() => text("The new label's name", "urgent"),
                v => Ok(v),
            }
        }
        "topic" => {
            let b = board()?;
            let p = project_of(&b, context)?;
            let mut items: Vec<_> = b.topics(&p)?.into_iter().map(|n| (n.clone(), n, String::new())).collect();
            if path == ["tasks", "topic"] {
                items.push((String::new(), "A new topic…".into(), String::new()));
                items.push(("none".into(), "No topic".into(), String::new()));
            } else if items.is_empty() {
                return Err(none_left("topics in this Project"));
            }
            match pick("Which topic?", items)? {
                v if v.is_empty() => text("The new topic's name", "Kitchen"),
                v => Ok(v),
            }
        }
        "team" => {
            let b = board()?;
            let items: Vec<_> = b.teams()?.into_iter().map(|t| (t.name.clone(), t.name, t.state)).collect();
            if items.is_empty() {
                return Err(none_left("teams (set a folder up with `omicron teams init`)"));
            }
            pick("Which team?", items)
        }
        "job" => {
            let b = board()?;
            let team = context.iter().find(|(n, _)| n == "team").map(|(_, v)| v.clone()).unwrap_or_default();
            let t = b.team(&team)?;
            let items: Vec<_> = b.jobs(&t)?.into_iter().map(|j| (j.number.to_string(), format!("#{} {}", j.number, omicron::text::line(&j.title)), j.state)).collect();
            if items.is_empty() {
                return Err(none_left("jobs in this team"));
            }
            pick("Which job?", items)
        }
        "machine" => {
            let b = board()?;
            let items: Vec<_> = b.machines()?.into_iter().map(|m| (m.name.clone(), m.name, if m.active { String::new() } else { "switched off".into() })).collect();
            pick("Which machine?", items)
        }
        "person" => {
            let b = board()?;
            let items: Vec<_> = b.people()?.into_iter().map(|p| (p.name.clone(), p.name, p.logins.join(", "))).collect();
            pick("Who?", items)
        }
        _ => {
            let prompt = if help.is_empty() { name.replace('_', " ") } else { help.lines().next().unwrap_or(help).to_string() };
            let mut prompt = prompt;
            if let Some(first) = prompt.get(..1) {
                prompt = first.to_uppercase() + &prompt[1..];
            }
            text(&prompt, "")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::{Parser, Subcommand};

    #[derive(Parser)]
    struct Top {
        #[arg(long, global = true)]
        as_machine: bool,
        #[command(subcommand)]
        cmd: Cmd,
    }
    #[derive(Subcommand)]
    enum Cmd {
        Tasks {
            #[command(subcommand)]
            cmd: Tasks,
        },
    }
    #[derive(Subcommand)]
    enum Tasks {
        Add {
            project: String,
            title: String,
            #[arg(long)]
            due: Option<String>,
            #[arg(long)]
            urgent: bool,
        },
        Start {
            #[arg(long)]
            project: String,
        },
    }

    fn args(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn finds_the_command_and_what_is_missing() {
        let top = Top::command();
        let a = args("omicron --as-machine tasks add");
        let place = locate(&top, &a);
        assert_eq!(place.path, ["tasks", "add"]);
        assert_eq!(place.end, 4);
        assert_eq!(next_missing(&place, &a).map(|(n, _, at)| (n, at)), Some(("project".into(), 4)));

        let a = args("omicron tasks add --due 2026-12-01 Home --urgent");
        let place = locate(&top, &a);
        assert_eq!(given(&place, &a), [("project".to_string(), "Home".to_string())]);
        assert_eq!(next_missing(&place, &a).map(|(n, _, at)| (n, at)), Some(("title".into(), 6)));

        let a = args("omicron tasks add Home Milk");
        assert!(next_missing(&locate(&top, &a), &a).is_none());
        let a = args("omicron tasks");
        assert_eq!(locate(&top, &a).path, ["tasks"]);

        // A required --flag.
        let a = args("omicron tasks start");
        assert_eq!(missing_flag(&locate(&top, &a), &a).map(|(n, _, f)| (n, f)), Some(("project".into(), "--project".into())));
        let a = args("omicron tasks start --project Home");
        assert!(missing_flag(&locate(&top, &a), &a).is_none());
        assert!(missing_flag(&locate(&top, &args("omicron tasks add")), &args("omicron tasks add")).is_none());
    }
}

#[cfg(test)]
mod survey {
    #[test]
    #[ignore]
    fn list_positionals() {
        use clap::CommandFactory;
        fn walk(c: &clap::Command, path: String) {
            for a in c.get_positionals() {
                if a.is_required_set() {
                    println!("{path} <{}>", a.get_id());
                }
            }
            for a in c.get_arguments().filter(|a| a.is_required_set() && !a.is_positional()) {
                println!("{path} --{}", a.get_id());
            }
            for s in c.get_subcommands() {
                walk(s, format!("{path} {}", s.get_name()));
            }
        }
        walk(&crate::Cli::command(), "omicron".into());
    }
}
