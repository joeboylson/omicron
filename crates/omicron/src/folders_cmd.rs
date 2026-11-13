//! `omicron folders`: the folders on this machine where a Project's Claude
//! sessions start. Added only here, on the computer the folder is on
//! (ref/BRAINSTORM.md, "Two parts"); seen from anywhere.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use clap::Subcommand;
use omicron::board::{Board, Folder, Project};
use std::path::{Path, PathBuf};

#[derive(Subcommand)]
pub enum FoldersCmd {
    /// Add a folder on this machine for a Project (this folder if left out).
    /// Sessions opened in it are that Project's.
    Add {
        /// The folder (this one if left out)
        path: Option<PathBuf>,
        /// Its Project (not needed when this machine is in only one)
        #[arg(long)]
        project: Option<String>,
    },
    /// List folders: one Project's, or all you can see
    List {
        #[arg(long)]
        project: Option<String>,
    },
    /// Take a folder on this machine off the list (this one if left out).
    /// Nothing in it changes.
    Remove { path: Option<PathBuf> },
}

pub fn folders(cmd: FoldersCmd, as_machine: bool) -> Result<()> {
    match cmd {
        FoldersCmd::Add { path, project } => {
            let board = sign_in(true)?;
            let path = full_path(path)?;
            let project = match project {
                Some(p) => board.project(&p)?,
                None => only_project(&board)?,
            };
            let f = remember(&board, &project, &path)?;
            println!(
                "Added {} for {}: sessions opened there are {}'s, and a Claude started there links itself.",
                f.path, f.project, f.project
            );
            Ok(())
        }
        FoldersCmd::List { project } => {
            let board = sign_in(as_machine)?;
            let project = project.map(|p| board.project(&p)).transpose()?;
            let all = board.folders(project.as_ref())?;
            if all.is_empty() {
                println!("No folders yet. Add one on its computer with `omicron folders add` in it.");
            }
            for f in all {
                println!("{}  {}  {}", f.machine, f.path, f.project);
            }
            Ok(())
        }
        FoldersCmd::Remove { path } => {
            let board = sign_in(true)?;
            let path = full_path(path)?;
            let Some(f) = here(&board, &path)? else { bail!("{} isn't one of this machine's folders", path.display()) };
            board.remove_folder(&f)?;
            crate::sessions_cmd::remove_hooks(&local_settings(&path))?;
            sync(&board)?;
            println!("Took {} off {}'s folders. Only Omicron's hooks there were taken out.", f.path, f.project);
            Ok(())
        }
    }
}

/// Add (or move) a folder here for a Project, so a Claude started in it
/// links itself: Omicron's hooks go in the folder's own
/// `.claude/settings.local.json` (the same ones `omicron open` gives Claude,
/// so a session it opens there runs them once). Claude Code's settings
/// elsewhere are left alone.
pub fn remember(board: &Board, project: &Project, path: &Path) -> Result<Folder> {
    let f = board.add_folder(project, &path.to_string_lossy())?;
    let exe = std::env::current_exe()?.canonicalize()?;
    crate::sessions_cmd::add_hooks(&local_settings(path), &exe.to_string_lossy())?;
    keep_out_of_git(path);
    sync(board)?;
    Ok(f)
}

/// Where a folder's own Claude Code settings are, just for this computer.
fn local_settings(folder: &Path) -> PathBuf {
    folder.join(".claude/settings.local.json")
}

/// In a git folder, keep the local settings out of git, for this copy only
/// (`.git/info/exclude`, not the shared `.gitignore`).
fn keep_out_of_git(folder: &Path) {
    let git = |args: &[&str]| std::process::Command::new("git").arg("-C").arg(folder).args(args).output().ok();
    let Some(o) = git(&["rev-parse", "--git-path", "info/exclude"]) else { return };
    if !o.status.success() {
        return;
    }
    if git(&["check-ignore", "-q", ".claude/settings.local.json"]).is_some_and(|o| o.status.success()) {
        return;
    }
    let exclude = folder.join(String::from_utf8_lossy(&o.stdout).trim());
    let mut text = std::fs::read_to_string(&exclude).unwrap_or_default();
    if !text.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str("# Omicron's hooks for this computer (omicron folders add)\n.claude/settings.local.json\n");
    if let Some(dir) = exclude.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(exclude, text);
}

/// Write this machine's folders to this computer, for the start hook.
pub fn sync(board: &Board) -> Result<()> {
    let me = board.session.user.id.to_string();
    let mine = board.folders(None)?.into_iter().filter(|f| f.machine_id == me).map(|f| (f.path, f.project)).collect();
    omicron::known_folders::save(&mine)
}

/// A folder as its full path, which must exist.
fn full_path(path: Option<PathBuf>) -> Result<PathBuf> {
    match path {
        Some(p) => p.canonicalize().with_context(|| format!("there's no folder {}", p.display())),
        None => Ok(std::env::current_dir()?),
    }
}

/// The one Project this machine is in, or say which to pick.
pub fn only_project(board: &Board) -> Result<Project> {
    match board.projects()?.as_slice() {
        [one] => Ok(one.clone()),
        [] => bail!("this machine isn't in any Project yet. Add it with `omicron machines add <machine> <Project>`."),
        all => bail!("say which Project with --project ({})", all.iter().map(|p| p.name.as_str()).collect::<Vec<_>>().join(", ")),
    }
}

/// This machine's folder at a path, if it's one.
pub fn here(board: &Board, path: &Path) -> Result<Option<Folder>> {
    let me = board.session.user.id.to_string();
    let path = path.to_string_lossy();
    Ok(board.folders(None)?.into_iter().find(|f| f.machine_id == me && f.path == path))
}
