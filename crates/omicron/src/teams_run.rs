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
/// The part of its job a worker is on, if it's on one.
pub const PART_ENV: &str = "OMICRON_PART";
/// The team's folder, so the Stop hook can read its setup without signing in.
pub const FOLDER_ENV: &str = "OMICRON_TEAM_FOLDER";
/// The advisor hears how things are going at most this often.
const NUDGE_EVERY: Duration = Duration::from_secs(10 * 60);

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
    let line = omicron::text::line(&text.replace('\r', " "));
    omicron::host::say(&name, &line)?;
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

/// Where the running team keeps its own files and job worktrees.
pub fn team_home(team: &TeamRow) -> Result<PathBuf> {
    Ok(omicron::config::home()?.join("teams").join(format!("{}-{}", team.name, &team.id[..8])))
}

/// Where a job's own worktree goes (whether or not it's been made).
pub fn worktree(team: &TeamRow, number: i64) -> Result<PathBuf> {
    Ok(team_home(team)?.join(format!("job-{number}")))
}

/// A part of a big job, worked alongside the others in its own checkout
/// (off the job's branch) and merged back into the job's branch when done.
#[derive(Debug, Clone)]
pub struct Part {
    pub number: i64,
    pub text: String,
    pub folder: PathBuf,
    pub branch: String,
}

fn part_folder(team: &TeamRow, job: i64, part: i64) -> Result<PathBuf> {
    Ok(team_home(team)?.join(format!("job-{job}-part-{part}")))
}

fn part_branch(job: &Job, part: i64) -> String {
    format!("{}-part-{part}", branch(job))
}

/// Make the next part of a job: its checkout, and a note of what it covers.
pub fn new_part(team: &TeamRow, job: &Job, text: &str) -> Result<Part> {
    let folder = PathBuf::from(&team.folder);
    if !is_git(&folder) {
        bail!("parts need the team's folder in git (each part gets its own checkout)");
    }
    job_folder(team, job)?;
    let number = (1..)
        .find(|&k| {
            part_folder(team, job.number, k).is_ok_and(|p| !p.exists()) && git(&folder, &["rev-parse", "--verify", "--quiet", &part_branch(job, k)]).is_err()
        })
        .unwrap();
    let path = part_folder(team, job.number, number)?;
    let b = part_branch(job, number);
    git(&folder, &["worktree", "add", "-b", &b, &path.to_string_lossy(), &branch(job)])?;
    std::fs::write(path.with_extension("txt"), text)?;
    Ok(Part { number, text: text.into(), folder: path, branch: b })
}

pub fn read_part(team: &TeamRow, job: &Job, number: i64) -> Result<Part> {
    let path = part_folder(team, job.number, number)?;
    let text = std::fs::read_to_string(path.with_extension("txt")).with_context(|| format!("job #{} has no part {number}", job.number))?;
    Ok(Part { number, text, folder: path, branch: part_branch(job, number) })
}

/// A job's parts, made so far, in order.
pub fn parts(team: &TeamRow, job: &Job) -> Result<Vec<Part>> {
    let prefix = format!("job-{}-part-", job.number);
    let mut found: Vec<i64> = std::fs::read_dir(team_home(team)?)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_prefix(&prefix)?.strip_suffix(".txt")?.parse().ok())
        .collect();
    found.sort();
    found.into_iter().map(|k| read_part(team, job, k)).collect()
}

/// The parts not merged into the job's branch yet.
pub fn parts_left(team: &TeamRow, job: &Job) -> Result<Vec<Part>> {
    let wt = worktree(team, job.number)?;
    Ok(parts(team, job)?
        .into_iter()
        .filter(|p| git(&wt, &["merge-base", "--is-ancestor", &p.branch, "HEAD"]).is_err())
        .collect())
}

/// Where a job's work happens: its own worktree (made the first time), or
/// the folder itself when it isn't in git.
pub fn job_folder(team: &TeamRow, job: &Job) -> Result<PathBuf> {
    let folder = PathBuf::from(&team.folder);
    if !is_git(&folder) {
        return Ok(folder);
    }
    let path = worktree(team, job.number)?;
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
         `omicron teams blocked \"<why>\"` says you're stuck; `omicron teams ask \"<question>\"` asks a person (the answer comes back to you); `omicron teams heads-up \"<one line>\"` warns the whole team (a gotcha, a slow command, a file not to touch). \
         If you're asked to hand over a long conversation: `omicron teams handover --note \"<where you are, what's left, what to know>\"`; a fresh conversation picks up from the note. ",
    );
    if lead {
        t.push_str(
            "As the lead: `omicron teams jobs <team>` lists jobs; `omicron teams start-worker <role> --job <n>` starts a worker on a job \
             (or tells you to message the one already on it); for a big step, split it: `omicron teams start-worker <role> --job <n> --part \"<what this part covers>\"` \
             once per part, and the copies work at the same time, each in its own checkout, merged into the job's branch as each is handed off; `omicron sessions send <team>.<worker> \"<message>\"` messages a worker; \
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
    vec![
        (TEAM_ENV.into(), team.id.clone()),
        (WORKER_ENV.into(), worker.into()),
        (FOLDER_ENV.into(), team.folder.clone()),
        ("OMICRON_AS".into(), "machine".into()),
    ]
}

fn picked_up(note: Option<&str>) -> String {
    note.map(|n| format!("\n\nYou're picking up from an earlier conversation, which handed over with this note:\n{n}")).unwrap_or_default()
}

/// Start the team's lead, if it isn't running. Returns whether it started.
pub fn start_lead(board: &Board, team: &TeamRow) -> Result<bool> {
    let started = launch_lead(board, team, None)?;
    if let Err(e) = start_advisor(board, team, None) {
        eprintln!("omicron: couldn't start {}'s advisor: {e:#}", team.name);
    }
    Ok(started)
}

/// Tell the lead something. A lead that isn't running while its team is
/// (it crashed, or was stopped) is started, with the message as the first
/// thing it hears, so nothing said to it is lost. A stopped team's lead
/// can't be told: that's an error, not silence.
pub fn tell_lead(board: &Board, team: &TeamRow, text: &str) -> Result<()> {
    if tell(&team.name, "lead", text)? {
        return Ok(());
    }
    if team.state != "running" {
        bail!("the team {} is stopped, so its lead couldn't be told. Start it with `omicron teams start`.", team.name);
    }
    launch_lead_told(board, team, None, Some(text))?;
    Ok(())
}

fn launch_lead(board: &Board, team: &TeamRow, note: Option<&str>) -> Result<bool> {
    launch_lead_told(board, team, note, None)
}

fn launch_lead_told(board: &Board, team: &TeamRow, note: Option<&str>, told: Option<&str>) -> Result<bool> {
    let name = host_name(&team.name, "lead");
    if omicron::host::is_running(&name) {
        return Ok(false);
    }
    let (_, workflow, _) = read_setup(Path::new(&team.folder))?;
    let jobs = board.jobs(team)?;
    let mut waiting = Vec::new();
    let orders = omicron::gate::Orders::new(board);
    for j in jobs.iter().filter(|j| j.state == "waiting") {
        // Added from elsewhere: only by the machine's owner, gate open.
        if orders.takes(j.created_by.as_deref())? {
            clear_waiting(board, j)?;
            waiting.push(format!("#{} {}", j.number, j.title));
        }
    }
    let first = if waiting.is_empty() {
        format!("The team {} is running. No jobs are waiting; you'll be told when one comes in.", team.name)
    } else {
        format!("The team {} is running. Jobs waiting: {}. Start them.", team.name, waiting.join("; "))
    };
    let first = first + &picked_up(note) + &told.map(|t| format!("\n\nWhile you weren't running, you were told: {t}")).unwrap_or_default();
    let cmd = claude_command(&name, &lead_instructions(team, &workflow, &role_texts(team)?), &first)?;
    omicron::host::start(&name, Path::new(&team.folder), &cmd, &env(team, "lead"))?;
    board.set_worker(team, "lead", "lead", "busy", None)?;
    Ok(true)
}

/// Who's calling: the team and worker in this session's environment.
pub fn caller() -> Result<(Board, TeamRow, String)> {
    let team_id = std::env::var(TEAM_ENV).ok().context("run this in a team's session (it sets OMICRON_TEAM)")?;
    let worker = std::env::var(WORKER_ENV).ok().context("run this in a team's session (it sets OMICRON_WORKER)")?;
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

/// The advisor, if the team's setup turns it on: it watches how jobs move
/// and suggests speed-ups to the lead. Returns whether it started.
pub fn start_advisor(board: &Board, team: &TeamRow, note: Option<&str>) -> Result<bool> {
    let (setup, workflow, _) = read_setup(Path::new(&team.folder))?;
    let name = host_name(&team.name, "advisor");
    if !setup.advisor || omicron::host::is_running(&name) {
        return Ok(false);
    }
    let instructions = format!(
        "You are the advisor of the team {} (Omicron Teams). You don't do jobs or run workers. You watch how jobs move and look for ways \
         to finish them sooner: a big step worth splitting into parts, a worker that's stuck or going round in circles, a slow command \
         the team keeps running, jobs that could run at the same time. When you see one, suggest it to the lead with \
         `omicron teams suggest \"<the idea, and why>\"`; the lead decides. Say nothing when there's nothing worth saying. \
         See the jobs with `omicron teams jobs {}`. Workflow starts with {}.",
        team.name, team.name, workflow.first
    );
    let first = format!("The team {} is running. You'll be told when jobs move; look then.{}", team.name, picked_up(note));
    omicron::host::start(&name, Path::new(&team.folder), &claude_command(&name, &instructions, &first)?, &env(team, "advisor"))?;
    board.set_worker(team, "advisor", "advisor", "idle", None)?;
    Ok(true)
}

/// Tell the advisor things moved, at most every ten minutes.
fn nudge_advisor(team: &TeamRow, what: &str) {
    let host = host_name(&team.name, "advisor");
    if !omicron::host::is_running(&host) {
        return;
    }
    let Ok(stamp) = team_home(team).map(|h| h.join("advisor-nudged")) else { return };
    let recent = std::fs::metadata(&stamp).and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|e| e < NUDGE_EVERY);
    if recent {
        return;
    }
    let _ = std::fs::create_dir_all(stamp.parent().unwrap());
    let _ = std::fs::write(&stamp, "");
    let _ = tell(&team.name, "advisor", &format!("Since you last looked: {what} Check how the jobs are going, and suggest a speed-up if you see one."));
}

/// The advisor suggests something to the lead.
pub fn suggest(idea: &str) -> Result<String> {
    let (_, team, me) = caller()?;
    if me != "advisor" {
        bail!("only the advisor makes suggestions");
    }
    if !tell(&team.name, "lead", &format!("The advisor suggests: {idea} (Yours to take or leave.)"))? {
        bail!("the lead isn't running");
    }
    Ok("Suggested to the lead.".into())
}

/// The lead starts a worker in a role on a job (or on one part of it).
pub fn start_worker(role: &str, number: i64, part: Option<&str>) -> Result<String> {
    let (board, team, me) = caller()?;
    lead_only(&me, "start workers")?;
    let roles = role_texts(&team)?;
    if !roles.iter().any(|(r, _)| r == role) {
        bail!("{} has no role {role}", team.name);
    }
    let job = board.job(&team, number)?;
    if matches!(job.state.as_str(), "done" | "cancelled") {
        bail!("job #{number} is {}", job.state);
    }
    let workers = board.workers(&team)?;
    let live = |state: &str| matches!(state, "starting" | "busy" | "idle");
    // One copy per job, except for parts: they're worked side by side.
    if part.is_none() {
        if let Some(name) = workers.iter().find(|w| w.role == role && live(&w.state) && w.job_id.as_deref() == Some(job.id.as_str())).map(|w| &w.name) {
            if omicron::host::is_running(&host_name(&team.name, name)) {
                bail!("{name} is already on job #{number}: message it instead (omicron sessions send {}.{name} \"...\")", team.name);
            }
        }
    }
    // The role's name, or the next free copy (builder-2, builder-3...).
    let taken = |n: &str| workers.iter().any(|w| w.name == n && live(&w.state)) || omicron::host::is_running(&host_name(&team.name, n));
    let name = (1..).map(|i| if i == 1 { role.to_string() } else { format!("{role}-{i}") }).find(|n| !taken(n)).unwrap();
    let part = part.map(|text| new_part(&team, &job, text)).transpose()?;
    launch(&board, &team, &name, role, &job, part.as_ref(), None)?;
    Ok(name)
}

/// Start a worker's session: on its job (or a part of it), maybe picking
/// up from a handover note.
fn launch(board: &Board, team: &TeamRow, name: &str, role: &str, job: &Job, part: Option<&Part>, note: Option<&str>) -> Result<()> {
    let roles = role_texts(team)?;
    let role_text = roles.iter().find(|(r, _)| r == role).map(|(_, t)| t.clone()).with_context(|| format!("{} has no role {role}", team.name))?;
    let (_, workflow, _) = read_setup(Path::new(&team.folder))?;
    let next = workflow.next.get(role).cloned().unwrap_or_else(|| "done".into());
    let role_line = role_text.lines().filter(|l| !l.starts_with('#')).collect::<Vec<_>>().join(" ").trim().to_string();
    let (folder, step) = match part {
        Some(p) => (
            p.folder.clone(),
            format!(
                "You work on one part of a job, alongside copies working on its other parts, in this folder (its own git branch, {}). \
                 Only do your part. Commit your work. When your part is done, run `omicron teams handoff done --note \"...\"`: \
                 your part is merged into the job's branch ({}) and the lead is told.",
                p.branch,
                branch(job)
            ),
        ),
        None => (
            job_folder(team, job)?,
            format!("You work on one job at a time, in this folder (its own git branch, {}). Commit your work. When your step is done, hand it on (usually to {next}).", branch(job)),
        ),
    };
    let instructions = format!("You are {name}, the {role} in the team {}. {role_line} {step} {}", team.name, commands_text(false));
    let mut first = format!("Job #{}: {}\n\n{}{}", job.number, job.title, job.text, job.note.as_ref().map(|n| format!("\n\nNotes so far: {n}")).unwrap_or_default());
    if let Some(p) = part {
        first.push_str(&format!("\n\nYour part (part {}): {}", p.number, p.text));
    }
    first.push_str(&picked_up(note));
    let host = host_name(&team.name, name);
    let mut vars = env(team, name);
    if let Some(p) = part {
        vars.push((PART_ENV.into(), p.number.to_string()));
    }
    omicron::host::start(&host, &folder, &claude_command(&host, &instructions, &first)?, &vars)?;
    board.set_worker(team, name, role, "busy", Some(&job.id))?;
    board.job_at(job, role, None)?;
    Ok(())
}

/// The job a worker is on.
fn my_job(board: &Board, team: &TeamRow, me: &str) -> Result<Job> {
    let workers = board.workers(team)?;
    let job_id = workers.iter().find(|w| w.name == me).and_then(|w| w.job_id.clone()).context("you're not on a job")?;
    board.jobs(team)?.into_iter().find(|j| j.id == job_id).context("your job is gone")
}

/// A worker passes its job on: to a role, or `done`.
pub fn handoff(to: &str, note: &str) -> Result<String> {
    let (board, team, me) = caller()?;
    let job = my_job(&board, &team, &me)?;
    if let Some(k) = std::env::var(PART_ENV).ok().and_then(|k| k.parse().ok()) {
        return part_done(&board, &team, &me, &job, k, note);
    }
    let (_, _, roles) = read_setup(Path::new(&team.folder))?;
    if to != "done" && !roles.iter().any(|r| r == to) {
        bail!("{} has no role {to} (roles: {}, or done)", team.name, roles.join(", "));
    }
    board.job_at(&job, to, Some(note))?;
    let role = board.workers(&team)?.into_iter().find(|w| w.name == me).map(|w| w.role).unwrap_or_default();
    board.set_worker(&team, &me, &role, "idle", Some(&job.id))?;
    let msg = if to == "done" {
        format!("{me} says job #{} is done: {note} Finish it with omicron teams finish {}.", job.number, job.number)
    } else {
        format!("{me} handed job #{} to {to}: {note} Start or message the {to}.", job.number)
    };
    tell_lead(&board, &team, &msg)?;
    nudge_advisor(&team, &msg);
    Ok(format!("Handed job #{} to {to}. The lead has been told.", job.number))
}

/// A part's worker is done: its branch goes into the job's branch.
fn part_done(board: &Board, team: &TeamRow, me: &str, job: &Job, k: i64, note: &str) -> Result<String> {
    let part = read_part(team, job, k)?;
    if !git(&part.folder, &["status", "--porcelain"])?.is_empty() {
        bail!("commit your part's work first (git status shows changes)");
    }
    let wt = worktree(team, job.number)?;
    if let Err(e) = git(&wt, &["merge", "--no-edit", &part.branch]) {
        let clash = git(&wt, &["diff", "--name-only", "--diff-filter=U"]).is_ok_and(|f| !f.is_empty());
        let _ = git(&wt, &["merge", "--abort"]);
        if !clash {
            bail!("couldn't merge your part into the job's branch: {e:#}");
        }
        bail!("your part clashes with the job's branch: run `git merge {}` here, fix the clash, commit, and hand off again", branch(job));
    }
    let left = parts_left(team, job)?;
    let role = board.workers(team)?.into_iter().find(|w| w.name == me).map(|w| w.role).unwrap_or_default();
    board.set_worker(team, me, &role, "idle", Some(&job.id))?;
    let rest = if left.is_empty() {
        "All its parts are in: hand the job on to the next role.".to_string()
    } else {
        format!("Parts still going: {}.", left.iter().map(|p| p.number.to_string()).collect::<Vec<_>>().join(", "))
    };
    let msg = format!("{me} finished part {k} of job #{} ({}): {note} It's merged into the job's branch. {rest} Stop {me} with omicron teams stop-worker {me}.", job.number, part.text);
    tell_lead(board, team, &msg)?;
    nudge_advisor(team, &msg);
    Ok(format!("Your part is merged into job #{}'s branch, and the lead has been told. You're done.", job.number))
}

/// A team member asks a person something. It becomes a task in the team's
/// Project, given to whoever added the job (when a person did); the job is
/// blocked until the answer, a comment there, comes back.
pub fn ask(question: &str) -> Result<String> {
    let (board, team, me) = caller()?;
    let job = my_job(&board, &team, &me).ok();
    let status_id = board.first_open_status(&team.project_id)?.context("the team's Project has no open status")?;
    let asker = job.as_ref().map(|j| j.id.clone());
    // Given to whoever added the job, if they're a member of the Project.
    let to = match job.as_ref().and_then(|j| j.created_by.clone()) {
        Some(p) if board.is_member(&team.project_id, &p)? => Some(p),
        _ => None,
    };
    let about = job.as_ref().map(|j| format!(" about job #{}", j.number)).unwrap_or_default();
    let (task_id, number) = board.add_task_at_bottom(
        &team.project_id,
        &status_id,
        &format!("{}: {me} asks{about}", team.name),
        &format!("{question}\n\nAnswer with a comment; it goes straight back to {me}."),
        to.as_deref(),
    )?;
    board.add_team_request(&team, asker.as_deref(), &me, &task_id)?;
    if let Some(j) = &job {
        board.block_job(j, &format!("Asked: {question}"))?;
    }
    if me != "lead" {
        tell_lead(&board, &team, &format!("{me} asked a person{about}: {question} (task #{number}). It'll come back to {me}."))?;
    }
    Ok(format!("Asked (task #{number}). The answer will come back to you here; carry on with anything that doesn't need it."))
}

/// A one-line heads-up for the whole team: kept in the folder's
/// heads-ups.md and typed to everyone running.
pub fn heads_up(text: &str) -> Result<String> {
    let (board, team, me) = caller()?;
    let line = omicron::text::line(&text.replace('\r', " "));
    if line.chars().count() > 200 {
        bail!("a heads-up is one line of at most 200 characters");
    }
    let file = Path::new(&team.folder).join(SETUP).join("heads-ups.md");
    let mut all = std::fs::read_to_string(&file).unwrap_or_else(|_| "# Heads-ups\n\n".into());
    all.push_str(&format!("- {} ({me}): {line}\n", chrono::Local::now().format("%Y-%m-%d")));
    std::fs::write(&file, all)?;
    let mut told = 0;
    for w in board.workers(&team)? {
        if w.name != me && matches!(w.state.as_str(), "busy" | "idle" | "starting") && tell(&team.name, &w.name, &format!("Heads-up from {me}: {line}"))? {
            told += 1;
        }
    }
    Ok(format!("Heads-up saved in {SETUP}/heads-ups.md and told to {told} running."))
}

pub fn blocked(why: &str) -> Result<String> {
    let (board, team, me) = caller()?;
    let job = my_job(&board, &team, &me)?;
    board.block_job(&job, why)?;
    let msg = format!("{me} is blocked on job #{}: {why}", job.number);
    tell_lead(&board, &team, &msg)?;
    nudge_advisor(&team, &msg);
    Ok(format!("Job #{} is blocked. The lead has been told.", job.number))
}

/// The lead finishes a job: merges its branch and stops its workers.
pub fn finish(number: i64) -> Result<String> {
    let (board, team, me) = caller()?;
    lead_only(&me, "finish jobs")?;
    let job = board.job(&team, number)?;
    let folder = PathBuf::from(&team.folder);
    let left = parts_left(&team, &job)?;
    if !left.is_empty() {
        bail!("job #{number} has parts still going ({}): they're merged into the job's branch as each is handed off", left.iter().map(|p| p.number.to_string()).collect::<Vec<_>>().join(", "));
    }
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
                board.job_at(&job, "builder", Some(&format!("Merging clashed: {e}")))?;
                bail!("job #{number}'s branch clashes with the base: send it back to the builder to fix the clash, then finish it again");
            }
            for p in parts(&team, &job)? {
                let _ = git(&folder, &["worktree", "remove", "--force", &p.folder.to_string_lossy()]);
                let _ = git(&folder, &["branch", "-D", &p.branch]);
                let _ = std::fs::remove_file(p.folder.with_extension("txt"));
            }
            let path = worktree(&team, job.number)?;
            let _ = git(&folder, &["worktree", "remove", "--force", &path.to_string_lossy()]);
            let _ = git(&folder, &["branch", "-d", &b]);
        }
    }
    board.finish_job(&job)?;
    for w in board.workers(&team)? {
        if w.job_id.as_deref() == Some(job.id.as_str()) && w.state != "stopped" {
            stop(&team, &w.name)?;
            board.set_worker(&team, &w.name, &w.role, "stopped", None)?;
        }
    }
    nudge_advisor(&team, &format!("job #{number} ({}) is finished.", job.title));
    Ok(format!("Finished job #{number}: merged and its workers stopped."))
}

fn stop(team: &TeamRow, worker: &str) -> Result<()> {
    let host = host_name(&team.name, worker);
    if omicron::host::is_running(&host) {
        omicron::host::say(&host, "/exit")?;
    }
    Ok(())
}

pub fn stop_worker(name: &str) -> Result<String> {
    let (board, team, me) = caller()?;
    lead_only(&me, "stop workers")?;
    let role = board.workers(&team)?.into_iter().find(|w| w.name == name).map(|w| w.role).with_context(|| format!("no worker {name}"))?;
    stop(&team, name)?;
    board.set_worker(&team, name, &role, "stopped", None)?;
    Ok(format!("Stopped {name}."))
}

/// The daemon's side: a change about a team or job on this machine.
pub fn heard(supabase: &omicron::supa::Supabase, key: &omicron::supa::MachineKey, row: &serde_json::Value) -> Result<()> {
    let table = row["table_name"].as_str().unwrap_or("");
    let record = &row["record"];
    let board = || -> Result<Board> { Board::as_machine(supabase, key) };
    match (table, row["kind"].as_str().unwrap_or("")) {
        ("teams", "INSERT" | "UPDATE") if record["machine_id"] == key.machine_id.to_string() => {
            let b = board()?;
            let team = b.team_by_id(record["id"].as_str().unwrap_or(""))?;
            if team.state == "running" {
                start_lead(&b, &team)?;
            } else {
                stop(&team, "lead")?;
                stop(&team, "advisor")?;
            }
        }
        ("comments", "INSERT") => {
            // An answer to a team's question: pass it back to who asked.
            if record["session_id"].is_string() {
                return Ok(());
            }
            let b = board()?;
            let task = record["task_id"].as_str().unwrap_or("");
            let Some(req) = b.open_request_for_task(task)? else { return Ok(()) };
            let Ok(team) = b.team_by_id(&req.team_id) else { return Ok(()) };
            if team.machine_id != key.machine_id.to_string() {
                return Ok(());
            }
            // From elsewhere: only the owner's, while the gate is open. Until
            // then it stays open, and is passed on when the gate opens.
            if !omicron::gate::Orders::new(&b).takes(record["author_id"].as_str())? {
                return Ok(());
            }
            pass_answer(&b, &team, &req, record)?;
        }
        ("jobs", "INSERT") => {
            let b = board()?;
            let Ok(team) = b.team_by_id(record["team_id"].as_str().unwrap_or("")) else { return Ok(()) };
            if team.machine_id != key.machine_id.to_string() || team.state != "running" {
                return Ok(());
            }
            // Added from elsewhere: waits for the owner and the gate, saying
            // so on the job.
            let orders = omicron::gate::Orders::new(&b);
            if !orders.takes(record["created_by"].as_str())? {
                return note_waiting(&b, &orders, record["id"].as_str().unwrap_or(""), record["note"].as_str(), record["created_by"].as_str());
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

/// What a job added from elsewhere says while this machine won't start it.
const WAITING: &str = "Waiting: it was added from elsewhere.";

/// Say on a job why this machine won't start it yet (once; a job's own
/// change isn't reacted to, so this can't go round).
fn note_waiting(b: &Board, orders: &omicron::gate::Orders, job: &str, now: Option<&str>, who: Option<&str>) -> Result<()> {
    let machine = b.machine(&b.session.user.id.to_string()).map(|m| m.name).unwrap_or_else(|_| "This computer".into());
    let Some(why) = orders.refusal(who, &machine)? else { return Ok(()) };
    let note = format!("{WAITING} {why}");
    if now != Some(note.as_str()) && !job.is_empty() {
        b.waiting_job_note(job, Some(&note))?;
    }
    Ok(())
}

/// Clear that note once the job is taken.
fn clear_waiting(b: &Board, job: &omicron::board::Job) -> Result<()> {
    if job.note.as_deref().is_some_and(|n| n.starts_with(WAITING)) {
        b.waiting_job_note(&job.id, None)?;
    }
    Ok(())
}

/// Pass an answer (a comment on the question's task) to the member who
/// asked, or its lead, and mark the question answered.
fn pass_answer(b: &Board, team: &TeamRow, req: &omicron::board::TeamRequest, comment: &serde_json::Value) -> Result<bool> {
    let worker = req.worker.as_str();
    let who = comment["author_name"].as_str().unwrap_or("someone");
    let body = comment["body"].as_str().unwrap_or("");
    // To who asked; failing that its lead (started if it must be), who passes it on.
    let told = tell(&team.name, worker, &format!("Answer from {who}: {body}"))?
        || (team.state == "running" && tell_lead(b, team, &format!("Answer for {worker} from {who}: {body}")).is_ok());
    if told {
        b.mark_answered(req, &comment["id"])?;
        if let Some(job) = &req.job_id {
            b.unblock_job(job, &format!("Answered by {who}: {body}"))?;
        }
    }
    Ok(told)
}

/// When the gate opens (or the daemon starts): pass on what waited for it,
/// for the running teams here. Open questions get their latest answer that
/// may come in now; jobs added from elsewhere are told to the lead (with
/// `jobs`: a lead that has just started heard them already). Safe to
/// run twice: an answered question isn't open any more, and a lead told
/// about a waiting job again only hears it twice.
pub fn pass_waiting(supabase: &omicron::supa::Supabase, key: &omicron::supa::MachineKey, jobs: bool) -> Result<()> {
    let b = Board::as_machine(supabase, key)?;
    let me = key.machine_id.to_string();
    let orders = omicron::gate::Orders::new(&b);
    for team in b.teams()?.into_iter().filter(|t| t.machine_id == me && t.state == "running") {
        for req in b.open_requests(&team)? {
            for c in b.answers_to(&req)? {
                if orders.takes(c["author_id"].as_str())? {
                    pass_answer(&b, &team, &req, &c)?;
                    break;
                }
            }
        }
        if !jobs {
            continue;
        }
        for j in b.jobs(&team)?.into_iter().filter(|j| j.state == "waiting" && j.created_by.as_deref() != Some(me.as_str())) {
            if orders.takes(j.created_by.as_deref())? {
                clear_waiting(&b, &j)?;
                tell_lead(&b, &team, &format!("Job #{} is waiting: {}. Start it if nobody has.", j.number, j.title))?;
            } else {
                note_waiting(&b, &orders, &j.id, j.note.as_deref(), j.created_by.as_deref())?;
            }
        }
    }
    Ok(())
}

/// When the daemon starts: bring back the lead of each running team here.
pub fn bring_back(supabase: &omicron::supa::Supabase, key: &omicron::supa::MachineKey) -> Result<()> {
    let b = Board::as_machine(supabase, key)?;
    for team in b.teams()?.into_iter().filter(|t| t.machine_id == key.machine_id.to_string() && t.state == "running") {
        if let Err(e) = start_lead(&b, &team) {
            eprintln!("omicron daemon: couldn't start {}'s lead: {e:#}", team.name);
        }
    }
    if omicron::gate::open_until().is_some() {
        pass_waiting(supabase, key, false)?;
    }
    Ok(())
}

/// How many tokens a conversation holds now: the newest turn's input, from
/// its transcript.
pub fn tokens_used(transcript: &str) -> Option<u64> {
    transcript.lines().rev().find_map(|line| {
        let v: serde_json::Value = serde_json::from_str(line).ok()?;
        let u = v["message"].get("usage")?;
        let n = |k: &str| u[k].as_u64().unwrap_or(0);
        Some(n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens"))
    })
}

/// The Stop hook's part, in a team member's session: once its conversation
/// is past the team's handover point, ask it (once) to hand over.
pub fn handover_reason(input: &serde_json::Value) -> Result<Option<String>> {
    let (Ok(folder), Ok(worker)) = (std::env::var(FOLDER_ENV), std::env::var(WORKER_ENV)) else { return Ok(None) };
    let Some(path) = input["transcript_path"].as_str() else { return Ok(None) };
    let Some(claude_id) = input["session_id"].as_str() else { return Ok(None) };
    let Ok((setup, _, _)) = read_setup(Path::new(&folder)) else { return Ok(None) };
    let Some(used) = std::fs::read_to_string(path).ok().as_deref().and_then(tokens_used) else { return Ok(None) };
    let full = used as f64 / setup.context_window.max(1) as f64;
    if full < setup.handover_at {
        return Ok(None);
    }
    let asked = omicron::host::run_dir()?.join("handover-asked");
    std::fs::create_dir_all(&asked)?;
    let mark = asked.join(claude_id);
    if mark.exists() {
        return Ok(None);
    }
    std::fs::write(&mark, &worker)?;
    Ok(Some(format!(
        "Omicron Teams: this conversation is {}% full. Hand it over now: finish the step you're on if it's nearly done, commit, then run \
         `omicron teams handover --note \"<where you are, what's done, what's left, anything the next conversation must know>\"`. \
         A fresh conversation, as {worker}, picks up from your note.",
        (full * 100.0).round()
    )))
}

/// The `claude` this command runs under: the process just below its host.
fn my_claude() -> Option<i32> {
    let mut pid = std::process::id() as i32;
    for _ in 0..20 {
        let o = Command::new("ps").args(["-o", "ppid=,command=", "-p", &pid.to_string()]).output().ok()?;
        let line = String::from_utf8_lossy(&o.stdout).trim().to_string();
        let (ppid, _) = line.split_once(' ')?;
        let ppid: i32 = ppid.trim().parse().ok()?;
        let o = Command::new("ps").args(["-o", "command=", "-p", &ppid.to_string()]).output().ok()?;
        if String::from_utf8_lossy(&o.stdout).contains("sessions host-run") {
            return Some(pid);
        }
        pid = ppid;
    }
    None
}

/// A team member hands its long conversation over: the note is saved, this
/// conversation ends, and a fresh one starts with the note.
pub fn handover(note: &str) -> Result<String> {
    let (_, team, me) = caller()?;
    if note.trim().is_empty() {
        bail!("say where you are in the note");
    }
    let home = team_home(&team)?;
    std::fs::create_dir_all(&home)?;
    let saved = serde_json::json!({ "note": note, "part": std::env::var(PART_ENV).ok(), "claude": my_claude() });
    std::fs::write(home.join(format!("handover-{me}.json")), saved.to_string())?;
    let mut cmd = Command::new(std::env::current_exe()?);
    cmd.args(["teams", "fresh-start", &team.id, &me]).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            nix::unistd::setsid().map_err(std::io::Error::from)?;
            Ok(())
        });
    }
    cmd.spawn().context("couldn't start the fresh conversation")?;
    Ok("Handover saved. This conversation closes in a few seconds, and a fresh one picks up from your note. Stop here.".into())
}

/// The detached half of a handover: end the old conversation, start the
/// fresh one.
pub fn fresh_start(team_id: &str, worker: &str) -> Result<()> {
    std::thread::sleep(Duration::from_secs(5));
    let board = crate::board_cmd::sign_in(true)?;
    let team = board.team_by_id(team_id)?;
    let file = team_home(&team)?.join(format!("handover-{worker}.json"));
    let saved: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file)?)?;
    let note = saved["note"].as_str().unwrap_or("").to_string();
    let host = host_name(&team.name, worker);
    match saved["claude"].as_i64() {
        Some(pid) => {
            let _ = nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid as i32), nix::sys::signal::Signal::SIGTERM);
        }
        None => stop(&team, worker)?,
    }
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    while omicron::host::is_running(&host) && std::time::Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(250));
    }
    if omicron::host::is_running(&host) {
        bail!("{host} didn't close for its handover");
    }
    match worker {
        "lead" => {
            launch_lead(&board, &team, Some(&note))?;
        }
        "advisor" => {
            start_advisor(&board, &team, Some(&note))?;
        }
        _ => {
            let omicron::board::Worker { role, job_id, .. } = board.workers(&team)?.into_iter().find(|w| w.name == worker).with_context(|| format!("no worker {worker}"))?;
            let job = board.jobs(&team)?.into_iter().find(|j| Some(&j.id) == job_id.as_ref()).context("its job is gone")?;
            let part = saved["part"].as_str().and_then(|k| k.parse().ok()).map(|k| read_part(&team, &job, k)).transpose()?;
            launch(&board, &team, worker, &role, &job, part.as_ref(), Some(&note))?;
        }
    }
    let _ = std::fs::remove_file(&file);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &Path, args: &[&str]) {
        let ok = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .status()
            .unwrap();
        assert!(ok.success(), "git {args:?}");
    }

    #[test]
    fn parts_get_their_own_checkouts_and_count_down_as_merged() {
        let root = std::env::temp_dir().join(format!("omicron-parts-{}", uuid::Uuid::new_v4().simple()));
        let folder = root.join("web");
        std::fs::create_dir_all(&folder).unwrap();
        // Only this test reads Omicron's home folder.
        std::env::set_var("OMICRON_HOME", root.join("home"));
        std::fs::write(folder.join("a.txt"), "a\n").unwrap();
        run(&folder, &["init", "-q", "-b", "main"]);
        run(&folder, &["add", "-A"]);
        run(&folder, &["commit", "-qm", "start"]);
        let team = TeamRow {
            id: "0123456789abcdef".into(),
            project_id: "p".into(),
            machine_id: "m".into(),
            name: "web".into(),
            folder: folder.to_string_lossy().into(),
            workflow: "default".into(),
            state: "running".into(),
            session_id: None,
        };
        let job = Job { created_by: None, id: "j".into(), team_id: team.id.clone(), number: 4, title: "Two pages".into(), text: String::new(), state: "working".into(), step: None, note: None };
        let one = new_part(&team, &job, "the login page").unwrap();
        let two = new_part(&team, &job, "the sign-up page").unwrap();
        assert_eq!((one.number, two.number), (1, 2));
        assert_eq!(two.branch, "job/4-two-pages-part-2");
        assert!(one.folder.join("a.txt").exists(), "a part starts from the job's branch");
        assert_eq!(read_part(&team, &job, 2).unwrap().text, "the sign-up page");
        assert_eq!(parts_left(&team, &job).unwrap().len(), 0, "nothing to merge yet: both are at the job's commit");

        // Work in each part; until merged, they're still going.
        std::fs::write(one.folder.join("login.txt"), "in\n").unwrap();
        run(&one.folder, &["add", "-A"]);
        run(&one.folder, &["commit", "-qm", "login"]);
        std::fs::write(two.folder.join("signup.txt"), "up\n").unwrap();
        run(&two.folder, &["add", "-A"]);
        run(&two.folder, &["commit", "-qm", "signup"]);
        let left: Vec<i64> = parts_left(&team, &job).unwrap().iter().map(|p| p.number).collect();
        assert_eq!(left, [1, 2]);
        let wt = worktree(&team, job.number).unwrap();
        run(&wt, &["merge", "-q", "--no-edit", &one.branch]);
        let left: Vec<i64> = parts_left(&team, &job).unwrap().iter().map(|p| p.number).collect();
        assert_eq!(left, [2]);
        assert_eq!(parts(&team, &job).unwrap().len(), 2);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn how_full_a_conversation_is_comes_from_its_newest_turn() {
        let transcript = [
            r#"{"type":"user","message":{"role":"user","content":"hi"}}"#,
            r#"{"type":"assistant","message":{"usage":{"input_tokens":10,"cache_read_input_tokens":1000,"cache_creation_input_tokens":50}}}"#,
            r#"{"type":"assistant","message":{"usage":{"input_tokens":5,"cache_read_input_tokens":140000,"cache_creation_input_tokens":200,"output_tokens":900}}}"#,
            r#"{"type":"system","content":"x"}"#,
        ]
        .join("\n");
        assert_eq!(tokens_used(&transcript), Some(140205));
        assert_eq!(tokens_used("not json\n"), None);
    }
}
