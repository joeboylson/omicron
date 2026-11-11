//! `omicron teams view [team]`: look through a team's folder without leaving
//! the terminal. Only what matters is listed: the team's setup (roles and
//! workflows) and, for each open job, the files it changed. Enter shows a
//! file (a changed one as its diff), Esc goes back.

use crate::picker::{choose, page, Row};
use crate::teams_cmd::SETUP;
use anyhow::{bail, Context, Result};
use omicron::board::{Job, TeamRow};
use std::path::{Path, PathBuf};
use std::process::Command;

/// One file the viewer lists.
#[derive(Debug, Clone, PartialEq)]
pub struct Item {
    /// Shown, like "roles/builder.md" or "src/login.rs".
    pub label: String,
    /// "setup", or the job, like "job #3".
    pub group: String,
    /// "", or how a job changed it: "changed", "new", "deleted".
    pub change: String,
    pub path: PathBuf,
    /// For a changed file: the folder and the commit to diff against.
    pub diff_from: Option<(PathBuf, String)>,
}

fn git(folder: &Path, args: &[&str]) -> Option<String> {
    let o = Command::new("git").arg("-C").arg(folder).args(args).output().ok()?;
    o.status.success().then(|| String::from_utf8_lossy(&o.stdout).into_owned())
}

/// The setup files, sorted.
pub fn setup_items(folder: &Path) -> Vec<Item> {
    let dir = folder.join(SETUP);
    let mut found = Vec::new();
    let mut stack = vec![dir.clone()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else {
                found.push(p);
            }
        }
    }
    found.sort();
    found
        .into_iter()
        .map(|p| Item {
            label: p.strip_prefix(&dir).unwrap_or(&p).display().to_string(),
            group: "setup".into(),
            change: String::new(),
            path: p,
            diff_from: None,
        })
        .collect()
}

/// What a job's worktree changed since it left `base` (the team folder's
/// own commit), committed or not.
pub fn job_items(job_number: i64, worktree: &Path, base: &str) -> Vec<Item> {
    let Some(from) = git(worktree, &["merge-base", "HEAD", base]).map(|s| s.trim().to_string()) else { return Vec::new() };
    let group = format!("job #{job_number}");
    let mut items = Vec::new();
    for line in git(worktree, &["diff", "--name-status", "--no-renames", &from]).unwrap_or_default().lines() {
        let Some((kind, file)) = line.split_once('\t') else { continue };
        let change = match kind {
            "A" => "new",
            "D" => "deleted",
            _ => "changed",
        };
        items.push(Item {
            label: file.into(),
            group: group.clone(),
            change: change.into(),
            path: worktree.join(file),
            diff_from: (change != "new").then(|| (worktree.to_path_buf(), from.clone())),
        });
    }
    for file in git(worktree, &["ls-files", "--others", "--exclude-standard"]).unwrap_or_default().lines() {
        items.push(Item { label: file.into(), group: group.clone(), change: "new".into(), path: worktree.join(file), diff_from: None });
    }
    items.sort_by(|a, b| a.label.cmp(&b.label));
    items
}

/// What Enter shows: a changed file's diff, or the file itself.
pub fn contents(item: &Item) -> String {
    if let Some((folder, from)) = &item.diff_from {
        let file = item.path.strip_prefix(folder).unwrap_or(&item.path).display().to_string();
        return git(folder, &["diff", from, "--", &file]).unwrap_or_default();
    }
    match std::fs::read(&item.path) {
        Ok(bytes) if bytes.contains(&0) => "(not text)".into(),
        Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
        Err(e) => format!("(can't read it: {e})"),
    }
}

fn items(team: &TeamRow, jobs: &[Job]) -> Vec<Item> {
    let folder = PathBuf::from(&team.folder);
    let mut all = setup_items(&folder);
    let Some(base) = git(&folder, &["rev-parse", "HEAD"]).map(|s| s.trim().to_string()) else { return all };
    for job in jobs.iter().filter(|j| !matches!(j.state.as_str(), "done" | "cancelled")) {
        // Only worktrees already made: looking shouldn't create one.
        let Ok(wt) = crate::teams_run::worktree(team, job.number) else { break };
        if wt.exists() {
            all.extend(job_items(job.number, &wt, &base));
        }
    }
    all
}

pub fn view(team: Option<String>) -> Result<()> {
    let board = crate::board_cmd::sign_in(true)?;
    let me = omicron::config::Config::load()?.machine_key()?.machine_id.to_string();
    let here: Vec<TeamRow> = board.teams()?.into_iter().filter(|t| t.machine_id == me).collect();
    let t = match team {
        Some(name) => here.into_iter().find(|t| t.name.eq_ignore_ascii_case(&name)).with_context(|| format!("no team called {name} on this machine"))?,
        None => {
            let cwd = std::env::current_dir()?;
            match here.iter().find(|t| cwd.starts_with(&t.folder)) {
                Some(t) => t.clone(),
                None if here.len() == 1 => here.into_iter().next().unwrap(),
                None if here.is_empty() => bail!("no teams on this machine. Start one with `omicron teams start`."),
                None => bail!("say which team: {}", here.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join(", ")),
            }
        }
    };
    let list = items(&t, &board.jobs(&t)?);
    let rows: Vec<Row> = list
        .iter()
        .map(|i| Row { name: i.label.clone(), status: i.group.clone(), group: i.change.clone(), detail: String::new() })
        .collect();
    if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        for i in &list {
            println!("{}\t{}\t{}\t{}", i.group, i.change, i.label, i.path.display());
        }
        return Ok(());
    }
    let title = format!("{} · {}", t.name, t.folder);
    while let Some(at) = choose(&title, &rows)? {
        let i = &list[at];
        page(&format!("{} · {}", i.group, i.label), &contents(i))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(dir: &Path, args: &[&str]) {
        let ok = Command::new("git").arg("-C").arg(dir).args(args).env("GIT_AUTHOR_NAME", "t").env("GIT_AUTHOR_EMAIL", "t@t").env("GIT_COMMITTER_NAME", "t").env("GIT_COMMITTER_EMAIL", "t@t").status().unwrap();
        assert!(ok.success(), "git {args:?}");
    }

    #[test]
    fn lists_the_setup_and_what_a_job_changed() {
        let root = std::env::temp_dir().join(format!("omicron-view-{}", uuid::Uuid::new_v4().simple()));
        let folder = root.join("web");
        std::fs::create_dir_all(folder.join(".omicron-team/roles")).unwrap();
        std::fs::write(folder.join(".omicron-team/team.json"), "{}").unwrap();
        std::fs::write(folder.join(".omicron-team/roles/builder.md"), "Build it.").unwrap();
        std::fs::write(folder.join("keep.txt"), "one\n").unwrap();
        std::fs::write(folder.join("gone.txt"), "bye\n").unwrap();
        run(&folder, &["init", "-q", "-b", "main"]);
        run(&folder, &["add", "-A"]);
        run(&folder, &["commit", "-qm", "start"]);
        let base = git(&folder, &["rev-parse", "HEAD"]).unwrap().trim().to_string();
        let wt = root.join("job-3");
        run(&folder, &["worktree", "add", "-q", "-b", "job/3-x", wt.to_str().unwrap()]);
        // One change committed, one not, one deleted, one new and untracked.
        std::fs::write(wt.join("keep.txt"), "one\ntwo\n").unwrap();
        run(&wt, &["commit", "-qam", "more"]);
        std::fs::remove_file(wt.join("gone.txt")).unwrap();
        std::fs::write(wt.join("login.rs"), "fn main() {}\n").unwrap();
        // The team folder moving on doesn't count as the job's change.
        std::fs::write(folder.join("other.txt"), "x").unwrap();
        run(&folder, &["add", "-A"]);
        run(&folder, &["commit", "-qm", "main moved"]);

        let setup: Vec<String> = setup_items(&folder).into_iter().map(|i| i.label).collect();
        assert_eq!(setup, ["roles/builder.md", "team.json"]);
        let new_base = git(&folder, &["rev-parse", "HEAD"]).unwrap().trim().to_string();
        assert_ne!(base, new_base);
        let job = job_items(3, &wt, &new_base);
        let seen: Vec<(&str, &str)> = job.iter().map(|i| (i.label.as_str(), i.change.as_str())).collect();
        assert_eq!(seen, [("gone.txt", "deleted"), ("keep.txt", "changed"), ("login.rs", "new")]);
        assert!(job.iter().all(|i| i.group == "job #3"));
        assert!(contents(&job[1]).contains("+two"), "{}", contents(&job[1]));
        assert_eq!(contents(&job[2]), "fn main() {}\n");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
