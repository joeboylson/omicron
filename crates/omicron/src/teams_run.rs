//! Running a team on this machine: the lead and workers are Claude sessions
//! in Omicron's session host (`<team>.lead`, `<team>.builder-2`), each told
//! its team and name in its environment. Each job works in its own git
//! worktree on a `job/<number>-<name>` branch; the lead finishes a job by
//! merging that branch.

use anyhow::{bail, Context, Result};
use omicron::board::{Board, Job, TeamRow};
use std::time::Duration;
// The rest of teams, by subject; reached through here too.
pub use crate::team_daemon::*;
pub use crate::team_launch::*;
pub use crate::team_member::*;
pub use crate::team_parts::*;

pub const TEAM_ENV: &str = "OMICRON_TEAM";
pub const WORKER_ENV: &str = "OMICRON_WORKER";
/// The part of its job a worker is on, if it's on one.
pub const PART_ENV: &str = "OMICRON_PART";
/// The team's folder, so the Stop hook can read its setup without signing in.
pub const FOLDER_ENV: &str = "OMICRON_TEAM_FOLDER";
/// The advisor hears how things are going at most this often.
pub(crate) const NUDGE_EVERY: Duration = Duration::from_secs(10 * 60);

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

pub(crate) fn slug(title: &str) -> String {
    let s: String = title.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    s.split('-').filter(|p| !p.is_empty()).take(5).collect::<Vec<_>>().join("-")
}

pub(crate) fn env(team: &TeamRow, worker: &str) -> Vec<(String, String)> {
    vec![
        (TEAM_ENV.into(), team.id.clone()),
        (WORKER_ENV.into(), worker.into()),
        (FOLDER_ENV.into(), team.folder.clone()),
        ("OMICRON_AS".into(), "machine".into()),
    ]
}

/// Who's calling: the team and worker in this session's environment.
pub fn caller() -> Result<(Board, TeamRow, String)> {
    let team_id = std::env::var(TEAM_ENV).ok().context("run this in a team's session (it sets OMICRON_TEAM)")?;
    let worker = std::env::var(WORKER_ENV).ok().context("run this in a team's session (it sets OMICRON_WORKER)")?;
    let board = crate::board_cmd::sign_in(true)?;
    let team = board.team_by_id(&team_id)?;
    Ok((board, team, worker))
}

pub(crate) fn lead_only(worker: &str, what: &str) -> Result<()> {
    if worker != "lead" {
        bail!("only the lead can {what}");
    }
    Ok(())
}

/// The job a worker is on.
pub(crate) fn my_job(board: &Board, team: &TeamRow, me: &str) -> Result<Job> {
    let workers = board.workers(team)?;
    let job_id = workers.iter().find(|w| w.name == me).and_then(|w| w.job_id.clone()).context("you're not on a job")?;
    board.jobs(team)?.into_iter().find(|j| j.id == job_id).context("your job is gone")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::process::Command;

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
