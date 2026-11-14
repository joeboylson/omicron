//! `omicron projects`, `omicron statuses` and `omicron tasks`.

use anyhow::{bail, Context, Result};
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
    /// A Project's run rules: how its Claude sessions work, given to a
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

/// Sign in for board commands.
///
/// As a person when this machine can (it has the secret key and Tailscale
/// says who owns it), otherwise as the machine. `as_machine` (or
/// `OMICRON_AS=machine`) forces the machine, which is how Claude sessions act.
pub fn sign_in(as_machine: bool) -> Result<Board> {
    let config = Config::load()?;
    let supabase = config.supabase()?;
    let session = if !acts_as_machine(as_machine)? {
        let me = identity::local_person().context("couldn't tell who you are. Use --as-machine to act as this machine.")?;
        kept_login(&format!("person {} {}", supabase.url, me.login), || supabase.sign_in_person(&me))?
    } else {
        let key = config.machine_key()?;
        kept_login(&format!("machine {} {}", supabase.url, key.machine_id), || supabase.sign_in_machine(&key))?
    };
    Ok(Board::signed_in(&supabase, &session))
}

/// A login is good for an hour; each command used to make a new one, and
/// Supabase limits how many logins can be made in a few minutes. So the
/// last one is kept (in Omicron's own folder, readable only by this user,
/// beside the machine's key) and used again until shortly before it runs out.
fn kept_login(who: &str, sign_in: impl FnOnce() -> Result<omicron::supa::Session>) -> Result<omicron::supa::Session> {
    use serde_json::json;
    let file = omicron::config::home()?.join("login.json");
    let now = chrono::Utc::now().timestamp();
    if let Ok(text) = std::fs::read_to_string(&file) {
        if let Ok(kept) = serde_json::from_str::<serde_json::Value>(&text) {
            if kept["who"] == who && kept["until"].as_i64().is_some_and(|u| u > now + 120) {
                if let Ok(session) = serde_json::from_value(kept["session"].clone()) {
                    return Ok(session);
                }
            }
        }
    }
    let session = sign_in()?;
    let until = now + session.expires_in as i64;
    let saved = json!({ "who": who, "until": until, "session": session });
    // Written to a copy and swapped in, readable only by this user.
    let tmp = file.with_extension(format!("json.{}", std::process::id()));
    if std::fs::write(&tmp, saved.to_string()).is_ok() {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
        let _ = std::fs::rename(&tmp, &file);
    }
    Ok(session)
}

/// Whether `sign_in` signs in as this machine rather than as you.
pub fn acts_as_machine(as_machine: bool) -> Result<bool> {
    let config = Config::load()?;
    Ok(as_machine
        || std::env::var("OMICRON_AS").is_ok_and(|v| v == "machine")
        || config.supabase()?.secret_key.is_none())
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
                    let r = board.run_rules(&p)?;
                    if r.trim().is_empty() {
                        println!("{} has no run rules yet. Set them with `omicron projects rules '{}' \"<rules>\"`.", p.name, p.name);
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
                    board.set_run_rules(&p, text.trim())?;
                    println!("{} {}.", if text.trim().is_empty() { "Cleared the run rules of" } else { "Saved the run rules of" }, p.name);
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
    }
    Ok(())
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
            if review && words > crate::sessions_cmd::REPORT_WORDS {
                bail!(
                    "a report is at most {} words; this one is {words}. Cut it down to what changed and what's left.",
                    crate::sessions_cmd::REPORT_WORDS
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
            } else {
                None
            };
            board.add_comment(&p, &t, &text, session_id.as_deref(), &images)?;
            let t = if review { board.set_needs_review(&p, number, true)? } else { t };
            changed(&p, t)
        }
        Tasks::Mine => crate::sessions_cmd::tasks_mine(),
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
