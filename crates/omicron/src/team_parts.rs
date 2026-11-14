//! A team's git side: each job in its own worktree on a `job/<n>-<name>`
//! branch, and parts of a job worked side by side.

use anyhow::{bail, Context, Result};
use omicron::board::{Job, TeamRow};
use std::path::{Path, PathBuf};
use std::process::Command;
use crate::teams_run::*;

pub fn branch(job: &Job) -> String {
    format!("job/{}-{}", job.number, slug(&job.title))
}

pub(crate) fn is_git(folder: &Path) -> bool {
    Command::new("git").arg("-C").arg(folder).args(["rev-parse", "--is-inside-work-tree"]).output().is_ok_and(|o| o.status.success())
}

pub(crate) fn git(folder: &Path, args: &[&str]) -> Result<String> {
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

pub(crate) fn part_folder(team: &TeamRow, job: i64, part: i64) -> Result<PathBuf> {
    Ok(team_home(team)?.join(format!("job-{job}-part-{part}")))
}

pub(crate) fn part_branch(job: &Job, part: i64) -> String {
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
