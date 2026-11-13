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
            let f = board.add_folder(&project, &path.to_string_lossy())?;
            println!("Added {} for {}: sessions opened there are {}'s.", f.path, f.project, f.project);
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
            println!("Took {} off {}'s folders. Nothing in it changed.", f.path, f.project);
            Ok(())
        }
    }
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
