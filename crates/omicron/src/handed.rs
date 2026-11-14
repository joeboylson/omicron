//! What a session is told about the tasks given to it (`omicron tasks
//! mine`), with the Project's run rules and how to report.

use crate::board_cmd::sign_in;
use anyhow::{Context, Result};
use omicron::windows::{this_window, Windows};

/// What a session is told about the tasks given to it. `new` marks the ones
/// it hadn't been given before.
pub fn tasks_message(tasks: &[(String, omicron::board::Task)], new: &[String]) -> String {
    let mut text = format!(
        "Omicron: {} given to this session.\n",
        if tasks.len() == 1 { "1 task is".to_string() } else { format!("{} tasks are", tasks.len()) }
    );
    for (project, t) in tasks {
        let mark = if new.contains(&t.id) { " (new)" } else { "" };
        text.push_str(&format!("\n#{} in {project}: {}{mark}\n", t.number, t.title));
        if !t.notes.is_empty() {
            text.push_str(&format!("{}\n", t.notes));
        }
        text.push_str(&format!(
            "Full task: `omicron tasks show '{project}' {n} --as-machine`. When it's done, report on it and mark it for review: `omicron tasks comment '{project}' {n} \"<what you did>\" --review --as-machine`.\n",
            n = t.number
        ));
    }
    text.push_str(REPORT_RULES);
    text
}

/// A Project's run rules, said with its tasks: how to work on them, beside
/// the folder's CLAUDE.md.
pub fn rules_message(project: &str, rules: &str) -> String {
    if rules.trim().is_empty() {
        return format!("\n{project} has no run rules; follow this folder's CLAUDE.md.\n");
    }
    format!("\nRun rules for {project} (how to work on its tasks; this folder's CLAUDE.md applies too):\n{}\n", rules.trim())
}

/// How a session writes its report, said with every task handed over.
pub const REPORT_RULES: &str = "\nHow to write the report: short and plain, like a /s answer. No jargon and no made-up terms; say what changed and what's left in everyday words. At most 500 words (longer reports are refused).\n";

/// The most words a report (a comment marked for review) may have.
pub const REPORT_WORDS: usize = 500;

/// `omicron tasks mine`: "go get your tasks". Everything given to the
/// session this runs in that isn't done, marking the new ones picked up.
pub fn tasks_mine() -> Result<()> {
    let windows = Windows::load()?;
    let session_id = this_window(&windows)?
        .and_then(|pid| windows.windows.get(&pid))
        .and_then(|w| w.session_id.clone())
        .context("run this inside a Claude session Omicron tracks (opened with `omicron open`)")?;
    let board = sign_in(true)?;
    // Only tasks given on this computer are handed over, or, while the gate
    // is open, ones from this machine's owner; the rest are only to read
    // (ref/BRAINSTORM.md, "The gate"). The database applies the same rule
    // when it marks them picked up, told only whether the gate is open.
    let orders = omicron::gate::Orders::new(&board);
    let new: Vec<String> = board.pick_up_tasks(&session_id, orders.gate_open())?.into_iter().map(|(_, t)| t.id).collect();
    let mut tasks = Vec::new();
    let mut to_read = Vec::new();
    for (s, t) in board.session_tasks(&session_id)? {
        if orders.takes(t.given_by.as_deref())? { tasks.push((s, t)) } else { to_read.push((s, t)) }
    }
    if tasks.is_empty() && to_read.is_empty() {
        println!("Nothing is given to this session right now.");
        return Ok(());
    }
    if !tasks.is_empty() {
        print!("{}", tasks_message(&tasks, &new));
        // Each Project's run rules, once.
        let mut seen: Vec<&str> = Vec::new();
        for (project, _) in &tasks {
            if seen.contains(&project.as_str()) {
                continue;
            }
            seen.push(project);
            let rules = board.run_rules(&board.project(project)?)?;
            print!("{}", rules_message(project, &rules));
        }
    }
    if !to_read.is_empty() {
        if !tasks.is_empty() {
            println!();
        }
        print!("{}", to_read_message(&to_read));
    }
    Ok(())
}

/// Tasks given to a session from elsewhere that it may not work on (not
/// from its machine's owner, or the gate is closed): titles only, to read.
pub fn to_read_message(tasks: &[(String, omicron::board::Task)]) -> String {
    let it = if tasks.len() == 1 { "it" } else { "them" };
    let mut text = format!(
        "Given to this session from elsewhere, only to read: don't work on {it}. This computer takes work from elsewhere only from its owner, while its remote control is on. Hand {it} over on this computer (`omicron tasks send`), or have its owner give {it} with the gate open (`omicron gate open --until 17:00`).\n"
    );
    for (project, t) in tasks {
        text.push_str(&format!("#{} in {project}: {}\n", t.number, t.title));
    }
    text
}
