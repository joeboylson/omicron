//! `omicron sessions pick`: a full-screen list of this machine's sessions.
//! Arrow keys (or Ctrl-P/Ctrl-N) move, typing filters by name or Project,
//! Enter jumps in (reopening a closed one in the host first), Esc quits.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use omicron::board::SessionRecord;
use std::io::{Read, Write};

/// One row: a session and whether it's running in the host here.
#[derive(Debug, Clone)]
pub struct Entry {
    pub session: SessionRecord,
    pub hosted: bool,
}

impl Entry {
    /// What Enter does, in a word or two.
    fn status(&self) -> &'static str {
        match (self.hosted, self.session.state.as_str()) {
            (true, _) => "running",
            (false, "open") => "open elsewhere",
            (false, "closed") => "closed",
            _ => "crashed",
        }
    }
}

/// This machine's sessions that can be opened, in the order shown: running
/// in the host first, then open elsewhere, closed, crashed; by name within
/// each. Sessions gone for good (machine removed, conversation deleted)
/// aren't listed.
pub fn entries(sessions: Vec<SessionRecord>, machine_id: &str, hosted: &[String]) -> Vec<Entry> {
    let mut list: Vec<Entry> = sessions
        .into_iter()
        .filter(|s| s.machine_id == machine_id)
        .filter(|s| s.state != "gone" || s.gone_why.as_deref() == Some(omicron::windows::STOPPED))
        .map(|s| Entry { hosted: hosted.contains(&s.name), session: s })
        .collect();
    let rank = |e: &Entry| match (e.hosted, e.session.state.as_str()) {
        (true, _) => 0,
        (false, "open") => 1,
        (false, "closed") => 2,
        _ => 3,
    };
    list.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.session.name.cmp(&b.session.name)));
    list
}

/// The rows matching what's typed (every word, in the name or Project).
pub fn matching<'a>(list: &'a [Entry], query: &str) -> Vec<&'a Entry> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    list.iter()
        .filter(|e| {
            let text = format!("{} {}", e.session.name, e.session.project).to_lowercase();
            words.iter().all(|w| text.contains(w.as_str()))
        })
        .collect()
}

pub fn pick() -> Result<()> {
    let board = sign_in(true)?;
    let config = omicron::config::Config::load()?;
    let me = config.machine_key()?.machine_id.to_string();
    let hosted = omicron::host::hosted()?;
    let list = entries(board.sessions(None)?, &me, &hosted);
    if list.is_empty() {
        println!("No sessions on this machine yet. Start one with `omicron sessions new`.");
        return Ok(());
    }
    if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        for e in &list {
            println!("{}\t{}\t{}\t{}", e.session.name, e.session.project, e.status(), e.session.folder);
        }
        return Ok(());
    }
    let Some(chosen) = choose(&list)? else { return Ok(()) };
    let s = &chosen.session;
    if chosen.hosted {
        omicron::host::attach(&s.name)?;
        return Ok(());
    }
    if s.state == "open" {
        bail!("{} is open in a window Omicron doesn't host ({}). Switch to that window.", s.name, s.folder);
    }
    let machine = board.machines()?.into_iter().find(|m| m.id == me).map(|m| m.name).unwrap_or_else(|| "this machine".into());
    crate::sessions_cmd::reopen(&board, s, &machine, None)?;
    omicron::host::attach(&s.name)?;
    Ok(())
}

/// The full-screen part. None if they quit.
fn choose(list: &[Entry]) -> Result<Option<Entry>> {
    use nix::sys::termios;
    let stdin = std::io::stdin();
    let saved = termios::tcgetattr(&stdin).context("the picker needs a terminal")?;
    let mut raw = saved.clone();
    termios::cfmakeraw(&mut raw);
    termios::tcsetattr(&stdin, termios::SetArg::TCSANOW, &raw)?;
    let mut out = std::io::stdout();
    // The alternate screen, so the terminal's contents come back after.
    write!(out, "\x1b[?1049h\x1b[?25l")?;
    let result = run(list, &mut out);
    let _ = write!(out, "\x1b[?25h\x1b[?1049l");
    let _ = out.flush();
    let _ = termios::tcsetattr(&std::io::stdin(), termios::SetArg::TCSANOW, &saved);
    result
}

fn run(list: &[Entry], out: &mut std::io::Stdout) -> Result<Option<Entry>> {
    let mut query = String::new();
    let mut at = 0usize;
    let mut input = std::io::stdin();
    loop {
        let rows = matching(list, &query);
        at = at.min(rows.len().saturating_sub(1));
        draw(out, &rows, at, &query)?;
        let mut key = [0u8; 8];
        let n = input.read(&mut key)?;
        match &key[..n] {
            [0x1b] | [0x03] => return Ok(None),
            [0x1b, b'[', b'A'] | [0x10] => at = at.saturating_sub(1),
            [0x1b, b'[', b'B'] | [0x0e] => at = (at + 1).min(rows.len().saturating_sub(1)),
            [b'\r'] | [b'\n'] => {
                if let Some(e) = rows.get(at) {
                    return Ok(Some((*e).clone()));
                }
            }
            [0x7f] | [0x08] => {
                query.pop();
                at = 0;
            }
            bytes => {
                if let Ok(text) = std::str::from_utf8(bytes) {
                    if text.chars().all(|c| !c.is_control()) {
                        query.push_str(text);
                        at = 0;
                    }
                }
            }
        }
    }
}

fn draw(out: &mut std::io::Stdout, rows: &[&Entry], at: usize, query: &str) -> Result<()> {
    // Raw mode: lines end with \r\n.
    let mut screen = String::from("\x1b[H\x1b[2J");
    screen.push_str("\x1b[1mSessions on this machine\x1b[0m\r\n");
    screen.push_str(&format!("\x1b[2mFilter:\x1b[0m {query}\r\n\r\n"));
    if rows.is_empty() {
        screen.push_str("  \x1b[2mNothing matches.\x1b[0m\r\n");
    }
    let width = rows.iter().map(|e| e.session.name.chars().count()).max().unwrap_or(0);
    for (i, e) in rows.iter().enumerate() {
        let line = format!(
            "{:<width$}  {:<14}  {}  \x1b[2m{}\x1b[0m",
            e.session.name,
            e.status(),
            e.session.project,
            e.session.folder,
        );
        if i == at {
            screen.push_str(&format!("\x1b[7m› {line}\x1b[0m\r\n"));
        } else {
            screen.push_str(&format!("  {line}\r\n"));
        }
    }
    screen.push_str("\r\n\x1b[2m↑↓ move · type to filter · Enter opens it · Esc quits\x1b[0m");
    out.write_all(screen.as_bytes())?;
    out.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(name: &str, project: &str, machine: &str, state: &str, why: Option<&str>) -> SessionRecord {
        SessionRecord {
            id: name.into(),
            project_id: "p".into(),
            name: name.into(),
            project: project.into(),
            machine_id: machine.into(),
            machine: "m".into(),
            state: state.into(),
            claude_session_id: None,
            folder: "/work".into(),
            gone_why: why.map(String::from),
        }
    }

    #[test]
    fn running_first_then_open_closed_crashed_and_only_this_machines() {
        let all = vec![
            s("zeta", "Code", "me", "closed", None),
            s("alpha", "Code", "me", "closed", None),
            s("parser", "Code", "me", "open", None),
            s("web", "Site", "me", "open", None),
            s("crashed", "Code", "me", "gone", Some(omicron::windows::STOPPED)),
            s("removed", "Code", "me", "gone", Some("its machine was taken out of the Project")),
            s("theirs", "Code", "other", "open", None),
        ];
        let list = entries(all, "me", &["web".to_string()]);
        let names: Vec<(&str, &str)> = list.iter().map(|e| (e.session.name.as_str(), e.status())).collect();
        assert_eq!(
            names,
            [("web", "running"), ("parser", "open elsewhere"), ("alpha", "closed"), ("zeta", "closed"), ("crashed", "crashed")]
        );
        // Filtering by name and Project, every word.
        let names = |q: &str| matching(&list, q).iter().map(|e| e.session.name.clone()).collect::<Vec<_>>();
        assert_eq!(names("site"), ["web"]);
        assert_eq!(names("code r"), ["parser", "crashed"]);
        assert!(names("nothing").is_empty());
    }
}
