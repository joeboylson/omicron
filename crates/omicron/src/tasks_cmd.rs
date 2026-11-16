//! `omicron tasks`: adding, showing, moving, giving and reporting on tasks.

use anyhow::{bail, Result};
use clap::Subcommand;
use omicron::board::{NewTask, Project, Status, Task};
use omicron::config::Config;
use crate::board_cmd::{acts_as_machine, sign_in};

#[derive(Subcommand)]
pub enum Tasks {
    /// Show a Project's tasks, grouped by status (and by topic too, with --by-topic)
    List {
        project: String,
        #[arg(long)]
        by_topic: bool,
    },
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
        /// Notes: what it's about, in more detail
        #[arg(long, default_value = "")]
        notes: String,
        /// Its topic (made if it doesn't exist)
        #[arg(long)]
        topic: Option<String>,
    },
    /// Give a task a topic (made if it doesn't exist), or `none` to take it off
    Topic { project: String, number: i64, topic: String },
    /// Move a task to another status (to the bottom), or to another place
    /// in its own: omicron tasks move Omicron 7 --top
    Move {
        project: String,
        number: i64,
        /// The status (its own if left out)
        status: Option<String>,
        /// Put it at the top
        #[arg(long, conflicts_with_all = ["bottom", "before", "after"])]
        top: bool,
        /// Put it at the bottom (where a move to another status goes anyway)
        #[arg(long, conflicts_with_all = ["before", "after"])]
        bottom: bool,
        /// Put it just above this task (by number)
        #[arg(long, conflicts_with = "after")]
        before: Option<i64>,
        /// Put it just below this task (by number)
        #[arg(long)]
        after: Option<i64>,
    },
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
    /// Give a task to a Claude session in the Project. The session gets it
    /// when told to get its tasks, or by Dispatch.
    Send { project: String, number: i64, session: String },
    /// In a Claude session: the tasks given to it ("go get your tasks")
    Mine,
    /// Link a task to a team's job (the session handles the task, the team the job)
    Link { project: String, number: i64, team: String, job: i64 },
    /// Unlink a task from a team's job
    Unlink { project: String, number: i64, team: String, job: i64 },
    /// Hand a task to its Claude session now, on the session's machine: it
    /// shows up in the session's window, or when the session is next opened
    /// (`omicron open`). Fails if the machine is asleep.
    Dispatch { project: String, number: i64 },
    /// Comment on a task. From inside a Claude session, the comment says
    /// which session wrote it.
    Comment {
        project: String,
        number: i64,
        /// The comment ("" for images only)
        text: String,
        /// Also mark it as needing review (a Claude session's report)
        #[arg(long)]
        review: bool,
        /// An image to add (PNG, JPEG, GIF or WebP, up to 10 MB). Can be
        /// given up to 10 times.
        #[arg(long = "image")]
        images: Vec<std::path::PathBuf>,
    },
    /// Save the images in a task's comments to a folder, to look at them
    Images {
        project: String,
        number: i64,
        /// Where to save them (a new folder under the system's temp folder
        /// if left out)
        #[arg(long)]
        to: Option<std::path::PathBuf>,
    },
}

/// One task on one line: `#3  Buy milk  [food, shop]  due 2026-11-30  to Sam  checklist 1/2  needs review`
pub fn one_line(t: &Task) -> String {
    let mut parts = vec![format!("#{}", t.number), omicron::text::line(&t.title)];
    if !t.labels.is_empty() {
        parts.push(format!("[{}]", t.labels.join(", ")));
    }
    if let Some(d) = &t.due_on {
        parts.push(format!("due {d}"));
    }
    if let Some(a) = &t.assignee {
        parts.push(format!("to {a}"));
    }
    if let Some(s) = &t.session {
        parts.push(format!("sent to session {s}"));
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
    if let Some(topic) = &t.topic {
        println!("  Topic: {topic}");
    }
    if !t.notes.is_empty() {
        println!("  Notes: {}", t.notes.trim_end().replace('\n', "\n         "));
    }
    for (i, c) in t.checklist.iter().enumerate() {
        println!("  {}. [{}] {}", i + 1, if c.done { "x" } else { " " }, omicron::text::line(&c.text));
    }
}

pub fn tasks(cmd: Tasks, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    let changed = |p: &Project, t: Task| -> Result<()> {
        let statuses = board.statuses(p)?;
        print_task(p, &statuses, &t);
        for (team, j) in board.task_jobs(&t)? {
            let with = j.step.as_ref().map(|s| format!(", {s}")).unwrap_or_default();
            println!("  Job: {team} #{} {} ({}{with})", j.number, j.title, j.state);
        }
        for c in board.comments(&t)? {
            let who = match &c.session {
                Some(s) => format!("{} (session {s})", c.author),
                None => c.author.clone(),
            };
            let images = if c.images.is_empty() {
                String::new()
            } else {
                let names: Vec<&str> = c.images.iter().map(|i| omicron::board::image_name(i)).collect();
                format!(" [images: {}]", names.join(", "))
            };
            println!("  {who}, {}: {}{images}", c.at.get(..16).unwrap_or(&c.at).replace('T', " "), c.body.trim_end().replace('\n', "\n    "));
        }
        Ok(())
    };
    match cmd {
        Tasks::List { project, by_topic } => {
            let p = board.project(&project)?;
            let statuses = board.statuses(&p)?;
            let tasks = board.tasks(&p)?;
            let print = |tasks: &[&Task], indent: &str| {
                for s in &statuses {
                    println!("{indent}{}", s.name);
                    let in_status: Vec<&&Task> = tasks.iter().filter(|t| t.status_id == s.id).collect();
                    if in_status.is_empty() {
                        println!("{indent}  (nothing)");
                    }
                    for t in in_status {
                        println!("{indent}  {}", one_line(t));
                    }
                }
            };
            if !by_topic {
                print(&tasks.iter().collect::<Vec<_>>(), "");
                return Ok(());
            }
            let mut groups: Vec<(String, Vec<&Task>)> = board
                .topics(&p)?
                .into_iter()
                .map(|name| {
                    let in_topic = tasks.iter().filter(|t| t.topic.as_deref() == Some(name.as_str())).collect();
                    (name, in_topic)
                })
                .collect();
            let none: Vec<&Task> = tasks.iter().filter(|t| t.topic.is_none()).collect();
            if !none.is_empty() || groups.is_empty() {
                groups.push(("No topic".into(), none));
            }
            for (i, (name, in_topic)) in groups.iter().enumerate() {
                if i > 0 {
                    println!();
                }
                println!("== {name} ==");
                print(in_topic, "");
            }
            Ok(())
        }
        Tasks::Show { project, number } => {
            let p = board.project(&project)?;
            let t = board.task(&p, number)?;
            changed(&p, t)
        }
        Tasks::Topic { project, number, topic } => {
            let p = board.project(&project)?;
            let topic = Some(topic).filter(|t| !t.eq_ignore_ascii_case("none"));
            let t = board.set_topic(&p, number, topic.as_deref())?;
            changed(&p, t)
        }
        Tasks::Add { project, title, status, due, labels, assignee, notes, topic } => {
            let p = board.project(&project)?;
            let t = board.add_task(&p, &NewTask { title, status, due_on: due, labels, assignee, notes, topic })?;
            changed(&p, t)
        }
        Tasks::Move { project, number, status, top, bottom: _, before, after } => {
            use omicron::board::Place;
            let place = match (top, before, after) {
                (true, _, _) => Place::Top,
                (_, Some(n), _) => Place::Before(n),
                (_, _, Some(n)) => Place::After(n),
                _ => Place::Bottom,
            };
            let p = board.project(&project)?;
            let t = board.place_task(&p, number, status.as_deref(), place)?;
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
        Tasks::Images { project, number, to } => {
            let p = board.project(&project)?;
            let t = board.task(&p, number)?;
            let images: Vec<String> = board.comments(&t)?.into_iter().flat_map(|c| c.images).collect();
            if images.is_empty() {
                println!("#{number} has no images in its comments.");
                return Ok(());
            }
            let dir = match to {
                Some(d) => d,
                None => std::env::temp_dir().join(format!("omicron-images-{}", uuid::Uuid::new_v4().simple())),
            };
            std::fs::create_dir_all(&dir)?;
            for (i, path) in images.iter().enumerate() {
                let file = dir.join(format!("{}-{}", i + 1, omicron::board::image_name(path)));
                std::fs::write(&file, board.image(path)?)?;
                println!("{}", file.display());
            }
            Ok(())
        }
        Tasks::Comment { project, number, text, review, images } => {
            if text.trim().is_empty() && images.is_empty() {
                bail!("write something, or add an image with --image");
            }
            if images.len() > 10 {
                bail!("a comment can have at most 10 images");
            }
            let words = text.split_whitespace().count();
            if review && words > crate::handed::REPORT_WORDS {
                bail!(
                    "a report is at most {} words; this one is {words}. Cut it down to what changed and what's left.",
                    crate::handed::REPORT_WORDS
                );
            }
            let p = board.project(&project)?;
            let t = board.task(&p, number)?;
            // Inside a Claude session that Omicron tracks, as its machine.
            let session_id = if acts_as_machine(as_machine)? {
                let windows = omicron::windows::Windows::load()?;
                omicron::windows::this_window(&windows)?
                    .and_then(|pid| windows.windows.get(&pid))
                    .and_then(|w| w.session_id.clone())
                    // Or the session Omicron opened this in, by its name (#271).
                    .or_else(|| {
                        let name = std::env::var("OMICRON_SESSION").ok().filter(|n| !n.trim().is_empty())?;
                        board.session(&p, &name).ok().map(|s| s.id)
                    })
            } else {
                None
            };
            board.add_comment(&p, &t, &text, session_id.as_deref(), &images)?;
            let t = if review { board.set_needs_review(&p, number, true)? } else { t };
            changed(&p, t)
        }
        Tasks::Mine => crate::handed::tasks_mine(),
        Tasks::Link { project, number, team, job } => {
            let p = board.project(&project)?;
            let t = board.task(&p, number)?;
            let tm = board.team(&team)?;
            board.link_job(&t, &tm, job)?;
            changed(&p, board.task(&p, number)?)
        }
        Tasks::Unlink { project, number, team, job } => {
            let p = board.project(&project)?;
            let t = board.task(&p, number)?;
            let tm = board.team(&team)?;
            board.unlink_job(&t, &tm, job)?;
            changed(&p, t)
        }
        Tasks::Dispatch { project, number } => crate::dispatch_cmd::dispatch(&project, number, as_machine),
        Tasks::Send { project, number, session } => {
            let p = board.project(&project)?;
            // Given to a session on this computer: given as this machine, so
            // the session takes it with its gate closed (ref/BRAINSTORM.md,
            // "The gate"). From anywhere else it's only to read until then.
            let here = Config::load()?.machine_key().ok().map(|k| k.machine_id.to_string());
            let t = match here {
                Some(id) if board.session(&p, &session)?.machine_id == id && board.me() != id => {
                    sign_in(true)?.send_task(&p, number, &session)?
                }
                _ => board.send_task(&p, number, &session)?,
            };
            changed(&p, t)
        }
    }
}
