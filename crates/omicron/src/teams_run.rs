//! Running a team on this machine: the lead and workers are Claude sessions
//! in Omicron's session host (`<team>.lead`, `<team>.builder-2`), each told
//! its team and name in its environment. Each job works in its own git
//! worktree on a `job/<number>-<name>` branch; the lead finishes a job by
//! merging that branch.

use crate::teams_cmd::{read_setup, Workflow, SETUP};
use anyhow::{bail, Context, Result};
use omicron::board::{Board, Job, TeamRow};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

pub const TEAM_ENV: &str = "OMICRON_TEAM";
pub const WORKER_ENV: &str = "OMICRON_WORKER";

pub fn host_name(team: &str, worker: &str) -> String {
    format!("{team}.{worker}")
}

/// Type a message into a team member's session, if it's running.
pub fn tell(team: &str, worker: &str, text: &str) -> Result<bool> {
    let name = host_name(team, worker);
    if !omicron::host::is_running(&name) {
        return Ok(false);
    }
    // One line: a new line would send it early.
    let line = text.replace(['\n', '\r'], " ");
    omicron::host::send(&name, &line)?;
    std::thread::sleep(Duration::from_millis(300));
    omicron::host::send(&name, "\r")?;
    Ok(true)
}

fn slug(title: &str) -> String {
    let s: String = title.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    s.split('-').filter(|p| !p.is_empty()).take(5).collect::<Vec<_>>().join("-")
}

pub fn branch(job: &Job) -> String {
    format!("job/{}-{}", job.number, slug(&job.title))
}

fn is_git(folder: &Path) -> bool {
    Command::new("git").arg("-C").arg(folder).args(["rev-parse", "--is-inside-work-tree"]).output().is_ok_and(|o| o.status.success())
}

fn git(folder: &Path, args: &[&str]) -> Result<String> {
    let o = Command::new("git").arg("-C").arg(folder).args(args).output().context("couldn't run git")?;
    if !o.status.success() {
        bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// Where a job's work happens: its own worktree (made the first time), or
/// the folder itself when it isn't in git.
pub fn job_folder(team: &TeamRow, job: &Job) -> Result<PathBuf> {
    let folder = PathBuf::from(&team.folder);
    if !is_git(&folder) {
        return Ok(folder);
    }
    let path = omicron::config::home()?.join("teams").join(format!("{}-{}", team.name, &team.id[..8])).join(format!("job-{}", job.number));
    if !path.exists() {
        std::fs::create_dir_all(path.parent().unwrap())?;
        let b = branch(job);
        let exists = git(&folder, &["rev-parse", "--verify", "--quiet", &b]).is_ok();
        let p = path.to_string_lossy().to_string();
        if exists {
            git(&folder, &["worktree", "add", &p, &b])?;
        } else {
            git(&folder, &["worktree", "add", "-b", &b, &p])?;
        }
    }
    Ok(path)
}

fn commands_text(lead: bool) -> String {
    let mut t = String::from(
        "Your team commands (run them with Bash): \
         `omicron teams handoff <role or done> --note \"<what you did, what's next>\"` passes the job on (done when it's finished); \
         `omicron teams blocked \"<why>\"` says you're stuck. ",
    );
    if lead {
        t.push_str(
            "As the lead: `omicron teams jobs <team>` lists jobs; `omicron teams start-worker <role> --job <n>` starts a worker on a job \
             (or tells you to message the one already on it); `omicron sessions send <team>.<worker> \"<message>\\r\"` messages a worker; \
             `omicron teams finish <n>` merges a finished job; `omicron teams stop-worker <name>` stops one. ",
        );
    }
    t
}

fn lead_instructions(team: &TeamRow, workflow: &Workflow, roles: &[(String, String)]) -> String {
    let flow: Vec<String> = std::iter::once(workflow.first.clone())
        .chain(workflow.next.iter().map(|(a, b)| format!("{a} → {b}")))
        .collect();
    let mut t = format!(
        "You are the lead of the team {} (Omicron Teams). You hand out work; you don't do the jobs yourself. \
         When a job comes in, start its first role ({}) on it. When a worker hands a job on, start (or message) the next role. \
         When the last role says it's done, finish it. If a worker is blocked, help or pass it on. Keep jobs moving, and one worker per job and role. \
         Workflow: {}. Roles: ",
        team.name,
        workflow.first,
        flow.join("; ")
    );
    for (name, text) in roles {
        t.push_str(&format!("{name}: {} ", text.lines().filter(|l| !l.starts_with('#')).collect::<Vec<_>>().join(" ").trim()));
    }
    t.push_str(&commands_text(true));
    t
}

fn role_texts(team: &TeamRow) -> Result<Vec<(String, String)>> {
    let (_, _, roles) = read_setup(Path::new(&team.folder))?;
    roles
        .into_iter()
        .map(|r| {
            let text = std::fs::read_to_string(Path::new(&team.folder).join(SETUP).join("roles").join(format!("{r}.md")))?;
            Ok((r, text))
        })
        .collect()
}

fn claude_command(host: &str, instructions: &str, first: &str) -> Result<Vec<String>> {
    let settings = crate::sessions_cmd::omicron_claude_settings()?;
    let mut cmd = vec![
        "claude".to_string(),
        "--session-id".into(),
        uuid::Uuid::new_v4().to_string(),
        "--name".into(),
        host.to_string(),
        "--settings".into(),
        settings.to_string_lossy().into_owned(),
        "--append-system-prompt".into(),
        instructions.to_string(),
    ];
    cmd.extend(omicron::config::Config::load()?.claude_args);
    cmd.push(first.to_string());
    Ok(cmd)
}

fn env(team: &TeamRow, worker: &str) -> Vec<(String, String)> {
    vec![(TEAM_ENV.into(), team.id.clone()), (WORKER_ENV.into(), worker.into()), ("OMICRON_AS".into(), "machine".into())]
}

/// Start the team's lead, if it isn't running. Returns whether it started.
pub fn start_lead(board: &Board, team: &TeamRow) -> Result<bool> {
    let name = host_name(&team.name, "lead");
    if omicron::host::is_running(&name) {
        return Ok(false);
    }
    let (_, workflow, _) = read_setup(Path::new(&team.folder))?;
    let jobs = board.jobs(team)?;
    let waiting: Vec<String> = jobs.iter().filter(|j| j.state == "waiting").map(|j| format!("#{} {}", j.number, j.title)).collect();
    let first = if waiting.is_empty() {
        format!("The team {} is running. No jobs are waiting; you'll be told when one comes in.", team.name)
    } else {
        format!("The team {} is running. Jobs waiting: {}. Start them.", team.name, waiting.join("; "))
    };
    let cmd = claude_command(&name, &lead_instructions(team, &workflow, &role_texts(team)?), &first)?;
    omicron::host::start(&name, Path::new(&team.folder), &cmd, &env(team, "lead"))?;
    board.set_worker(team, "lead", "lead", "busy", None)?;
    Ok(true)
}

/// Who's calling: the team and worker in this session's environment.
pub fn caller() -> Result<(Board, TeamRow, String)> {
    let team_id = std::env::var(TEAM_ENV).context("run this in a team's session (it sets OMICRON_TEAM)")?;
    let worker = std::env::var(WORKER_ENV).context("run this in a team's session (it sets OMICRON_WORKER)")?;
    let board = crate::board_cmd::sign_in(true)?;
    let team = board.team_by_id(&team_id)?;
    Ok((board, team, worker))
}

fn lead_only(worker: &str, what: &str) -> Result<()> {
    if worker != "lead" {
        bail!("only the lead can {what}");
    }
    Ok(())
}

/// The lead starts a worker in a role on a job.
pub fn start_worker(role: &str, number: i64) -> Result<String> {
    let (board, team, me) = caller()?;
    lead_only(&me, "start workers")?;
    let roles = role_texts(&team)?;
    let Some((_, role_text)) = roles.iter().find(|(r, _)| r == role) else {
        bail!("{} has no role {role}", team.name);
    };
    let job = board.job(&team, number)?;
    if matches!(job.state.as_str(), "done" | "cancelled") {
        bail!("job #{number} is {}", job.state);
    }
    let workers = board.workers(&team)?;
    let live = |state: &str| matches!(state, "starting" | "busy" | "idle");
    if let Some((name, ..)) = workers.iter().find(|(_, r, s, j)| r == role && live(s) && j.as_deref() == Some(job.id.as_str())) {
        if omicron::host::is_running(&host_name(&team.name, name)) {
            bail!("{name} is already on job #{number}: message it instead (omicron sessions send {}.{name} \"...\\r\")", team.name);
        }
    }
    // The role's name, or the next free copy (builder-2, builder-3...).
    let taken = |n: &str| workers.iter().any(|(w, _, s, _)| w == n && live(s)) || omicron::host::is_running(&host_name(&team.name, n));
    let name = (1..).map(|i| if i == 1 { role.to_string() } else { format!("{role}-{i}") }).find(|n| !taken(n)).unwrap();
    let folder = job_folder(&team, &job)?;
    let (_, workflow, _) = read_setup(Path::new(&team.folder))?;
    let next = workflow.next.get(role).cloned().unwrap_or_else(|| "done".into());
    let instructions = format!(
        "You are {name}, the {role} in the team {}. {} You work on one job at a time, in this folder (its own git branch, {}). \
         Commit your work. When your step is done, hand it on (usually to {next}). {}",
        team.name,
        role_text.lines().filter(|l| !l.starts_with('#')).collect::<Vec<_>>().join(" ").trim(),
        branch(&job),
        commands_text(false)
    );
    let first = format!("Job #{}: {}\n\n{}{}", job.number, job.title, job.text, job.note.as_ref().map(|n| format!("\n\nNotes so far: {n}")).unwrap_or_default());
    let host = host_name(&team.name, &name);
    omicron::host::start(&host, &folder, &claude_command(&host, &instructions, &first)?, &env(&team, &name))?;
    board.set_worker(&team, &name, role, "busy", Some(&job.id))?;
    board.update_job(&job, serde_json::json!({ "state": "working", "step": role }))?;
    Ok(name)
}

/// The job a worker is on.
fn my_job(board: &Board, team: &TeamRow, me: &str) -> Result<Job> {
    let workers = board.workers(team)?;
    let job_id = workers.iter().find(|(w, ..)| w == me).and_then(|(.., j)| j.clone()).context("you're not on a job")?;
    board.jobs(team)?.into_iter().find(|j| j.id == job_id).context("your job is gone")
}

/// A worker passes its job on: to a role, or `done`.
pub fn handoff(to: &str, note: &str) -> Result<String> {
    let (board, team, me) = caller()?;
    let job = my_job(&board, &team, &me)?;
    let (_, _, roles) = read_setup(Path::new(&team.folder))?;
    if to != "done" && !roles.iter().any(|r| r == to) {
        bail!("{} has no role {to} (roles: {}, or done)", team.name, roles.join(", "));
    }
    board.update_job(&job, serde_json::json!({ "step": to, "note": note, "state": "working" }))?;
    let role = board.workers(&team)?.into_iter().find(|(w, ..)| *w == me).map(|(_, r, ..)| r).unwrap_or_default();
    board.set_worker(&team, &me, &role, "idle", Some(&job.id))?;
    let msg = if to == "done" {
        format!("{me} says job #{} is done: {note} Finish it with omicron teams finish {}.", job.number, job.number)
    } else {
        format!("{me} handed job #{} to {to}: {note} Start or message the {to}.", job.number)
    };
    tell(&team.name, "lead", &msg)?;
    Ok(format!("Handed job #{} to {to}. The lead has been told.", job.number))
}

pub fn blocked(why: &str) -> Result<String> {
    let (board, team, me) = caller()?;
    let job = my_job(&board, &team, &me)?;
    board.update_job(&job, serde_json::json!({ "state": "blocked", "note": why }))?;
    tell(&team.name, "lead", &format!("{me} is blocked on job #{}: {why}", job.number))?;
    Ok(format!("Job #{} is blocked. The lead has been told.", job.number))
}

/// The lead finishes a job: merges its branch and stops its workers.
pub fn finish(number: i64) -> Result<String> {
    let (board, team, me) = caller()?;
    lead_only(&me, "finish jobs")?;
    let job = board.job(&team, number)?;
    let folder = PathBuf::from(&team.folder);
    if is_git(&folder) {
        let b = branch(&job);
        if git(&folder, &["rev-parse", "--verify", "--quiet", &b]).is_ok() {
            if let Err(e) = git(&folder, &["merge", "--no-ff", "-m", &format!("Job #{}: {}", job.number, job.title), &b]) {
                // Only a real clash goes back to the builder; anything else
                // (no git identity, a dirty folder) is said as it is.
                let clash = git(&folder, &["diff", "--name-only", "--diff-filter=U"]).is_ok_and(|f| !f.is_empty());
                let _ = git(&folder, &["merge", "--abort"]);
                if !clash {
                    bail!("couldn't merge job #{number}'s branch: {e:#}");
                }
                board.update_job(&job, serde_json::json!({ "state": "working", "step": "builder", "note": format!("Merging clashed: {e}") }))?;
                bail!("job #{number}'s branch clashes with the base: send it back to the builder to fix the clash, then finish it again");
            }
            let path = omicron::config::home()?.join("teams").join(format!("{}-{}", team.name, &team.id[..8])).join(format!("job-{}", job.number));
            let _ = git(&folder, &["worktree", "remove", "--force", &path.to_string_lossy()]);
            let _ = git(&folder, &["branch", "-d", &b]);
        }
    }
    board.update_job(&job, serde_json::json!({ "state": "done" }))?;
    for (w, role, state, j) in board.workers(&team)? {
        if j.as_deref() == Some(job.id.as_str()) && state != "stopped" {
            stop(&team, &w)?;
            board.set_worker(&team, &w, &role, "stopped", None)?;
        }
    }
    Ok(format!("Finished job #{number}: merged and its workers stopped."))
}

fn stop(team: &TeamRow, worker: &str) -> Result<()> {
    let host = host_name(&team.name, worker);
    if omicron::host::is_running(&host) {
        omicron::host::send(&host, "/exit")?;
        std::thread::sleep(Duration::from_millis(300));
        omicron::host::send(&host, "\r")?;
    }
    Ok(())
}

pub fn stop_worker(name: &str) -> Result<String> {
    let (board, team, me) = caller()?;
    lead_only(&me, "stop workers")?;
    let role = board.workers(&team)?.into_iter().find(|(w, ..)| w == name).map(|(_, r, ..)| r).with_context(|| format!("no worker {name}"))?;
    stop(&team, name)?;
    board.set_worker(&team, name, &role, "stopped", None)?;
    Ok(format!("Stopped {name}."))
}

/// The daemon's side: a change about a team or job on this machine.
pub fn heard(supabase: &omicron::supa::Supabase, key: &omicron::supa::MachineKey, row: &serde_json::Value) -> Result<()> {
    let table = row["table_name"].as_str().unwrap_or("");
    let record = &row["record"];
    let board = || -> Result<Board> { Ok(Board { supabase: supabase.clone(), session: supabase.sign_in_machine(key)? }) };
    match (table, row["kind"].as_str().unwrap_or("")) {
        ("teams", "INSERT" | "UPDATE") if record["machine_id"] == key.machine_id.to_string() => {
            let b = board()?;
            let team = b.team_by_id(record["id"].as_str().unwrap_or(""))?;
            if team.state == "running" {
                start_lead(&b, &team)?;
            } else {
                stop(&team, "lead")?;
            }
        }
        ("jobs", "INSERT") => {
            let b = board()?;
            let Ok(team) = b.team_by_id(record["team_id"].as_str().unwrap_or("")) else { return Ok(()) };
            if team.machine_id != key.machine_id.to_string() || team.state != "running" {
                return Ok(());
            }
            // A new lead is told about waiting jobs when it starts.
            if !start_lead(&b, &team)? {
                let (_, workflow, _) = read_setup(Path::new(&team.folder))?;
                let n = record["number"].as_i64().unwrap_or(0);
                tell(
                    &team.name,
                    "lead",
                    &format!("New job #{n}: {}. Start the {} on it: omicron teams start-worker {} --job {n}", record["title"].as_str().unwrap_or(""), workflow.first, workflow.first),
                )?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// When the daemon starts: bring back the lead of each running team here.
pub fn bring_back(supabase: &omicron::supa::Supabase, key: &omicron::supa::MachineKey) -> Result<()> {
    let b = Board { supabase: supabase.clone(), session: supabase.sign_in_machine(key)? };
    for team in b.teams()?.into_iter().filter(|t| t.machine_id == key.machine_id.to_string() && t.state == "running") {
        if let Err(e) = start_lead(&b, &team) {
            eprintln!("omicron daemon: couldn't start {}'s lead: {e:#}", team.name);
        }
    }
    Ok(())
}
