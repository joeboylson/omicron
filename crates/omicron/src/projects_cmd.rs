//! `omicron projects`, `statuses`, `labels` and `topics`.

use anyhow::Result;
use clap::Subcommand;
use crate::board_cmd::sign_in;

#[derive(Subcommand)]
pub enum Projects {
    /// List the Projects you're in
    List,
    /// Start a Project (you become its first member)
    New { name: String },
    /// A Project's board rules: how its Claude sessions work, given to a
    /// session with every task. Shows them, or sets them (`-` reads stdin;
    /// "" clears them)
    Rules { project: String, rules: Option<String> },
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
    /// Give a status a color: red, orange, yellow, green, teal, blue,
    /// indigo, purple, pink, brown or gray
    Color { project: String, status: String, color: String },
    /// Move a status one place left or right on the board
    Move {
        project: String,
        status: String,
        #[arg(value_parser = ["left", "right"])]
        direction: String,
    },
}

#[derive(Subcommand)]
pub enum Labels {
    /// List a Project's labels and their colors
    List { project: String },
    /// Give a label a color (it's made if it doesn't exist): red, orange,
    /// yellow, green, teal, blue, indigo, purple, pink, brown or gray
    Color { project: String, label: String, color: String },
    /// Rename a label (on every task that has it)
    Rename { project: String, label: String, new_name: String },
    /// Remove a label; it comes off every task that has it
    Remove { project: String, label: String },
}

#[derive(Subcommand)]
pub enum Topics {
    /// List a Project's topics, in board order
    List { project: String },
    /// Add a topic (like "Joe's to-do")
    Add { project: String, name: String },
    /// Rename a topic
    Rename { project: String, name: String, new_name: String },
    /// Remove a topic. Its tasks are kept, without a topic.
    Remove { project: String, name: String },
    /// Move a topic one place left or right on the board
    Move {
        project: String,
        name: String,
        #[arg(value_parser = ["left", "right"])]
        direction: String,
    },
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
        Projects::Rules { project, rules } => {
            let p = board.project(&project)?;
            match rules {
                None => {
                    let r = board.board_rules(&p)?;
                    if r.trim().is_empty() {
                        println!("{} has no board rules yet. Set them with `omicron projects rules '{}' \"<rules>\"`.", p.name, p.name);
                    } else {
                        println!("{}", r.trim_end());
                    }
                }
                Some(text) => {
                    let text = if text == "-" {
                        let mut s = String::new();
                        std::io::Read::read_to_string(&mut std::io::stdin(), &mut s)?;
                        s
                    } else {
                        text
                    };
                    board.set_board_rules(&p, text.trim())?;
                    println!("{} {}.", if text.trim().is_empty() { "Cleared the board rules of" } else { "Saved the board rules of" }, p.name);
                }
            }
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
                let color = s.color.as_deref().map(|c| format!(" [{c}]")).unwrap_or_default();
                println!("{}{}{color}", s.name, if s.is_done { " (Done)" } else { "" });
            }
        }
        Statuses::Add { project, name, done } => {
            let p = board.project(&project)?;
            let s = board.add_status(&p, &name, done)?;
            println!("Added {} to {}{}.", s.name, p.name, if s.is_done { " as its Done status" } else { "" });
        }
        Statuses::Color { project, status, color } => {
            let p = board.project(&project)?;
            board.color_status(&p, &status, &color)?;
            println!("{status} is {} in {}.", color.to_lowercase(), p.name);
        }
        Statuses::Move { project, status, direction } => {
            let p = board.project(&project)?;
            board.move_column(&p, "statuses", &status, direction == "left")?;
            println!("Moved {status} {direction}.");
        }
    }
    Ok(())
}

pub fn labels(cmd: Labels, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    match cmd {
        Labels::List { project } => {
            let p = board.project(&project)?;
            for (name, color) in board.labels(&p)? {
                println!("{name}{}", color.map(|c| format!(" [{c}]")).unwrap_or_default());
            }
        }
        Labels::Rename { project, label, new_name } => {
            let p = board.project(&project)?;
            board.rename_label(&p, &label, &new_name)?;
            println!("Renamed the label {label} to {}.", new_name.trim());
        }
        Labels::Remove { project, label } => {
            let p = board.project(&project)?;
            let n = board.remove_label(&p, &label)?;
            println!("Removed the label {label} (it was on {n} {}).", if n == 1 { "task" } else { "tasks" });
        }
        Labels::Color { project, label, color } => {
            let p = board.project(&project)?;
            board.color_label(&p, &label, &color)?;
            println!("{label} is {} in {}.", color.to_lowercase(), p.name);
        }
    }
    Ok(())
}

pub fn topics(cmd: Topics, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    match cmd {
        Topics::List { project } => {
            let p = board.project(&project)?;
            let all = board.topics(&p)?;
            if all.is_empty() {
                println!("{} has no topics yet. Add one with `omicron topics add '{}' <name>`.", p.name, p.name);
            }
            for t in all {
                println!("{t}");
            }
        }
        Topics::Add { project, name } => {
            let p = board.project(&project)?;
            board.add_topic(&p, &name)?;
            println!("Added the topic {name} to {}.", p.name);
        }
        Topics::Rename { project, name, new_name } => {
            let p = board.project(&project)?;
            board.rename_topic(&p, &name, &new_name)?;
            println!("Renamed {name} to {new_name}.");
        }
        Topics::Remove { project, name } => {
            let p = board.project(&project)?;
            board.remove_topic(&p, &name)?;
            println!("Removed the topic {name}. Its tasks are kept, without a topic.");
        }
        Topics::Move { project, name, direction } => {
            let p = board.project(&project)?;
            board.move_column(&p, "topics", &name, direction == "left")?;
            println!("Moved {name} {direction}.");
        }
    }
    Ok(())
}
