//! The commands a team's members run: handing a job on, asking a person,
//! heads-ups, being blocked, finishing, and handing over a full conversation.

use crate::teams_cmd::{read_setup, SETUP};
use anyhow::{bail, Context, Result};
use omicron::board::{Board, Job, TeamRow};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;
use crate::teams_run::*;

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
pub(crate) fn part_done(board: &Board, team: &TeamRow, me: &str, job: &Job, k: i64, note: &str) -> Result<String> {
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
pub(crate) fn my_claude() -> Option<i32> {
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
