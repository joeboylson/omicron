//! `omicron projects`, `omicron statuses` and `omicron tasks`.

use anyhow::{Context, Result};
use clap::Subcommand;
use omicron::board::{Board, NewTask, Project, Status, Task};
use omicron::config::Config;
use omicron::identity;

#[derive(Subcommand)]
pub enum Projects {
    /// List the Projects you're in
    List,
    /// Start a Project (you become its first member)
    New { name: String },
}

#[derive(Subcommand)]
pub enum Statuses {
    /// List a Project's statuses, in order
    List { project: String },
    /// Add a status at the end
    Add {
        project: String,
        name: String,
        /// Make this the Project's Done status
        #[arg(long)]
        done: bool,
    },
}

#[derive(Subcommand)]
pub enum Tasks {
    /// Show a Project's tasks, grouped by status
    List { project: String },
    /// Show one task in full
    Show { project: String, number: i64 },
    /// Add a task
    Add {
        project: String,
        title: String,
        /// Which status it starts in (the first one if left out)
        #[arg(long)]
        status: Option<String>,
        /// When it'll get done, like 2026-11-30
        #[arg(long)]
        due: Option<String>,
        /// A label (made if it doesn't exist). Can be given more than once.
        #[arg(long = "label")]
        labels: Vec<String>,
        /// Give it to a member, by name
        #[arg(long = "to")]
        assignee: Option<String>,
    },
    /// Move a task to another status
    Move { project: String, number: i64, status: String },
    /// Move a task to the Project's Done status
    Done { project: String, number: i64 },
    /// Add a label to a task
    Label { project: String, number: i64, label: String },
    /// Add a checklist item to a task
    Check { project: String, number: i64, text: String },
    /// Tick or untick a checklist item (counting from 1)
    Tick { project: String, number: i64, item: usize },
    /// Mark a task as needing review (Claude sessions only)
    NeedsReview { project: String, number: i64 },
    /// Take the Needs review mark off a task
    Reviewed { project: String, number: i64 },
}

/// Sign in for board commands.
///
/// As a person when this machine can (it has the secret key and Tailscale
/// says who owns it), otherwise as the machine. `as_machine` (or
/// `OMICRON_AS=machine`) forces the machine, which is how Claude sessions act.
pub fn sign_in(as_machine: bool) -> Result<Board> {
    let config = Config::load()?;
    let supabase = config.supabase()?;
    let as_machine = as_machine || std::env::var("OMICRON_AS").is_ok_and(|v| v == "machine");
    let session = if !as_machine && supabase.secret_key.is_some() {
        let me = identity::local_person().context("couldn't tell who you are. Use --as-machine to act as this machine.")?;
        supabase.sign_in_person(&me)?
    } else {
        supabase.sign_in_machine(&config.machine_key()?)?
    };
    Ok(Board { supabase, session })
}

pub fn projects(cmd: Projects, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    match cmd {
        Projects::List => {
            let all = board.projects()?;
            if all.is_empty() {
                println!("No Projects yet.");
            }
            for p in all {
                println!("{}", p.name);
            }
        }
        Projects::New { name } => {
            let p = board.start_project(&name)?;
            println!("Started {}.", p.name);
        }
    }
    Ok(())
}

pub fn statuses(cmd: Statuses, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    match cmd {
        Statuses::List { project } => {
            let p = board.project(&project)?;
            for s in board.statuses(&p)? {
                println!("{}{}", s.name, if s.is_done { " (Done)" } else { "" });
            }
        }
        Statuses::Add { project, name, done } => {
            let p = board.project(&project)?;
            let s = board.add_status(&p, &name, done)?;
            println!("Added {} to {}{}.", s.name, p.name, if s.is_done { " as its Done status" } else { "" });
        }
    }
    Ok(())
}

/// One task on one line: `#3  Buy milk  [food, shop]  due 2026-11-30  to Sam  checklist 1/2  needs review`
pub fn one_line(t: &Task) -> String {
    let mut parts = vec![format!("#{}", t.number), t.title.clone()];
    if !t.labels.is_empty() {
        parts.push(format!("[{}]", t.labels.join(", ")));
    }
    if let Some(d) = &t.due_on {
        parts.push(format!("due {d}"));
    }
    if let Some(a) = &t.assignee {
        parts.push(format!("to {a}"));
    }
    if !t.checklist.is_empty() {
        let done = t.checklist.iter().filter(|c| c.done).count();
        parts.push(format!("checklist {done}/{}", t.checklist.len()));
    }
    if t.needs_review {
        parts.push("needs review".into());
    }
    parts.join("  ")
}

fn print_task(p: &Project, statuses: &[Status], t: &Task) {
    let status = statuses.iter().find(|s| s.id == t.status_id).map_or("?", |s| s.name.as_str());
    println!("{}", one_line(t));
    println!("  Project: {}", p.name);
    println!("  Status: {status}");
    if !t.notes.is_empty() {
        println!("  Notes: {}", t.notes);
    }
    for (i, c) in t.checklist.iter().enumerate() {
        println!("  {}. [{}] {}", i + 1, if c.done { "x" } else { " " }, c.text);
    }
}

pub fn tasks(cmd: Tasks, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    let changed = |p: &Project, t: Task| -> Result<()> {
        let statuses = board.statuses(p)?;
        print_task(p, &statuses, &t);
        Ok(())
    };
    match cmd {
        Tasks::List { project } => {
            let p = board.project(&project)?;
            let statuses = board.statuses(&p)?;
            let tasks = board.tasks(&p)?;
            for s in &statuses {
                println!("{}", s.name);
                let in_status: Vec<&Task> = tasks.iter().filter(|t| t.status_id == s.id).collect();
                if in_status.is_empty() {
                    println!("  (nothing)");
                }
                for t in in_status {
                    println!("  {}", one_line(t));
                }
            }
            Ok(())
        }
        Tasks::Show { project, number } => {
            let p = board.project(&project)?;
            let t = board.task(&p, number)?;
            changed(&p, t)
        }
        Tasks::Add { project, title, status, due, labels, assignee } => {
            let p = board.project(&project)?;
            let t = board.add_task(&p, &NewTask { title, status, due_on: due, labels, assignee })?;
            changed(&p, t)
        }
        Tasks::Move { project, number, status } => {
            let p = board.project(&project)?;
            let t = board.move_task(&p, number, &status)?;
            changed(&p, t)
        }
        Tasks::Done { project, number } => {
            let p = board.project(&project)?;
            let t = board.finish_task(&p, number)?;
            changed(&p, t)
        }
        Tasks::Label { project, number, label } => {
            let p = board.project(&project)?;
            let t = board.add_label(&p, number, &label)?;
            changed(&p, t)
        }
        Tasks::Check { project, number, text } => {
            let p = board.project(&project)?;
            let t = board.add_checklist_item(&p, number, &text)?;
            changed(&p, t)
        }
        Tasks::Tick { project, number, item } => {
            let p = board.project(&project)?;
            let t = board.toggle_checklist_item(&p, number, item)?;
            changed(&p, t)
        }
        Tasks::NeedsReview { project, number } => {
            let p = board.project(&project)?;
            let t = board.set_needs_review(&p, number, true)?;
            changed(&p, t)
        }
        Tasks::Reviewed { project, number } => {
            let p = board.project(&project)?;
            let t = board.set_needs_review(&p, number, false)?;
            changed(&p, t)
        }
    }
}
