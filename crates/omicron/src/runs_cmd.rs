//! Runs: one computer works down a Project's To do column on its own, in
//! one session (ref/BRAINSTORM.md, "Runs").
//!
//! The run's machine (its daemon) does the work. It gives the session the
//! top To do task and tells it to start. When the task leaves To do and
//! Doing (the session moved it to Review, or anywhere else), the session
//! hands off and is cleared, and gets the next task. It stops when To do is
//! empty, when someone pauses (after the current task) or stops it, or when
//! the machine may no longer take its orders (a run started from elsewhere
//! goes only from the machine's owner, while its gate is open).
//!
//! Each step reads the run afresh and does at most one thing, so hearing
//! the same change twice is safe.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use clap::Subcommand;
use omicron::board::{Board, Run};
use omicron::supa::{MachineKey, Supabase};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Mutex;

#[derive(Subcommand)]
pub enum RunsCmd {
    /// Start a run: a session on this machine works down the Project's To
    /// do column, one task at a time, until it's empty
    Start {
        project: String,
        /// The session (one of this machine's, in the Project)
        #[arg(long)]
        session: String,
        /// Only tasks with this label
        #[arg(long)]
        label: Option<String>,
    },
    /// A Project's runs, newest first
    List { project: String },
    /// Finish the task it's on, then stop
    Pause {
        project: String,
        /// Which session's run, if the Project has more than one going
        #[arg(long)]
        session: Option<String>,
    },
    /// Stop now (the task it's on stays where it is)
    Stop {
        project: String,
        #[arg(long)]
        session: Option<String>,
    },
}

pub fn runs(cmd: RunsCmd, as_machine: bool) -> Result<()> {
    match cmd {
        RunsCmd::Start { project, session, label } => {
            // Started here, by this machine: its own order.
            let board = sign_in(true)?;
            let p = board.project(&project)?;
            let s = board.session(&p, &session)?;
            if s.machine_id != board.session.user.id.to_string() {
                bail!("{} runs on {}: start the run there", s.name, s.machine);
            }
            board.start_run(&p, &s, label.as_deref())?;
            println!(
                "Started a run in {} on {}'s To do column{}. It works down it one task at a time until it's empty; `omicron runs pause '{}'` stops it after the current task.",
                s.name,
                p.name,
                label.map(|l| format!(" (label {l})")).unwrap_or_default(),
                p.name
            );
        }
        RunsCmd::List { project } => {
            let board = sign_in(as_machine)?;
            let p = board.project(&project)?;
            let runs = board.runs(&p)?;
            if runs.is_empty() {
                println!("No runs in {} yet.", p.name);
            }
            for r in runs {
                let session = r.session_id.as_deref().and_then(|id| board.session_by_id(id).ok()).map(|s| s.name).unwrap_or_else(|| "(ended)".into());
                println!("{}\t{}\t{} done\t{}\t{}", session, r.state, r.done, r.note.unwrap_or_default(), &r.started_at[..16.min(r.started_at.len())]);
            }
        }
        RunsCmd::Pause { project, session } => change(&project, session, "pausing", as_machine)?,
        RunsCmd::Stop { project, session } => change(&project, session, "stopped", as_machine)?,
    }
    Ok(())
}

/// Pause or stop a Project's active run (pausing and stopping are never
/// orders a computer has to be open to: they only make it do less).
fn change(project: &str, session: Option<String>, state: &str, as_machine: bool) -> Result<()> {
    let board = sign_in(as_machine)?;
    let p = board.project(project)?;
    let mut active: Vec<Run> = board.runs(&p)?.into_iter().filter(Run::active).collect();
    if let Some(name) = &session {
        let s = board.session(&p, name)?;
        active.retain(|r| r.session_id.as_deref() == Some(s.id.as_str()));
    }
    let run = match active.as_slice() {
        [] => bail!("{} has no run going", p.name),
        [one] => one.clone(),
        _ => bail!("{} has more than one run going: say which with --session", p.name),
    };
    let note = if state == "pausing" { "pausing: it stops after the task it's on" } else { "stopped" };
    board.set_run(&run.id, json!({ "state": state }))?;
    println!("{} the run in {}: {note}.", if state == "pausing" { "Paused" } else { "Stopped" }, p.name);
    Ok(())
}

/// The daemon's side: a change about a run or a task. Steps the runs it
/// touches on this machine, each in its own thread.
pub fn heard(supabase: &Supabase, key: &MachineKey, row: &Value) {
    let me = key.machine_id.to_string();
    let record = &row["record"];
    let ids: Vec<String> = match row["table_name"].as_str() {
        Some("runs") if record["machine_id"].as_str() == Some(me.as_str()) && matches!(record["state"].as_str(), Some("running" | "pausing")) => {
            vec![record["id"].as_str().unwrap_or("").to_string()]
        }
        // A team's job finished: runs here waiting on it carry on.
        Some("jobs") if row["kind"] == "UPDATE" && record["state"] == "done" && row["old_record"]["state"] != "done" => match signed_in(supabase, key).and_then(|b| b.my_active_runs()) {
            Ok(runs) => runs.into_iter().filter(|r| r.task_id.is_none()).map(|r| r.id).collect(),
            Err(e) => return eprintln!("omicron daemon: runs: {e:#}"),
        },
        Some("tasks") if row["kind"] == "UPDATE" && record["status_id"] != row["old_record"]["status_id"] => {
            // Only tasks a run here is on.
            let board = match signed_in(supabase, key) {
                Ok(b) => b,
                Err(e) => return eprintln!("omicron daemon: runs: {e:#}"),
            };
            match board.my_active_runs() {
                Ok(runs) => runs.into_iter().filter(|r| r.task_id.as_deref() == record["id"].as_str()).map(|r| r.id).collect(),
                Err(e) => return eprintln!("omicron daemon: runs: {e:#}"),
            }
        }
        _ => Vec::new(),
    };
    for id in ids {
        let (supabase, key) = (supabase.clone(), key.clone());
        std::thread::spawn(move || step_soon(&supabase, &key, &id));
    }
}

/// When the daemon starts: pick up the runs going here.
pub fn bring_back(supabase: &Supabase, key: &MachineKey) -> Result<()> {
    for r in signed_in(supabase, key)?.my_active_runs()? {
        let (supabase, key) = (supabase.clone(), key.clone());
        std::thread::spawn(move || step_soon(&supabase, &key, &r.id));
    }
    Ok(())
}

fn signed_in(supabase: &Supabase, key: &MachineKey) -> Result<Board> {
    Ok(Board { supabase: supabase.clone(), session: supabase.sign_in_machine(key)? })
}

/// Runs being stepped now, and ones to step again once that's done.
static BUSY: Mutex<Option<(HashSet<String>, HashSet<String>)>> = Mutex::new(None);

/// One step at a time per run: a change heard mid-step steps it again after.
fn step_soon(supabase: &Supabase, key: &MachineKey, id: &str) {
    {
        let mut busy = BUSY.lock().unwrap();
        let (now, again) = busy.get_or_insert_with(Default::default);
        if !now.insert(id.to_string()) {
            again.insert(id.to_string());
            return;
        }
    }
    loop {
        if let Err(e) = signed_in(supabase, key).and_then(|b| step(supabase, &b, id)) {
            eprintln!("omicron daemon: run: {e:#}");
            if let Ok(b) = signed_in(supabase, key) {
                let _ = b.set_run(id, json!({ "state": "stopped", "note": format!("stopped: {e:#}") }));
            }
        }
        let mut busy = BUSY.lock().unwrap();
        let (now, again) = busy.get_or_insert_with(Default::default);
        if !again.remove(id) {
            now.remove(id);
            return;
        }
    }
}

/// Still being worked on: in the first status (To do) or one named Doing.
fn in_progress(statuses: &[omicron::board::Status], status_id: &str) -> bool {
    let first = statuses.iter().min_by(|a, b| a.position.total_cmp(&b.position)).map(|s| s.id.as_str());
    statuses.iter().any(|s| s.id == status_id && (Some(s.id.as_str()) == first || s.name.eq_ignore_ascii_case("doing")) && !s.is_done)
}

/// Do the next thing a run needs, if anything.
fn step(supabase: &Supabase, board: &Board, id: &str) -> Result<()> {
    let Some(run) = board.run(id)? else { return Ok(()) };
    if !run.active() {
        return Ok(());
    }
    let stop = |note: String| board.set_run(id, json!({ "state": "stopped", "note": note }));
    let Some(session) = run.session_id.as_deref().and_then(|s| board.session_by_id(s).ok()) else {
        return stop("stopped: its session ended".into());
    };
    if let Some(why) = omicron::gate::refusal(board, &session.machine, Some(&run.started_by))? {
        return stop(format!("stopped: {why}"));
    }
    if !omicron::host::is_running(&session.name) {
        return stop(format!("stopped: {} isn't running (`omicron open {}`)", session.name, session.name));
    }
    let project = board.projects()?.into_iter().find(|p| p.id == run.project_id).context("the run's Project is gone")?;
    let statuses = board.statuses(&project)?;

    // On a task: still at it, or finished with it.
    if let Some(task_id) = &run.task_id {
        let task = board.task_row(task_id)?;
        let mine = task.as_ref().is_some_and(|t| t["assignee_session_id"].as_str() == Some(session.id.as_str()));
        if let Some(t) = &task {
            if mine && in_progress(&statuses, t["status_id"].as_str().unwrap_or("")) {
                return Ok(());
            }
        }
        let number = task.as_ref().and_then(|t| t["number"].as_i64()).unwrap_or(0);
        let done = run.done + 1;
        if run.state == "pausing" {
            return board.set_run(id, json!({ "state": "stopped", "task_id": null, "done": done, "note": format!("paused after #{number}") }));
        }
        board.set_run(id, json!({ "task_id": null, "done": done, "note": format!("handing off after #{number}") }))?;
        if !omicron::handover::hand_off_and_clear(supabase, board, &session)? {
            return stop(format!("stopped: {} didn't write its handoff note after #{number}", session.name));
        }
        // Paused or stopped meanwhile?
        match board.run(id)? {
            Some(r) if r.state == "running" => {}
            Some(r) if r.state == "pausing" => return board.set_run(id, json!({ "state": "stopped", "note": format!("paused after #{number}") })),
            _ => return Ok(()),
        }
    }

    // A big task a team here finished: the session checks it, reports, and
    // moves it to Review, before anything new (#92).
    let team_tasks = board.team_tasks_here(&run.project_id)?;
    if let Some((t, job, _, team)) = team_tasks.iter().find(|(t, _, state, _)| {
        state == "done" && in_progress(&statuses, t["status_id"].as_str().unwrap_or("")) && t["assignee_session_id"].as_str() != Some(session.id.as_str())
    }) {
        let (task_id, number, title) = (t["id"].as_str().unwrap_or(""), t["number"].as_i64().unwrap_or(0), t["title"].as_str().unwrap_or(""));
        board.give_task(task_id, &session.id)?;
        board.set_run(id, json!({ "task_id": task_id, "note": format!("checking #{number}: {team} finished job #{job}") }))?;
        omicron::handover::wait_until_free(&session.id);
        omicron::host::say(
            &session.name,
            &format!(
                "Omicron run: the team {team} finished job #{job} for task #{number} \"{}\" in {}. Run `omicron tasks mine` to get the task with the Project's run rules, check the job's work (`omicron teams jobs {team}`, its branch is merged), then report on the task and move it to Review. Then stop; the run hands off and gives you the next one.",
                omicron::text::line(title),
                project.name
            ),
        )?;
        return Ok(());
    }

    // The next task: the top of To do (only the run's label, if it has one),
    // not given to anyone else, not already with a team. A task labelled
    // "team" goes to a team running here for this Project as a linked job,
    // and the run carries on with the next (#92).
    let first = statuses.iter().min_by(|a, b| a.position.total_cmp(&b.position)).context("the Project has no statuses")?;
    let team_label = board.labels(&project)?.into_iter().map(|(n, _)| n).find(|n| n.eq_ignore_ascii_case("team"));
    let team_label_id = match team_label {
        Some(n) => Some(board.label_id(&project, &n)?),
        None => None,
    };
    let me = board.session.user.id.to_string();
    let team = board.teams()?.into_iter().find(|t| t.machine_id == me && t.project_id == run.project_id && t.state == "running");
    let mut next = None;
    for t in board.task_rows_in(&run.project_id, &first.id)? {
        let free = t["assignee_person_id"].is_null() && (t["assignee_session_id"].is_null() || t["assignee_session_id"].as_str() == Some(session.id.as_str()));
        let labels: Vec<&str> = t["task_labels"].as_array().into_iter().flatten().filter_map(|x| x["label_id"].as_str()).collect();
        let labelled = run.label_id.as_deref().is_none_or(|l| labels.contains(&l));
        let with_a_team = t["task_jobs"].as_array().is_some_and(|j| !j.is_empty());
        if !free || !labelled || with_a_team {
            continue;
        }
        if let (Some(team), Some(l)) = (&team, &team_label_id) {
            if labels.contains(&l.as_str()) {
                let (number, title) = (t["number"].as_i64().unwrap_or(0), t["title"].as_str().unwrap_or(""));
                let task = board.task(&project, number)?;
                let job = board.add_job(team, title, &format!("Task #{number} in {}.\n\n{}", project.name, task.notes))?;
                board.link_job(&task, team, job.number)?;
                board.set_run(id, json!({ "note": format!("gave #{number} to the team {} as job #{}", team.name, job.number) }))?;
                continue;
            }
        }
        next = Some(t);
        break;
    }
    let Some(next) = next else {
        let waiting: Vec<String> = team_tasks
            .iter()
            .filter(|(t, _, state, _)| !matches!(state.as_str(), "done" | "cancelled") && in_progress(&statuses, t["status_id"].as_str().unwrap_or("")))
            .map(|(t, job, _, team)| format!("#{} ({team} job #{job})", t["number"].as_i64().unwrap_or(0)))
            .collect();
        if !waiting.is_empty() {
            // Comes back when a job finishes (the daemon steps runs then).
            return board.set_run(id, json!({ "note": format!("waiting for the team: {}", waiting.join(", ")) }));
        }
        let done = board.run(id)?.map(|r| r.done).unwrap_or(run.done);
        return board.set_run(id, json!({ "state": "finished", "note": format!("finished: {} is empty ({done} done)", first.name) }));
    };
    let (task_id, number, title) = (next["id"].as_str().unwrap_or(""), next["number"].as_i64().unwrap_or(0), next["title"].as_str().unwrap_or(""));
    board.give_task(task_id, &session.id)?;
    board.set_run(id, json!({ "task_id": task_id, "note": format!("on #{number}: {}", omicron::text::line(title)) }))?;
    omicron::handover::wait_until_free(&session.id);
    omicron::host::say(
        &session.name,
        &format!(
            "Omicron run: your next task is #{number} \"{}\" in {}. Run `omicron tasks mine` to get it with the Project's run rules, and work on it as they say: move it to Doing, do it, report on it, and move it to Review. Then stop; the run hands off and gives you the next one.",
            omicron::text::line(title),
            project.name
        ),
    )?;
    Ok(())
}
