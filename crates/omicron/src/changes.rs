//! Following the change list (the `changes` table): catching up on lines
//! this machine missed, then handling each new one once (see CLAUDE.md,
//! "Event-driven"). The daemon prints each line and reacts to it.
//!
//! A line is reacted to *before* it's remembered as handled, so a crash in
//! between means it's reacted to again after a restart, never lost: every
//! reaction must be safe to run twice. Lines that finish saving late (a
//! lower number arriving after a higher one) are still handled, once.

use crate::config::State;
use crate::supa::{Session, Supabase};
use anyhow::Result;
use serde_json::{json, Value};
use std::io::Write;

/// Where change lines come from: Supabase, or a list in tests.
pub trait ChangeSource {
    /// The lines from the last moment (in case one finished saving late).
    fn recent(&self) -> Result<Vec<Value>>;
    /// The newest line's number, if there are any.
    fn newest(&self) -> Result<Option<i64>>;
    /// Up to `limit` lines after `seq`, in order.
    fn after(&self, seq: i64, limit: usize) -> Result<Vec<Value>>;
}

/// The change list in Supabase, read as a signed-in machine.
pub struct SupabaseChanges<'a> {
    pub supabase: &'a Supabase,
    pub session: &'a Session,
}

impl ChangeSource for SupabaseChanges<'_> {
    fn recent(&self) -> Result<Vec<Value>> {
        let rows = self.supabase.request_as(self.session, "POST", "/rest/v1/rpc/recent_changes", Some(json!({})))?;
        Ok(rows.as_array().cloned().unwrap_or_default())
    }

    fn newest(&self) -> Result<Option<i64>> {
        let rows = self.supabase.request_as(self.session, "GET", "/rest/v1/changes?select=seq&order=seq.desc&limit=1", None)?;
        Ok(rows.get(0).and_then(|r| r["seq"].as_i64()))
    }

    fn after(&self, seq: i64, limit: usize) -> Result<Vec<Value>> {
        let rows = self.supabase.request_as(self.session, "GET", &format!("/rest/v1/changes?seq=gt.{seq}&order=seq.asc&limit={limit}"), None)?;
        Ok(rows.as_array().cloned().unwrap_or_default())
    }
}

/// How many lines to read at a time when catching up.
pub const PAGE: usize = 500;

/// Catch up on the lines missed since this machine last listened. The very
/// first time, start from now instead of replaying all of history.
pub fn catch_up(
    source: &dyn ChangeSource,
    state: &mut State,
    save: &mut dyn FnMut(&State) -> Result<()>,
    out: &mut dyn Write,
    react: &dyn Fn(&Value),
) -> Result<()> {
    let window = source.recent()?;
    let Some(mut last) = state.last_change else {
        // Mark what's there as handled, without printing or reacting to it.
        for seq in window.iter().filter_map(|row| row["seq"].as_i64()) {
            state.mark(seq);
        }
        state.last_change = Some(source.newest()?.unwrap_or(0).max(state.last_change.unwrap_or(0)));
        return save(state);
    };
    loop {
        let rows = source.after(last, PAGE)?;
        for row in &rows {
            handle(row, state, save, out, react)?;
        }
        match state.last_change {
            Some(now) if rows.len() == PAGE && now > last => last = now,
            _ => break,
        }
    }
    for row in &window {
        handle(row, state, save, out, react)?;
    }
    Ok(())
}

/// Print one line and react to it, then remember it as handled, unless it
/// already was.
pub fn handle(
    row: &Value,
    state: &mut State,
    save: &mut dyn FnMut(&State) -> Result<()>,
    out: &mut dyn Write,
    react: &dyn Fn(&Value),
) -> Result<()> {
    let Some(seq) = row["seq"].as_i64() else { return Ok(()) };
    if !state.is_new(seq) {
        return Ok(());
    }
    let line = json!({
        "seq": seq,
        "at": row["at"],
        "table": row["table_name"],
        "type": row["kind"],
        "project_id": row["project_id"],
        "actor_id": row["actor_id"],
        "record": row["record"],
        "old_record": row["old_record"],
    });
    writeln!(out, "{line}")?;
    out.flush()?;
    // React first: if this process dies before the line is saved as
    // handled, it's reacted to again after a restart rather than lost.
    react(row);
    state.mark(seq);
    save(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// A change list in memory: lines by number, plus what `recent` returns.
    struct Lines {
        all: Vec<i64>,
        recent: Vec<i64>,
    }

    fn row(seq: i64) -> Value {
        json!({ "seq": seq, "table_name": "tasks", "kind": "UPDATE", "record": { "n": seq } })
    }

    impl ChangeSource for Lines {
        fn recent(&self) -> Result<Vec<Value>> {
            Ok(self.recent.iter().map(|&s| row(s)).collect())
        }
        fn newest(&self) -> Result<Option<i64>> {
            Ok(self.all.iter().max().copied())
        }
        fn after(&self, seq: i64, limit: usize) -> Result<Vec<Value>> {
            let mut v: Vec<i64> = self.all.iter().copied().filter(|&s| s > seq).collect();
            v.sort();
            Ok(v.into_iter().take(limit).map(row).collect())
        }
    }

    /// Run catch_up, returning the lines reacted to, in order.
    fn run(lines: &Lines, state: &mut State) -> Vec<i64> {
        let seen = RefCell::new(Vec::new());
        let mut out = Vec::new();
        catch_up(lines, state, &mut |_| Ok(()), &mut out, &|r| seen.borrow_mut().push(r["seq"].as_i64().unwrap())).unwrap();
        seen.into_inner()
    }

    #[test]
    fn the_first_time_it_starts_from_now() {
        let lines = Lines { all: (1..=10).collect(), recent: vec![9, 10] };
        let mut state = State::default();
        assert_eq!(run(&lines, &mut state), Vec::<i64>::new());
        assert_eq!(state.last_change, Some(10));
        // Then only what comes after.
        let lines = Lines { all: (1..=12).collect(), recent: vec![11, 12] };
        assert_eq!(run(&lines, &mut state), vec![11, 12]);
    }

    #[test]
    fn missed_lines_are_handled_once_in_order_across_pages() {
        let mut state = State { last_change: Some(5), recent: vec![5] };
        let lines = Lines { all: (1..=(5 + PAGE as i64 + 20)).collect(), recent: vec![] };
        let seen = run(&lines, &mut state);
        assert_eq!(seen, (6..=(5 + PAGE as i64 + 20)).collect::<Vec<_>>());
        // Heard again (a reconnect): nothing twice.
        assert_eq!(run(&lines, &mut state), Vec::<i64>::new());
    }

    #[test]
    fn a_line_that_saved_late_is_still_handled() {
        let mut state = State { last_change: Some(20), recent: (11..=20).filter(|&s| s != 17).collect() };
        // 17 finished saving after 18-20 were handled: it shows in `recent`.
        let lines = Lines { all: (1..=20).collect(), recent: vec![17, 18, 19, 20] };
        assert_eq!(run(&lines, &mut state), vec![17]);
    }

    #[test]
    fn a_line_is_reacted_to_before_it_is_remembered() {
        let mut state = State { last_change: Some(1), recent: vec![1] };
        let mut out = Vec::new();
        let order = RefCell::new(Vec::new());
        let mut save = |s: &State| {
            order.borrow_mut().push(format!("saved, 2 handled: {}", !s.is_new(2)));
            Ok(())
        };
        handle(&row(2), &mut state, &mut save, &mut out, &|_| order.borrow_mut().push("reacted".to_string())).unwrap();
        // A crash between the two would leave 2 unsaved, so it's reacted to again.
        assert_eq!(*order.borrow(), vec!["reacted".to_string(), "saved, 2 handled: true".to_string()]);
        // And it's printed, as the daemon's output.
        assert!(String::from_utf8(out).unwrap().contains(r#""seq":2"#));
    }
}
