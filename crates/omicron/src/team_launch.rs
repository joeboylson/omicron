//! Building and starting a team's members: their instructions, the lead,
//! workers and the advisor, and stopping them.

use crate::teams_cmd::{read_setup, Workflow, SETUP};
use anyhow::{bail, Context, Result};
use omicron::board::{Board, Job, TeamRow};
use std::path::Path;
use crate::teams_run::*;

pub(crate) fn commands_text(lead: bool) -> String {
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

pub(crate) fn lead_instructions(team: &TeamRow, workflow: &Workflow, roles: &[(String, String)]) -> String {
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

pub(crate) fn role_texts(team: &TeamRow) -> Result<Vec<(String, String)>> {
    let (_, _, roles) = read_setup(Path::new(&team.folder))?;
    roles
        .into_iter()
        .map(|r| {
            let text = std::fs::read_to_string(Path::new(&team.folder).join(SETUP).join("roles").join(format!("{r}.md")))?;
            Ok((r, text))
        })
        .collect()
}

pub(crate) fn claude_command(host: &str, instructions: &str, first: &str) -> Result<Vec<String>> {
    let settings = crate::claude_setup::omicron_claude_settings()?;
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

pub(crate) fn picked_up(note: Option<&str>) -> String {
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

pub(crate) fn launch_lead(board: &Board, team: &TeamRow, note: Option<&str>) -> Result<bool> {
    launch_lead_told(board, team, note, None)
}

pub(crate) fn launch_lead_told(board: &Board, team: &TeamRow, note: Option<&str>, told: Option<&str>) -> Result<bool> {
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
pub(crate) fn nudge_advisor(team: &TeamRow, what: &str) {
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
pub(crate) fn launch(board: &Board, team: &TeamRow, name: &str, role: &str, job: &Job, part: Option<&Part>, note: Option<&str>) -> Result<()> {
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

pub(crate) fn stop(team: &TeamRow, worker: &str) -> Result<()> {
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
