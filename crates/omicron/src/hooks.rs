//! The Claude Code hooks themselves: what a window starting, clearing,
//! ending or taking a turn means for its session's record.

use crate::board_cmd::sign_in;
use anyhow::{Context, Result};
use omicron::windows::{this_window, Window, Windows};
use serde_json::{json, Value};
use std::io::Read;
use clap::Subcommand;
use crate::sessions_open::link_in_folder;

#[derive(Subcommand)]
pub enum Hook {
    /// Claude Code's SessionStart hook
    SessionStart,
    /// Claude Code's SessionEnd hook
    SessionEnd,
    /// Claude Code's Stop hook: the turn ended
    Stop,
    /// Claude Code's UserPromptSubmit hook: a turn started
    Prompt,
}

/// Run a hook. A hook must never get in Claude's way, so problems are only
/// printed, and it always finishes cleanly.
pub fn hook(event: Hook) -> Result<()> {
    let mut input = String::new();
    let _ = std::io::stdin().read_to_string(&mut input);
    match run_hook(event, &input) {
        Ok(Some(out)) => println!("{out}"),
        Ok(None) => {}
        Err(e) => eprintln!("omicron: {e:#}"),
    }
    Ok(())
}

/// What a window starting or ending means, worked out from the hook's
/// input and the windows Omicron knows (which it updates), before anything
/// is said to Supabase.
#[derive(Debug, Default, PartialEq)]
struct WindowChange {
    /// Changes to sessions' records.
    updates: Vec<(String, Value)>,
    /// Sessions whose window closed: they end.
    ended: Vec<String>,
    /// A session whose waiting handoff note is cancelled (its window closed).
    cancel_handoff: Option<String>,
    /// A session whose waiting handoff note goes to its new conversation (/clear).
    handoff: Option<String>,
    /// What to tell a chat that just linked itself.
    linked: Option<String>,
    /// A session no longer busy (its window closed).
    free: Option<String>,
}

/// Work out a SessionStart or SessionEnd. `link` makes a session of a chat
/// that starts in one of this machine's folders: (its id, what to tell it).
fn plan_window_change(
    event: &Hook,
    input: &Value,
    claude_id: &str,
    pid: u32,
    windows: &mut Windows,
    link: impl FnOnce(&str, &str) -> Option<(String, String)>,
) -> WindowChange {
    let mut change = WindowChange::default();
    match event {
        Hook::SessionStart => {
            let folder = input["cwd"].as_str().unwrap_or("").to_string();
            // A /clear in a tracked window, or `claude --resume` of a
            // tracked conversation in a new one; or, failing those, a chat
            // starting in one of this machine's folders.
            let known = windows.windows.get(&pid).and_then(|w| w.session_id.clone()).or_else(|| windows.links.get(claude_id).cloned());
            let session_id = known.or_else(|| {
                link(claude_id, &folder).map(|(id, said)| {
                    change.linked = Some(said);
                    id
                })
            });
            if let Some(id) = &session_id {
                windows.links.insert(claude_id.to_string(), id.clone());
                change.updates.push((id.clone(), json!({ "claude_session_id": claude_id, "folder": folder, "state": "open" })));
                if input["source"] == "clear" {
                    change.handoff = Some(id.clone());
                }
            }
            windows.windows.insert(pid, Window { claude_session_id: claude_id.to_string(), folder, session_id, clearing: false });
        }
        Hook::SessionEnd => {
            if input["reason"] == "clear" {
                // The window stays; SessionStart follows with the new id.
                if let Some(w) = windows.windows.get_mut(&pid) {
                    w.clearing = true;
                }
            } else if let Some(id) = windows.windows.remove(&pid).and_then(|w| w.session_id) {
                change.free = Some(id.clone());
                change.cancel_handoff = Some(id.clone());
                change.ended.push(id);
            }
        }
        Hook::Stop | Hook::Prompt => {}
    }
    change
}

/// Returns what to print for Claude Code, if anything.
fn run_hook(event: Hook, input: &str) -> Result<Option<String>> {
    let input: Value = serde_json::from_str(input).context("the hook's input isn't JSON")?;
    let claude_id = input["session_id"].as_str().context("the hook's input has no session_id")?.to_string();
    if let Hook::Stop = event {
        // A team member whose conversation is getting full hands it over.
        if let Some(reason) = crate::teams_run::handover_reason(&input)? {
            return Ok(Some(json!({ "decision": "block", "reason": reason }).to_string()));
        }
    }
    let mut windows = Windows::load()?;
    // Stop and Prompt run every turn, in every window: they only read.
    let every_turn = matches!(event, Hook::Stop | Hook::Prompt);
    let gone = if every_turn { Vec::new() } else { windows.sweep() };
    let Some(pid) = this_window(&windows)? else {
        if !every_turn {
            windows.save()?;
        }
        return Ok(None);
    };
    if every_turn {
        if let (Some(id), Some(transcript)) = (windows.windows.get(&pid).and_then(|w| w.session_id.clone()), input["transcript_path"].as_str()) {
            // A /rename since last time renames the session here too.
            if let Err(e) = omicron::names::follow(|| sign_in(true), &id, &claude_id, std::path::Path::new(transcript)) {
                eprintln!("omicron: following /rename: {e:#}");
            }
        }
    }
    if let Hook::Prompt = event {
        // A turn started: busy until it ends (for loops).
        if let Some(id) = windows.windows.get(&pid).and_then(|w| w.session_id.clone()) {
            omicron::windows::set_busy(&id, true)?;
        }
        return Ok(None);
    }
    if let Hook::Stop = event {
        // The common case, each turn: nothing tracked, nothing to do.
        let Some(id) = windows.windows.get(&pid).and_then(|w| w.session_id.clone()) else {
            return Ok(None);
        };
        // The turn is over: free for a loop's next prompt. Tasks aren't
        // handed over here: a session only gets them when told (`omicron
        // tasks mine`) or by Dispatch.
        omicron::windows::set_busy(&id, false)?;
        return Ok(None);
    }
    let plan = plan_window_change(&event, &input, &claude_id, pid, &mut windows, |claude_id, folder| match link_in_folder(claude_id, folder) {
        Ok(linked) => linked,
        Err(e) => {
            eprintln!("omicron: couldn't link this chat: {e:#}");
            None
        }
    });
    if let Some(id) = &plan.free {
        omicron::windows::set_busy(id, false)?;
    }
    let (updates, mut ended, cancel_handoff, handoff, linked) = (plan.updates, plan.ended, plan.cancel_handoff, plan.handoff, plan.linked);
    ended.splice(0..0, gone);
    windows.save()?;
    if updates.is_empty() && ended.is_empty() && handoff.is_none() && linked.is_none() {
        return Ok(None);
    }
    let board = sign_in(true)?;
    for (id, change) in updates {
        board.update_session(&id, change)?;
    }
    if let Some(id) = cancel_handoff {
        board.cancel_waiting_handoff(&id)?;
    }
    for id in ended {
        board.end_session(&id)?;
    }
    // A conversation starting gets its handoff note and the tasks waiting
    // for it.
    let mut context: Vec<String> = linked.into_iter().collect();
    if let Some(id) = handoff {
        if let Some(note) = board.waiting_handoff(&id)? {
            board.set_handoff_state(&note.id, "picked_up")?;
            context.push(format!(
                "{}\nPick up from here: check the real state first (git status, anything still running), then carry on.",
                crate::handoff_cmd::note_text(&note)
            ));
        }
    }
    if context.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        json!({ "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": context.join("\n\n") } }).to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_window_starting_clearing_and_closing_is_worked_out_before_supabase() {
        let mut w = Windows::default();
        w.links.insert("conv-1".into(), "s1".into());
        let no_link = |_: &str, _: &str| -> Option<(String, String)> { panic!("a known chat isn't linked again") };
        // A tracked conversation starts: its record says so.
        let c = plan_window_change(&Hook::SessionStart, &json!({ "cwd": "/w", "source": "startup" }), "conv-1", 7, &mut w, no_link);
        assert_eq!(c.updates, vec![("s1".to_string(), json!({ "claude_session_id": "conv-1", "folder": "/w", "state": "open" }))]);
        assert_eq!(c.handoff, None);
        // /clear: the same window, a new conversation that gets the note.
        let c = plan_window_change(&Hook::SessionEnd, &json!({ "reason": "clear" }), "conv-1", 7, &mut w, no_link);
        assert_eq!(c, WindowChange::default());
        assert!(w.windows[&7].clearing);
        let c = plan_window_change(&Hook::SessionStart, &json!({ "cwd": "/w", "source": "clear" }), "conv-2", 7, &mut w, no_link);
        assert_eq!(c.handoff.as_deref(), Some("s1"));
        assert_eq!(w.links.get("conv-2").map(String::as_str), Some("s1"));
        // Closed: it ends, free, and its waiting note is cancelled.
        let c = plan_window_change(&Hook::SessionEnd, &json!({ "reason": "prompt_input_exit" }), "conv-2", 7, &mut w, no_link);
        assert_eq!((c.ended, c.free.as_deref(), c.cancel_handoff.as_deref()), (vec!["s1".to_string()], Some("s1"), Some("s1")));
        assert!(w.windows.is_empty());
        // An unknown chat: linked if its folder is one of the machine's, told so.
        let c = plan_window_change(&Hook::SessionStart, &json!({ "cwd": "/app" }), "conv-3", 8, &mut w, |_, f| (f == "/app").then(|| ("s2".to_string(), "linked".to_string())));
        assert_eq!((c.linked.as_deref(), c.updates.len()), (Some("linked"), 1));
        // Anywhere else: nothing to say to Supabase.
        let c = plan_window_change(&Hook::SessionStart, &json!({ "cwd": "/tmp" }), "conv-4", 9, &mut w, |_, _| None);
        assert_eq!(c, WindowChange::default());
        assert_eq!(w.windows[&9].session_id, None);
    }
}
