//! The daemon's side of teams: what it does when it hears about a team, a
//! job or an answer, and what waited for the gate.

use crate::teams_cmd::read_setup;
use anyhow::Result;
use omicron::board::{Board, TeamRow};
use std::path::Path;
use crate::teams_run::*;

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
pub(crate) const WAITING: &str = "Waiting: it was added from elsewhere.";

/// Say on a job why this machine won't start it yet (once; a job's own
/// change isn't reacted to, so this can't go round).
pub(crate) fn note_waiting(b: &Board, orders: &omicron::gate::Orders, job: &str, now: Option<&str>, who: Option<&str>) -> Result<()> {
    let machine = b.machine(&b.me()).map(|m| m.name).unwrap_or_else(|_| "This computer".into());
    let Some(why) = orders.refusal(who, &machine)? else { return Ok(()) };
    let note = format!("{WAITING} {why}");
    if now != Some(note.as_str()) && !job.is_empty() {
        b.waiting_job_note(job, Some(&note))?;
    }
    Ok(())
}

/// Clear that note once the job is taken.
pub(crate) fn clear_waiting(b: &Board, job: &omicron::board::Job) -> Result<()> {
    if job.note.as_deref().is_some_and(|n| n.starts_with(WAITING)) {
        b.waiting_job_note(&job.id, None)?;
    }
    Ok(())
}

/// Pass an answer (a comment on the question's task) to the member who
/// asked, or its lead, and mark the question answered.
pub(crate) fn pass_answer(b: &Board, team: &TeamRow, req: &omicron::board::TeamRequest, comment: &serde_json::Value) -> Result<bool> {
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
