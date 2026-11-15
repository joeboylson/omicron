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
use serde_json::Value;
use omicron::board::{in_progress, TaskRow, TeamTask};
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
        /// These tasks, by number, in this order (like 4,7,2), instead of the top status
        #[arg(long, value_delimiter = ',')]
        tasks: Vec<i64>,
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
        RunsCmd::Start { project, session, label, tasks } => {
            // Started here, by this machine: its own order.
            let board = sign_in(true)?;
            let p = board.project(&project)?;
            let s = board.session(&p, &session)?;
            if s.machine_id != board.me() {
                bail!("{} runs on {}: start the run there", s.name, s.machine);
            }
            // Chosen tasks (#253): their ids, in the order given.
            let task_ids = if tasks.is_empty() {
                None
            } else {
                let mut ids = Vec::new();
                for n in &tasks {
                    ids.push(board.task(&p, *n)?.id);
                }
                Some(ids)
            };
            let chosen = task_ids.as_ref().map(|ids| ids.len());
            board.start_run_with(&p, &s, label.as_deref(), task_ids)?;
            if let Some(n) = chosen {
                println!(
                    "Started a run in {} on {} chosen {} of {}. It works down them one at a time; `omicron runs pause '{}'` stops it after the current task.",
                    s.name,
                    n,
                    if n == 1 { "task" } else { "tasks" },
                    p.name,
                    p.name
                );
                return Ok(());
            }
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
    board.ask_run_to(&run.id, state)?;
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
    Board::as_machine(supabase, key)
}

/// Runs being stepped now, and ones to step again once that's done.
static BUSY: Mutex<Option<(HashSet<String>, HashSet<String>)>> = Mutex::new(None);

/// Runs handing off now (asking for the note, then clearing): their steps
/// wait until it's done, and the hand-off steps them again after.
static HANDING_OFF: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn handing_off(id: &str) -> bool {
    HANDING_OFF.lock().unwrap().get_or_insert_with(Default::default).contains(id)
}

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
        if let Err(e) = signed_in(supabase, key).and_then(|b| step(supabase, key, &b, id)) {
            eprintln!("omicron daemon: run: {e:#}");
            if let Ok(b) = signed_in(supabase, key) {
                let _ = b.stop_run(id, &format!("stopped: {e:#}"));
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

/// What a run does next.
#[derive(Debug, PartialEq)]
enum Action<'a> {
    /// Nothing now: its task is still being worked on, or it's handing off.
    Wait,
    /// It stops, saying why.
    Stop(String),
    /// Its task is finished and it was asked to pause: it stops there.
    PauseDone { number: i64 },
    /// Its task is finished: hand off (note, then clear), then go on.
    HandOff { number: i64 },
    /// A team here finished a big task's job: the session checks it.
    CheckTeamTask(&'a TeamTask),
    /// The next task, after giving `to_team` to the team on the way.
    Start { to_team: Vec<&'a TaskRow>, task: &'a TaskRow },
    /// Nothing to start, but team jobs are still going: wait for them.
    WaitForTeam { to_team: Vec<&'a TaskRow>, note: String },
    /// To do is empty and nothing's waiting: it's finished.
    Finish { to_team: Vec<&'a TaskRow> },
}

/// What a step looks at, loaded.
struct Seen<'a> {
    run: &'a omicron::board::Run,
    /// Why it can't go on at all (its session ended, the gate, not running).
    blocked: Option<String>,
    handing_off: bool,
    session_id: &'a str,
    statuses: &'a [omicron::board::Status],
    /// The task it's on (when it's on one), if it's still there.
    current: Option<&'a TaskRow>,
    team_tasks: &'a [TeamTask],
    /// To do's tasks, in order.
    to_do: &'a [TaskRow],
    /// The team label's id, when a team runs here for the Project.
    team_label: Option<&'a str>,
}

/// The run's next move, decided from what was seen; nothing is read or written.
fn next_action<'a>(seen: &Seen<'a>) -> Action<'a> {
    let run = seen.run;
    if !run.active() || seen.handing_off {
        return Action::Wait;
    }
    if let Some(why) = &seen.blocked {
        return Action::Stop(why.clone());
    }
    if run.task_id.is_some() {
        let t = seen.current;
        if t.is_some_and(|t| t.assignee_session_id.as_deref() == Some(seen.session_id) && in_progress(seen.statuses, &t.status_id)) {
            return Action::Wait;
        }
        let number = t.map(|t| t.number).unwrap_or(0);
        return if run.state == "pausing" { Action::PauseDone { number } } else { Action::HandOff { number } };
    }
    // A big task a team here finished: the session checks it, reports, and
    // moves it to Review, before anything new (#92).
    if let Some(tt) = seen.team_tasks.iter().find(|tt| {
        tt.job_state == "done" && in_progress(seen.statuses, &tt.task.status_id) && tt.task.assignee_session_id.as_deref() != Some(seen.session_id)
    }) {
        return Action::CheckTeamTask(tt);
    }
    let (to_team, next) = choose(seen.to_do, seen.session_id, run.label_id.as_deref(), seen.team_label);
    if let Some(task) = next {
        return Action::Start { to_team, task };
    }
    let waiting: Vec<String> = seen
        .team_tasks
        .iter()
        .filter(|tt| !matches!(tt.job_state.as_str(), "done" | "cancelled") && in_progress(seen.statuses, &tt.task.status_id))
        .map(|tt| format!("#{} ({} job #{})", tt.task.number, tt.team, tt.job_number))
        .chain(to_team.iter().map(|t| format!("#{} (just given to the team)", t.number)))
        .collect();
    if waiting.is_empty() {
        Action::Finish { to_team }
    } else {
        Action::WaitForTeam { to_team, note: format!("waiting for the team: {}", waiting.join(", ")) }
    }
}

/// A run's pick from the top status, in order: the tasks to give a team
/// here (labelled `team_label`) on the way, and the next one for the
/// session itself. Skipped: tasks given to anyone else, without the run's
/// label (when it has one), or already with a team.
fn choose<'a>(rows: &'a [TaskRow], session: &str, run_label: Option<&str>, team_label: Option<&str>) -> (Vec<&'a TaskRow>, Option<&'a TaskRow>) {
    let mut for_team = Vec::new();
    for t in rows {
        let free = t.assignee_person_id.is_none() && t.assignee_session_id.as_deref().is_none_or(|s| s == session);
        let labels = t.label_ids();
        if !free || !run_label.is_none_or(|l| labels.contains(&l)) || t.has_job() {
            continue;
        }
        if team_label.is_some_and(|l| labels.contains(&l)) {
            for_team.push(t);
            continue;
        }
        return (for_team, Some(t));
    }
    (for_team, None)
}

/// Do the next thing a run needs, if anything: read what it needs, decide
/// (`next_action`), and carry it out.
fn step(supabase: &Supabase, key: &MachineKey, board: &Board, id: &str) -> Result<()> {
    let Some(run) = board.run(id)? else { return Ok(()) };
    if !run.active() || handing_off(id) {
        return Ok(());
    }
    let session = run.session_id.as_deref().and_then(|s| board.session_by_id(s).ok());
    let blocked = match &session {
        None => Some("stopped: its session ended".to_string()),
        Some(s) => match omicron::gate::refusal(board, &s.machine, Some(&run.started_by))? {
            Some(why) => Some(format!("stopped: {why}")),
            None if !omicron::host::is_running(&s.name) => Some(format!("stopped: {} isn't running (`omicron open {}`)", s.name, s.name)),
            None => None,
        },
    };
    if blocked.is_some() || session.is_none() {
        let seen = Seen { run: &run, blocked, handing_off: false, session_id: "", statuses: &[], current: None, team_tasks: &[], to_do: &[], team_label: None };
        return match next_action(&seen) {
            Action::Stop(why) => board.stop_run(id, &why),
            _ => Ok(()),
        };
    }
    let session = session.expect("checked just above");
    let project = board.projects()?.into_iter().find(|p| p.id == run.project_id).context("the run's Project is gone")?;
    let statuses = board.statuses(&project)?;
    let current = match &run.task_id {
        Some(t) => board.task_row(t)?,
        None => None,
    };
    let first = omicron::board::to_do(&statuses).context("the Project has no status that isn't done")?;
    // Only what the decision needs: To do and teams only once it's off a task.
    let (team_tasks, to_do, team, team_label_id) = if run.task_id.is_some() {
        (Vec::new(), Vec::new(), None, None)
    } else {
        let me = board.me();
        let team = board.teams()?.into_iter().find(|t| t.machine_id == me && t.project_id == run.project_id && t.state == "running");
        let label = match board.labels(&project)?.into_iter().map(|(n, _)| n).find(|n| n.eq_ignore_ascii_case("team")) {
            Some(n) if team.is_some() => Some(board.label_id(&project, &n)?),
            _ => None,
        };
        // A run over chosen tasks (#253) works down those not done yet, in
        // its order; otherwise the top status, as before.
        let rows = match &run.task_ids {
            Some(ids) => board
                .task_rows_by_ids(&run.project_id, ids)?
                .into_iter()
                .filter(|t| statuses.iter().any(|s| s.id == t.status_id && !s.is_done))
                .collect(),
            None => board.task_rows_in(&run.project_id, &first.id)?,
        };
        (board.team_tasks_here(&run.project_id)?, rows, team, label)
    };
    let seen = Seen {
        run: &run,
        blocked: None,
        handing_off: false,
        session_id: &session.id,
        statuses: &statuses,
        current: current.as_ref(),
        team_tasks: &team_tasks,
        to_do: &to_do,
        team_label: team_label_id.as_deref(),
    };
    let give_to_team = |to_team: &[&TaskRow]| -> Result<()> {
        let Some(team) = &team else { return Ok(()) };
        for t in to_team {
            let task = board.task(&project, t.number)?;
            let job = board.add_job(team, &t.title, &format!("Task #{} in {}.\n\n{}", t.number, project.name, task.notes))?;
            board.link_job(&task, team, job.number)?;
            board.run_note(id, &format!("gave #{} to the team {} as job #{}", t.number, team.name, job.number))?;
        }
        Ok(())
    };
    match next_action(&seen) {
        Action::Wait => Ok(()),
        Action::Stop(why) => board.stop_run(id, &why),
        Action::PauseDone { number } => board.run_task_finished(id, run.done + 1, true, &format!("paused after #{number}")),
        Action::HandOff { number } => {
            board.run_task_finished(id, run.done + 1, false, &format!("handing off after #{number}"))?;
            hand_off(supabase, key, id, session, number);
            Ok(())
        }
        Action::CheckTeamTask(tt) => {
            let (team, job, number) = (&tt.team, tt.job_number, tt.task.number);
            board.give_anew(&tt.task.id, Some(&session.id))?;
            board.run_on(id, &tt.task.id, &format!("checking #{number}: {team} finished job #{job}"))?;
            omicron::handover::wait_until_free(&session.id);
            omicron::host::say(
                &session.name,
                &format!(
                    "Omicron run: the team {team} finished job #{job} for task #{number} \"{}\" in {}. Run `omicron tasks mine` to get the task with the Project's run rules, check the job's work (`omicron teams jobs {team}`, its branch is merged), then report on the task and move it to Review. Then stop; the run hands off and gives you the next one.",
                    omicron::text::line(&tt.task.title),
                    project.name
                ),
            )
        }
        Action::Start { to_team, task } => {
            give_to_team(&to_team)?;
            board.give_anew(&task.id, Some(&session.id))?;
            board.run_on(id, &task.id, &format!("on #{}: {}", task.number, omicron::text::line(&task.title)))?;
            omicron::handover::wait_until_free(&session.id);
            omicron::host::say(
                &session.name,
                &format!(
                    "Omicron run: your next task is #{} \"{}\" in {}. Run `omicron tasks mine` to get it with the Project's run rules, and work on it as they say: move it to Doing, do it, report on it, and move it to Review. Then stop; the run hands off and gives you the next one.",
                    task.number,
                    omicron::text::line(&task.title),
                    project.name
                ),
            )
        }
        // Comes back when a job finishes (the daemon steps runs then).
        Action::WaitForTeam { to_team, note } => {
            give_to_team(&to_team)?;
            board.run_note(id, &note)
        }
        Action::Finish { to_team } => {
            give_to_team(&to_team)?;
            let done = board.run(id)?.map(|r| r.done).unwrap_or(run.done);
            board.finish_run(id, &format!("finished: {} is empty ({done} done)", first.name))
        }
    }
}

/// Hand off on a thread of its own (asking for the note can take up to 20
/// minutes), then step the run again, unless it was paused or stopped
/// meanwhile. Its other steps wait until then.
fn hand_off(supabase: &Supabase, key: &MachineKey, id: &str, session: omicron::board::SessionRecord, number: i64) {
    HANDING_OFF.lock().unwrap().get_or_insert_with(Default::default).insert(id.to_string());
    let (supabase, key, id) = (supabase.clone(), key.clone(), id.to_string());
    std::thread::spawn(move || {
        let result = signed_in(&supabase, &key).and_then(|board| {
            let saved = omicron::handover::hand_off_and_clear(&supabase, &board, &session)?;
            if !saved {
                return board.stop_run(&id, &format!("stopped: {} didn't write its handoff note after #{number}", session.name));
            }
            match board.run(&id)? {
                Some(r) if r.state == "pausing" => board.stop_run(&id, &format!("paused after #{number}")),
                _ => Ok(()),
            }
        });
        HANDING_OFF.lock().unwrap().get_or_insert_with(Default::default).remove(&id);
        match result {
            Err(e) => {
                eprintln!("omicron daemon: run: {e:#}");
                if let Ok(b) = signed_in(&supabase, &key) {
                    let _ = b.stop_run(&id, &format!("stopped: {e:#}"));
                }
            }
            Ok(()) => step_soon(&supabase, &key, &id),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(n: i64, labels: &[&str], person: Option<&str>, session: Option<&str>, job: bool) -> TaskRow {
        serde_json::from_value(json!({
            "id": format!("t{n}"), "number": n, "title": format!("Task {n}"), "status_id": "todo",
            "assignee_person_id": person, "assignee_session_id": session,
            "task_labels": labels.iter().map(|l| json!({ "label_id": l })).collect::<Vec<_>>(),
            "task_jobs": if job { json!([{ "job_id": "j" }]) } else { json!([]) },
        }))
        .unwrap()
    }

    fn run(state: &str, task: Option<&str>) -> omicron::board::Run {
        serde_json::from_value(json!({
            "id": "r", "project_id": "p", "machine_id": "m", "session_id": "mine", "label_id": null, "state": state,
            "task_id": task, "done": 0, "note": null, "started_by": "m", "started_at": "now",
        }))
        .unwrap()
    }

    fn statuses() -> Vec<omicron::board::Status> {
        let st = |id: &str, position: f64, is_done: bool| omicron::board::Status { id: id.into(), name: id.into(), position, is_done, color: None };
        vec![st("todo", 0.0, false), st("Doing", 1.0, false), st("Review", 2.0, false), st("Done", 3.0, true)]
    }

    fn team_task(n: i64, status: &str, state: &str) -> TeamTask {
        let mut task = row(n, &["team"], None, None, true);
        task.status_id = status.into();
        TeamTask { task, job_number: 7, job_state: state.into(), team: "web".into() }
    }

    fn seen<'a>(run: &'a omicron::board::Run, st: &'a [omicron::board::Status], current: Option<&'a TaskRow>, team_tasks: &'a [TeamTask], to_do: &'a [TaskRow]) -> Seen<'a> {
        Seen { run, blocked: None, handing_off: false, session_id: "mine", statuses: st, current, team_tasks, to_do, team_label: Some("team") }
    }

    #[test]
    fn what_a_run_does_next() {
        let st = statuses();
        let mut on_it = row(1, &[], None, Some("mine"), false);
        // Not running, or handing off: nothing. Can't go on: it stops.
        let stopped = run("stopped", None);
        assert_eq!(next_action(&seen(&stopped, &st, None, &[], &[])), Action::Wait);
        let r = run("running", None);
        assert_eq!(next_action(&Seen { handing_off: true, ..seen(&r, &st, None, &[], &[]) }), Action::Wait);
        assert_eq!(next_action(&Seen { blocked: Some("stopped: its session ended".into()), ..seen(&r, &st, None, &[], &[]) }), Action::Stop("stopped: its session ended".into()));

        // On a task: still at it (To do or Doing, still its own) waits.
        let r = run("running", Some("t1"));
        assert_eq!(next_action(&seen(&r, &st, Some(&on_it), &[], &[])), Action::Wait);
        on_it.status_id = "Doing".into();
        assert_eq!(next_action(&seen(&r, &st, Some(&on_it), &[], &[])), Action::Wait);
        // In Review, given away, or gone: finished with it.
        on_it.status_id = "Review".into();
        assert_eq!(next_action(&seen(&r, &st, Some(&on_it), &[], &[])), Action::HandOff { number: 1 });
        let given_away = row(1, &[], Some("pat"), None, false);
        assert_eq!(next_action(&seen(&r, &st, Some(&given_away), &[], &[])), Action::HandOff { number: 1 });
        assert_eq!(next_action(&seen(&r, &st, None, &[], &[])), Action::HandOff { number: 0 });
        // Pausing: it stops there instead.
        let p = run("pausing", Some("t1"));
        assert_eq!(next_action(&seen(&p, &st, Some(&on_it), &[], &[])), Action::PauseDone { number: 1 });
    }

    #[test]
    fn what_a_run_picks_once_its_free() {
        let st = statuses();
        let r = run("running", None);
        let to_do = [row(2, &["team"], None, None, false), row(3, &[], None, None, false)];
        // A team task done: checked first, before anything new.
        let tts = [team_task(5, "todo", "done")];
        assert_eq!(next_action(&seen(&r, &st, None, &tts, &to_do)), Action::CheckTeamTask(&tts[0]));
        // Otherwise the next task, giving the team task on the way to the team.
        assert_eq!(next_action(&seen(&r, &st, None, &[], &to_do)), Action::Start { to_team: vec![&to_do[0]], task: &to_do[1] });
        // Only team tasks left: given, then wait for the team.
        match next_action(&seen(&r, &st, None, &[], &to_do[..1])) {
            Action::WaitForTeam { to_team, note } => assert_eq!((to_team.len(), note.as_str()), (1, "waiting for the team: #2 (just given to the team)")),
            other => panic!("{other:?}"),
        }
        // A team job still going, nothing else: wait.
        let going = [team_task(5, "todo", "working")];
        assert_eq!(next_action(&seen(&r, &st, None, &going, &[])), Action::WaitForTeam { to_team: vec![], note: "waiting for the team: #5 (web job #7)".into() });
        // Nothing at all (a team job done but its task already in Review): finished.
        let reviewed = [team_task(5, "Review", "done")];
        assert_eq!(next_action(&seen(&r, &st, None, &reviewed, &[])), Action::Finish { to_team: vec![] });
    }

    fn numbers(v: &[&TaskRow]) -> Vec<i64> {
        v.iter().map(|t| t.number).collect()
    }

    #[test]
    fn a_run_takes_the_first_task_free_for_it() {
        let rows = [
            row(1, &[], Some("pat"), None, false),      // a person's
            row(2, &[], None, Some("other"), false),    // another session's
            row(3, &[], None, None, true),              // with a team already
            row(4, &[], None, Some("mine"), false),     // its own
            row(5, &[], None, None, false),
        ];
        let (team, next) = choose(&rows, "mine", None, None);
        assert_eq!((numbers(&team), next.map(|t| t.number)), (vec![], Some(4)));
        // Nothing free: nothing.
        assert!(choose(&rows[..3], "mine", None, None).1.is_none());
    }

    #[test]
    fn a_run_with_a_label_takes_only_those_and_team_tasks_go_to_the_team() {
        let rows = [row(1, &["team", "web"], None, None, false), row(2, &["api"], None, None, false), row(3, &["web"], None, None, false), row(4, &["team"], None, None, false)];
        // Only "web" tasks; the team one on the way goes to the team.
        let (team, next) = choose(&rows, "s", Some("web"), Some("team"));
        assert_eq!((numbers(&team), next.map(|t| t.number)), (vec![1], Some(3)));
        // No team here: a "team" task is just a task.
        assert_eq!(choose(&rows, "s", None, None).1.map(|t| t.number), Some(1));
        // With a team and no run label: every team task is passed on, up to the first other one.
        let (team, next) = choose(&rows, "s", None, Some("team"));
        assert_eq!((numbers(&team), next.map(|t| t.number)), (vec![1], Some(2)));
    }
}
