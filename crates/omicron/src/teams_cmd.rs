//! `omicron teams`: teams of Claude sessions (the legion rewrite; plan in
//! ref/TEAMS.md). A folder's setup lives in `.omicron-team/`, kept in git:
//!
//! - `team.json`: `name` and the `workflow` it follows.
//! - `roles/<name>.md`: what each role does, in plain words.
//! - `workflows/<name>.json`: `first` (the role a job starts with) and
//!   `next` (which role each one hands to; `done` ends the job).
//!
//! Teams, their jobs and workers are kept in Supabase too, so people
//! elsewhere see them; the team runs on the machine that started it.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use clap::Subcommand;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const SETUP: &str = ".omicron-team";

#[derive(Subcommand)]
pub enum Teams {
    /// Set this folder up for a team (.omicron-team/, with starter roles and
    /// a workflow to edit)
    Init {
        /// The team's name (the folder's name if left out)
        #[arg(long)]
        name: Option<String>,
    },
    /// Start this folder's team on this machine, in a Project
    Start {
        #[arg(long)]
        project: String,
        /// The folder (this one if left out)
        #[arg(long)]
        folder: Option<PathBuf>,
    },
    /// Stop a team (its jobs are kept)
    Stop { team: String },
    /// The teams you can see
    List,
    /// Pick a team member running on this machine and jump into its terminal
    Pick {
        /// Only this team's members
        team: Option<String>,
    },
    /// Give a team a job
    AddJob {
        team: String,
        title: String,
        /// What it's about, in more detail
        #[arg(long, default_value = "")]
        text: String,
    },
    /// A team's jobs
    Jobs { team: String },
    /// (Lead) start a worker in a role on a job
    StartWorker {
        role: String,
        #[arg(long)]
        job: i64,
    },
    /// (Worker) pass your job on to a role, or `done`
    Handoff {
        to: String,
        #[arg(long, default_value = "")]
        note: String,
    },
    /// (Worker) say you're stuck on your job, and why
    Blocked { why: String },
    /// (Team member) ask a person something; the answer comes back here
    Ask { question: String },
    /// (Team member) a one-line warning for the whole team
    HeadsUp { text: String },
    /// (Lead) finish a job: merge its branch and stop its workers
    Finish { job: i64 },
    /// (Lead) stop a worker
    StopWorker { name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TeamSetup {
    pub name: String,
    #[serde(default = "default_workflow")]
    pub workflow: String,
}

fn default_workflow() -> String {
    "default".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Workflow {
    /// The role a job starts with.
    pub first: String,
    /// Which role each one hands to; `done` ends the job.
    pub next: BTreeMap<String, String>,
}

impl Workflow {
    /// Every role it uses.
    pub fn roles(&self) -> Vec<String> {
        let mut roles: Vec<String> = std::iter::once(self.first.clone()).chain(self.next.keys().cloned()).collect();
        roles.extend(self.next.values().filter(|r| r.as_str() != "done").cloned());
        roles.sort();
        roles.dedup();
        roles
    }

    /// Problems that would stop a job moving: unknown roles, or a role
    /// nobody hands to and that isn't first.
    pub fn check(&self, roles_written: &[String]) -> Result<()> {
        for r in self.roles() {
            if !roles_written.contains(&r) {
                bail!("the workflow uses the role {r}, but there's no roles/{r}.md");
            }
            if r != "done" && !self.next.contains_key(&r) {
                bail!("the workflow doesn't say where {r} hands a job to (add it to \"next\", or \"done\")");
            }
        }
        Ok(())
    }
}

const ROLES: &[(&str, &str)] = &[
    ("planner", "Reads the job and the code, and writes a short plan in the job's notes: what to change, in what order, and how to test it. Doesn't change code."),
    ("builder", "Builds what the plan says, with tests, in small commits. When it builds and the tests pass, hands the job on."),
    ("tester", "Tries the change as a user would and runs the tests. Hands it back to the builder with what's wrong, or on as done."),
];

/// Read a folder's setup.
pub fn read_setup(folder: &Path) -> Result<(TeamSetup, Workflow, Vec<String>)> {
    let dir = folder.join(SETUP);
    let setup: TeamSetup = serde_json::from_str(
        &std::fs::read_to_string(dir.join("team.json")).with_context(|| format!("{} has no team set up: run `omicron teams init` there", folder.display()))?,
    )
    .context(".omicron-team/team.json isn't valid")?;
    let wf_path = dir.join("workflows").join(format!("{}.json", setup.workflow));
    let workflow: Workflow = serde_json::from_str(
        &std::fs::read_to_string(&wf_path).with_context(|| format!("there's no workflow {}", wf_path.display()))?,
    )
    .with_context(|| format!("{} isn't valid", wf_path.display()))?;
    let mut roles: Vec<String> = std::fs::read_dir(dir.join("roles"))
        .map(|d| d.flatten().filter_map(|e| e.file_name().to_str()?.strip_suffix(".md").map(String::from)).collect())
        .unwrap_or_default();
    roles.sort();
    workflow.check(&roles)?;
    Ok((setup, workflow, roles))
}

/// Write a starter setup (leaving what's there alone).
pub fn init(folder: &Path, name: &str) -> Result<Vec<PathBuf>> {
    let dir = folder.join(SETUP);
    let mut written = Vec::new();
    let mut write = |path: PathBuf, text: String| -> Result<()> {
        if !path.exists() {
            std::fs::create_dir_all(path.parent().unwrap())?;
            std::fs::write(&path, text)?;
            written.push(path);
        }
        Ok(())
    };
    write(dir.join("team.json"), serde_json::to_string_pretty(&TeamSetup { name: name.into(), workflow: default_workflow() })? + "\n")?;
    for (role, what) in ROLES {
        write(dir.join("roles").join(format!("{role}.md")), format!("# {role}\n\n{what}\n"))?;
    }
    let wf = Workflow {
        first: "planner".into(),
        next: [("planner", "builder"), ("builder", "tester"), ("tester", "done")].iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(),
    };
    write(dir.join("workflows").join("default.json"), serde_json::to_string_pretty(&wf)? + "\n")?;
    Ok(written)
}

pub fn teams(cmd: Teams, as_machine: bool) -> Result<()> {
    match cmd {
        Teams::Init { name } => {
            let folder = std::env::current_dir()?;
            let name = name.unwrap_or_else(|| folder.file_name().and_then(|n| n.to_str()).unwrap_or("team").to_string());
            let written = init(&folder, &name)?;
            if written.is_empty() {
                println!("{SETUP}/ is already set up here.");
            } else {
                println!("Set up the team {name} in {SETUP}/: three roles (planner, builder, tester) and a workflow to edit.");
                println!("Start it with `omicron teams start --project <Project>`.");
            }
        }
        Teams::Start { project, folder } => {
            let folder = match folder {
                Some(f) => f.canonicalize().with_context(|| format!("there's no folder {}", f.display()))?,
                None => std::env::current_dir()?,
            };
            let (setup, workflow, _) = read_setup(&folder)?;
            // Teams run on the machine.
            let board = sign_in(true)?;
            let p = board.project(&project)?;
            let session = this_session();
            let team = board.start_team(&p, &setup.name, &folder.to_string_lossy(), &setup.workflow, session.as_deref())?;
            println!("Started {} in {} on this machine ({} → … → done).", team.name, p.name, workflow.first);
        }
        Teams::Stop { team } => {
            let board = sign_in(true)?;
            let t = board.team(&team)?;
            board.update_team(&t.id, serde_json::json!({ "state": "stopped" }))?;
            println!("Stopped {}. Its jobs are kept; start it again with `omicron teams start`.", t.name);
        }
        Teams::List => {
            let board = sign_in(as_machine)?;
            let all = board.teams()?;
            if all.is_empty() {
                println!("No teams yet. Set a folder up with `omicron teams init`.");
            }
            for t in all {
                let jobs = board.jobs(&t)?;
                let open = jobs.iter().filter(|j| !matches!(j.state.as_str(), "done" | "cancelled")).count();
                println!("{}\t{}\t{}\t{} open jobs\t{}", t.name, t.state, t.workflow, open, t.folder);
            }
        }
        Teams::Pick { team } => crate::picker::pick_team(team)?,
        Teams::AddJob { team, title, text } => {
            let board = sign_in(as_machine)?;
            let t = board.team(&team)?;
            let job = board.add_job(&t, &title, &text)?;
            println!("Added job #{} to {}: {}", job.number, t.name, job.title);
        }
        Teams::StartWorker { role, job } => {
            let name = crate::teams_run::start_worker(&role, job)?;
            println!("Started {name} on job #{job}.");
        }
        Teams::Handoff { to, note } => println!("{}", crate::teams_run::handoff(&to, &note)?),
        Teams::Blocked { why } => println!("{}", crate::teams_run::blocked(&why)?),
        Teams::Ask { question } => println!("{}", crate::teams_run::ask(&question)?),
        Teams::HeadsUp { text } => println!("{}", crate::teams_run::heads_up(&text)?),
        Teams::Finish { job } => println!("{}", crate::teams_run::finish(job)?),
        Teams::StopWorker { name } => println!("{}", crate::teams_run::stop_worker(&name)?),
        Teams::Jobs { team } => {
            let board = sign_in(as_machine)?;
            let t = board.team(&team)?;
            let jobs = board.jobs(&t)?;
            if jobs.is_empty() {
                println!("{} has no jobs yet. Add one with `omicron teams add-job {} \"<title>\"`.", t.name, t.name);
            }
            for j in jobs {
                let with = j.step.map(|s| format!(" ({s})")).unwrap_or_default();
                println!("#{}\t{}{with}\t{}", j.number, j.state, j.title);
            }
        }
    }
    Ok(())
}

/// The Omicron session this runs in, if any (it manages the team).
fn this_session() -> Option<String> {
    let windows = omicron::windows::Windows::load().ok()?;
    let pid = omicron::windows::this_window(&windows).ok()??;
    windows.windows.get(&pid)?.session_id.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_starter_setup_reads_back_and_checks() {
        let dir = std::env::temp_dir().join(format!("omicron-team-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(init(&dir, "web").unwrap().len(), 5);
        assert!(init(&dir, "web").unwrap().is_empty(), "a second init leaves it alone");
        let (setup, wf, roles) = read_setup(&dir).unwrap();
        assert_eq!(setup, TeamSetup { name: "web".into(), workflow: "default".into() });
        assert_eq!(wf.first, "planner");
        assert_eq!(roles, ["builder", "planner", "tester"]);

        // A workflow naming a role with no file, or a dead end, is refused.
        std::fs::remove_file(dir.join(".omicron-team/roles/tester.md")).unwrap();
        assert!(read_setup(&dir).unwrap_err().to_string().contains("no roles/tester.md"));
        let wf = Workflow { first: "planner".into(), next: [("planner".to_string(), "builder".to_string())].into() };
        assert!(wf.check(&["planner".into(), "builder".into()]).unwrap_err().to_string().contains("where builder hands"));
    }
}
