//! Full-screen pickers: `omicron sessions pick` (this machine's sessions)
//! and `omicron teams pick` (this machine's running team members).
//! Arrow keys (or Ctrl-P/Ctrl-N) move, typing filters by any column,
//! Enter jumps in (reopening a closed session in the host first), Esc quits.

use crate::board_cmd::sign_in;
use anyhow::{bail, Context, Result};
use omicron::board::SessionRecord;
use omicron::text::line;
use std::io::{Read, Write};

/// A line in a picker: the name Enter acts on, then what's shown beside it.
#[derive(Debug, Clone, PartialEq)]
pub struct Row {
    pub name: String,
    pub status: String,
    pub group: String,
    pub detail: String,
}

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

    fn row(&self) -> Row {
        Row {
            name: self.session.name.clone(),
            status: self.status().into(),
            group: self.session.project.clone(),
            detail: self.session.folder.clone(),
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

/// The rows matching what's typed (every word, in the name, status or group).
pub fn matching(rows: &[Row], query: &str) -> Vec<usize> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    (0..rows.len())
        .filter(|&i| {
            let r = &rows[i];
            let text = format!("{} {} {}", r.name, r.status, r.group).to_lowercase();
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
            println!("{}\t{}\t{}\t{}", e.session.name, line(&e.session.project), e.status(), line(&e.session.folder));
        }
        return Ok(());
    }
    let rows: Vec<Row> = list.iter().map(Entry::row).collect();
    let Some(at) = choose("Sessions on this machine", &rows)? else { return Ok(()) };
    let chosen = &list[at];
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

/// A team member, as `omicron teams pick` lists it.
#[derive(Debug, Clone)]
pub struct Member {
    pub team: String,
    pub worker: String,
    pub role: String,
    pub state: String,
    /// The job it's on, like "#3 Add a login page".
    pub job: Option<String>,
}

/// The members running in the host here (only one team's, if named): by
/// team, the lead first, then by name.
pub fn team_rows(mut members: Vec<Member>, hosted: &[String], only: Option<&str>) -> Vec<Row> {
    members.retain(|m| only.map_or(true, |t| m.team.eq_ignore_ascii_case(t)));
    members.retain(|m| hosted.contains(&crate::teams_run::host_name(&m.team, &m.worker)));
    members.sort_by(|a, b| a.team.cmp(&b.team).then((a.worker != "lead").cmp(&(b.worker != "lead"))).then(a.worker.cmp(&b.worker)));
    members
        .into_iter()
        .map(|m| Row {
            name: crate::teams_run::host_name(&m.team, &m.worker),
            status: m.state,
            group: m.role,
            detail: m.job.unwrap_or_default(),
        })
        .collect()
}

/// `omicron teams pick [team]`.
pub fn pick_team(team: Option<String>) -> Result<()> {
    let board = sign_in(true)?;
    let me = omicron::config::Config::load()?.machine_key()?.machine_id.to_string();
    let hosted = omicron::host::hosted()?;
    let mut members = Vec::new();
    for t in board.teams()?.into_iter().filter(|t| t.machine_id == me) {
        if team.as_deref().is_some_and(|n| !t.name.eq_ignore_ascii_case(n)) {
            continue;
        }
        let jobs = board.jobs(&t)?;
        for (worker, role, state, job_id) in board.workers(&t)? {
            let job = job_id.and_then(|id| jobs.iter().find(|j| j.id == id)).map(|j| format!("#{} {}", j.number, j.title));
            members.push(Member { team: t.name.clone(), worker, role, state, job });
        }
    }
    let rows = team_rows(members, &hosted, team.as_deref());
    if rows.is_empty() {
        match &team {
            Some(t) => println!("Nobody in {t} is running on this machine. Start the team with `omicron teams start`."),
            None => println!("No team members are running on this machine. Start a team with `omicron teams start`."),
        }
        return Ok(());
    }
    if !std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        for r in &rows {
            println!("{}\t{}\t{}\t{}", r.name, line(&r.group), r.status, line(&r.detail));
        }
        return Ok(());
    }
    let title = match &team {
        Some(t) => format!("{t} on this machine"),
        None => "Team members on this machine".to_string(),
    };
    if let Some(at) = choose(&title, &rows)? {
        omicron::host::attach(&rows[at].name)?;
    }
    Ok(())
}

/// The full-screen part. None if they quit.
pub fn choose(title: &str, rows: &[Row]) -> Result<Option<usize>> {
    full_screen(|out| run(title, rows, out))
}

/// Raw keys on the alternate screen (so the terminal's contents come back
/// after), put back however `f` ends.
fn full_screen<T>(f: impl FnOnce(&mut std::io::Stdout) -> Result<T>) -> Result<T> {
    use nix::sys::termios;
    let stdin = std::io::stdin();
    let saved = termios::tcgetattr(&stdin).context("this needs a terminal")?;
    let mut raw = saved.clone();
    termios::cfmakeraw(&mut raw);
    termios::tcsetattr(&stdin, termios::SetArg::TCSANOW, &raw)?;
    let mut out = std::io::stdout();
    write!(out, "\x1b[?1049h\x1b[?25l")?;
    let result = f(&mut out);
    let _ = write!(out, "\x1b[?25h\x1b[?1049l");
    let _ = out.flush();
    let _ = termios::tcsetattr(&std::io::stdin(), termios::SetArg::TCSANOW, &saved);
    result
}

/// The terminal's size, or 80 by 24 if it won't say.
fn size() -> (usize, usize) {
    let mut ws: nix::libc::winsize = unsafe { std::mem::zeroed() };
    let ok = unsafe { nix::libc::ioctl(1, nix::libc::TIOCGWINSZ, &mut ws) } == 0;
    if ok && ws.ws_row > 0 && ws.ws_col > 0 {
        (ws.ws_col as usize, ws.ws_row as usize)
    } else {
        (80, 24)
    }
}

/// One key press, from what the terminal sent.
#[derive(Debug, PartialEq, Clone)]
pub enum Key {
    Up,
    Down,
    PageUp,
    PageDown,
    Enter,
    Escape,
    Backspace,
    CtrlC,
    CtrlP,
    CtrlN,
    Text(String),
    /// Anything else (an escape sequence or control key it doesn't use).
    Other,
}

/// Split what one read brought into the keys pressed: fast typing, a
/// held-down key or a paste can bring several at once.
pub fn keys(bytes: &[u8]) -> Vec<Key> {
    let mut out = Vec::new();
    let mut i = 0;
    let mut text = Vec::new();
    let flush = |text: &mut Vec<u8>, out: &mut Vec<Key>| {
        if !text.is_empty() {
            out.push(Key::Text(String::from_utf8_lossy(text).into_owned()));
            text.clear();
        }
    };
    while i < bytes.len() {
        let b = bytes[i];
        if b >= 0x20 && b != 0x7f {
            text.push(b);
            i += 1;
            continue;
        }
        flush(&mut text, &mut out);
        if b == 0x1b {
            let (key, len) = match (bytes.get(i + 1), bytes.get(i + 2)) {
                (Some(b'[' | b'O'), Some(b'A')) => (Key::Up, 3),
                (Some(b'[' | b'O'), Some(b'B')) => (Key::Down, 3),
                (Some(b'['), Some(b'5')) if bytes.get(i + 3) == Some(&b'~') => (Key::PageUp, 4),
                (Some(b'['), Some(b'6')) if bytes.get(i + 3) == Some(&b'~') => (Key::PageDown, 4),
                (Some(b'[' | b'O'), _) => {
                    // Some other sequence: up to and including its last letter.
                    let end = (i + 2..bytes.len()).find(|&j| bytes[j].is_ascii_alphabetic() || bytes[j] == b'~').unwrap_or(bytes.len() - 1);
                    (Key::Other, end + 1 - i)
                }
                _ => (Key::Escape, 1),
            };
            out.push(key);
            i += len;
            continue;
        }
        out.push(match b {
            b'\r' | b'\n' => Key::Enter,
            0x7f | 0x08 => Key::Backspace,
            0x03 => Key::CtrlC,
            0x10 => Key::CtrlP,
            0x0e => Key::CtrlN,
            _ => Key::Other,
        });
        i += 1;
    }
    flush(&mut text, &mut out);
    out
}

/// Show some text full-screen: arrows, space and b (or PgDn/PgUp), g and G
/// move; Esc or q goes back.
pub fn page(title: &str, text: &str) -> Result<()> {
    let lines: Vec<String> = text.lines().map(|l| l.replace('\t', "    ")).collect();
    full_screen(|out| {
        let mut top = 0usize;
        let mut input = std::io::stdin();
        loop {
            let (cols, rows) = size();
            let body = rows.saturating_sub(3).max(1);
            let last = lines.len().saturating_sub(body);
            top = top.min(last);
            let mut screen = format!("\x1b[H\x1b[2J\x1b[1m{title}\x1b[0m\r\n\r\n");
            for l in lines.iter().skip(top).take(body) {
                let cut: String = l.chars().filter(|c| !c.is_control()).take(cols).collect();
                let color = match cut.chars().next() {
                    Some('+') if !cut.starts_with("+++") => "\x1b[32m",
                    Some('-') if !cut.starts_with("---") => "\x1b[31m",
                    Some('@') if cut.starts_with("@@") => "\x1b[36m",
                    _ => "",
                };
                screen.push_str(&format!("{color}{cut}\x1b[0m\r\n"));
            }
            let end = (top + body).min(lines.len());
            screen.push_str(&format!("\x1b[{rows};1H\x1b[2mLines {}–{end} of {} · ↑↓ space b move · Esc back\x1b[0m", top.min(end) + usize::from(end > 0), lines.len()));
            out.write_all(screen.as_bytes())?;
            out.flush()?;
            let mut buf = [0u8; 4096];
            let n = input.read(&mut buf)?;
            for key in keys(&buf[..n]) {
                // Letters in a run are separate keys here (q, j, k, g...).
                let presses: Vec<Key> = match key {
                    Key::Text(t) => t.chars().map(|c| Key::Text(c.to_string())).collect(),
                    k => vec![k],
                };
                for k in presses {
                    match k {
                        Key::Escape | Key::CtrlC => return Ok(()),
                        Key::Text(t) if t == "q" => return Ok(()),
                        Key::Up => top = top.saturating_sub(1),
                        Key::Text(t) if t == "k" => top = top.saturating_sub(1),
                        Key::Down | Key::Enter => top = (top + 1).min(last),
                        Key::Text(t) if t == "j" => top = (top + 1).min(last),
                        Key::PageDown => top = (top + body).min(last),
                        Key::Text(t) if t == " " => top = (top + body).min(last),
                        Key::PageUp => top = top.saturating_sub(body),
                        Key::Text(t) if t == "b" => top = top.saturating_sub(body),
                        Key::Text(t) if t == "g" => top = 0,
                        Key::Text(t) if t == "G" => top = last,
                        _ => {}
                    }
                }
            }
        }
    })
}

fn run(title: &str, list: &[Row], out: &mut std::io::Stdout) -> Result<Option<usize>> {
    let mut query = String::new();
    let mut at = 0usize;
    let mut input = std::io::stdin();
    loop {
        let rows = matching(list, &query);
        at = at.min(rows.len().saturating_sub(1));
        let shown: Vec<&Row> = rows.iter().map(|&i| &list[i]).collect();
        draw(out, title, &shown, at, &query)?;
        let mut buf = [0u8; 4096];
        let n = input.read(&mut buf)?;
        // Every key that came, in order (the list is worked out again
        // after each, so Enter picks from what was typed before it).
        let mut rows = rows;
        for key in keys(&buf[..n]) {
            match key {
                Key::Escape | Key::CtrlC => return Ok(None),
                Key::Up | Key::CtrlP => at = at.saturating_sub(1),
                Key::Down | Key::CtrlN => at = (at + 1).min(rows.len().saturating_sub(1)),
                Key::Enter => {
                    if let Some(&i) = rows.get(at) {
                        return Ok(Some(i));
                    }
                }
                Key::Backspace => {
                    query.pop();
                    at = 0;
                }
                Key::Text(t) => {
                    query.push_str(&t);
                    at = 0;
                }
                _ => {}
            }
            rows = matching(list, &query);
            at = at.min(rows.len().saturating_sub(1));
        }
    }
}

fn draw(out: &mut std::io::Stdout, title: &str, rows: &[&Row], at: usize, query: &str) -> Result<()> {
    // Raw mode: lines end with \r\n.
    let mut screen = String::from("\x1b[H\x1b[2J");
    screen.push_str(&format!("\x1b[1m{title}\x1b[0m\r\n"));
    screen.push_str(&format!("\x1b[2mFilter:\x1b[0m {query}\r\n\r\n"));
    if rows.is_empty() {
        screen.push_str("  \x1b[2mNothing matches.\x1b[0m\r\n");
    }
    let width = rows.iter().map(|r| r.name.chars().count()).max().unwrap_or(0);
    let status = rows.iter().map(|r| r.status.chars().count()).max().unwrap_or(0);
    for (i, r) in rows.iter().enumerate() {
        let line = format!("{:<width$}  {:<status$}  {}  \x1b[2m{}\x1b[0m", line(&r.name), r.status, line(&r.group), line(&r.detail));
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
        let rows: Vec<Row> = list.iter().map(Entry::row).collect();
        let names = |q: &str| matching(&rows, q).iter().map(|&i| rows[i].name.clone()).collect::<Vec<_>>();
        assert_eq!(names("site"), ["web"]);
        assert_eq!(names("code r"), ["parser", "crashed"]);
        assert!(names("nothing").is_empty());
    }

    #[test]
    fn keys_that_arrive_together_are_each_seen() {
        use Key::*;
        assert_eq!(keys(b"\x7f\x7f\x7fnew"), [Backspace, Backspace, Backspace, Text("new".into())]);
        assert_eq!(keys(b"\x1b[A\x1b[Bx\r"), [Up, Down, Text("x".into()), Enter]);
        assert_eq!(keys(b"\x1b"), [Escape]);
        assert_eq!(keys(b"\x1b[5~\x1b[6~\x1b[1;5C"), [PageUp, PageDown, Other]);
        assert_eq!(keys("héllo 🥛".as_bytes()), [Text("héllo 🥛".into())]);
        assert_eq!(keys(b"\x03\x10\x0e"), [CtrlC, CtrlP, CtrlN]);
    }

    #[test]
    fn team_members_running_here_lead_first() {
        let m = |team: &str, worker: &str, role: &str, job: Option<&str>| Member {
            team: team.into(),
            worker: worker.into(),
            role: role.into(),
            state: "busy".into(),
            job: job.map(String::from),
        };
        let all = vec![
            m("web", "builder-1", "builder", Some("#2 Fix the footer")),
            m("web", "lead", "lead", None),
            m("web", "reviewer-1", "reviewer", None),
            m("api", "lead", "lead", None),
        ];
        let hosted: Vec<String> = ["web.builder-1", "web.lead", "api.lead", "other"].map(String::from).to_vec();
        let names = |only| team_rows(all.clone(), &hosted, only).into_iter().map(|r| r.name).collect::<Vec<_>>();
        assert_eq!(names(None), ["api.lead", "web.lead", "web.builder-1"]);
        assert_eq!(names(Some("WEB")), ["web.lead", "web.builder-1"]);
        let rows = team_rows(all.clone(), &hosted, None);
        assert_eq!(rows[2], Row { name: "web.builder-1".into(), status: "busy".into(), group: "builder".into(), detail: "#2 Fix the footer".into() });
        let found = matching(&rows, "web build");
        assert_eq!(found, [2]);
    }
}
