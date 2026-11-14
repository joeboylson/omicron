//! What the daemon does when it hears a line of the change list: a few
//! reactions (loops, runs, teams, dispatch), each saying which lines it
//! wants and how it runs, so one slow or failing reaction never holds up
//! listening or the others. Every reaction must be safe to run twice
//! (see `changes`).

use anyhow::Result;
use serde_json::Value;
use std::sync::mpsc::{channel, Sender};
use std::sync::Arc;

/// One line of the change list, read.
#[derive(Debug, Clone)]
pub struct Change {
    pub table: String,
    /// INSERT, UPDATE or DELETE.
    pub kind: String,
    pub record: Value,
    pub old_record: Value,
    /// The line as it came.
    pub row: Value,
}

impl Change {
    pub fn read(row: &Value) -> Option<Change> {
        Some(Change {
            table: row["table_name"].as_str()?.to_string(),
            kind: row["kind"].as_str().unwrap_or("").to_string(),
            record: row["record"].clone(),
            old_record: row["old_record"].clone(),
            row: row.clone(),
        })
    }

    pub fn is(&self, tables: &[&str]) -> bool {
        tables.contains(&self.table.as_str())
    }
}

/// How a reaction runs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Runs {
    /// Right away, on the listening thread: only for quick work in memory.
    Inline,
    /// On a thread of its own, one line at a time, in order.
    InOrder,
    /// Each line on a new thread, all at once.
    EachAlone,
}

pub trait Reaction: Send + Sync {
    /// For the log: "<name>: ...".
    fn name(&self) -> &'static str;
    fn wants(&self, change: &Change) -> bool;
    fn react(&self, change: &Change) -> Result<()>;
    fn runs(&self) -> Runs {
        Runs::EachAlone
    }
}

/// The reactions, started.
pub struct Reactions {
    each: Vec<(Arc<dyn Reaction>, Option<Sender<Change>>)>,
    log: Arc<dyn Fn(String) + Send + Sync>,
}

impl Reactions {
    /// `log` gets each reaction's error, as "<name>: <error>".
    pub fn start(list: Vec<Arc<dyn Reaction>>, log: Arc<dyn Fn(String) + Send + Sync>) -> Reactions {
        let each = list
            .into_iter()
            .map(|r| {
                let queue = (r.runs() == Runs::InOrder).then(|| {
                    let (tx, rx) = channel::<Change>();
                    let (r, log) = (r.clone(), log.clone());
                    std::thread::spawn(move || {
                        for c in rx {
                            if let Err(e) = r.react(&c) {
                                log(format!("{}: {e:#}", r.name()));
                            }
                        }
                    });
                    tx
                });
                (r, queue)
            })
            .collect();
        Reactions { each, log }
    }

    /// Hand a line to each reaction that wants it.
    pub fn heard(&self, row: &Value) {
        let Some(change) = Change::read(row) else { return };
        for (r, queue) in &self.each {
            if !r.wants(&change) {
                continue;
            }
            match (r.runs(), queue) {
                (Runs::InOrder, Some(q)) => {
                    let _ = q.send(change.clone());
                }
                (Runs::Inline, _) => {
                    if let Err(e) = r.react(&change) {
                        (self.log)(format!("{}: {e:#}", r.name()));
                    }
                }
                _ => {
                    let (r, log, c) = (r.clone(), self.log.clone(), change.clone());
                    std::thread::spawn(move || {
                        if let Err(e) = r.react(&c) {
                            log(format!("{}: {e:#}", r.name()));
                        }
                    });
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;

    struct Fake {
        name: &'static str,
        tables: &'static [&'static str],
        runs: Runs,
        fails: bool,
        seen: Arc<Mutex<Vec<String>>>,
    }

    impl Reaction for Fake {
        fn name(&self) -> &'static str {
            self.name
        }
        fn wants(&self, c: &Change) -> bool {
            c.is(self.tables)
        }
        fn react(&self, c: &Change) -> Result<()> {
            if self.fails {
                anyhow::bail!("broke on {}", c.record["n"]);
            }
            self.seen.lock().unwrap().push(format!("{} {} {}", self.name, c.table, c.record["n"]));
            Ok(())
        }
        fn runs(&self) -> Runs {
            self.runs
        }
    }

    fn line(table: &str, n: i64) -> Value {
        json!({ "table_name": table, "kind": "UPDATE", "record": { "n": n } })
    }

    fn wait_for(what: impl Fn() -> bool) {
        for _ in 0..200 {
            if what() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        panic!("timed out");
    }

    #[test]
    fn each_reaction_gets_only_its_lines_and_one_failing_stops_no_other() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let logged = Arc::new(Mutex::new(Vec::new()));
        let fake = |name, tables, runs, fails| Arc::new(Fake { name, tables, runs, fails, seen: seen.clone() }) as Arc<dyn Reaction>;
        let l = logged.clone();
        let reactions = Reactions::start(
            vec![
                fake("loops", &["loops"], Runs::Inline, false),
                fake("runs", &["runs", "tasks"], Runs::InOrder, false),
                fake("teams", &["jobs"], Runs::EachAlone, true),
            ],
            Arc::new(move |m| l.lock().unwrap().push(m)),
        );
        for (t, n) in [("loops", 1), ("tasks", 2), ("jobs", 3), ("runs", 4), ("people", 5), ("runs", 6)] {
            reactions.heard(&line(t, n));
        }
        // Inline ones are done before `heard` returns.
        assert!(seen.lock().unwrap().contains(&"loops loops 1".to_string()));
        wait_for(|| seen.lock().unwrap().len() == 4 && !logged.lock().unwrap().is_empty());
        let seen = seen.lock().unwrap().clone();
        // In order, and nobody got a line it didn't want.
        let runs: Vec<_> = seen.iter().filter(|s| s.starts_with("runs")).cloned().collect();
        assert_eq!(runs, ["runs tasks 2", "runs runs 4", "runs runs 6"]);
        assert!(!seen.iter().any(|s| s.contains(" 5")));
        // The failing one is logged by name.
        assert_eq!(*logged.lock().unwrap(), ["teams: broke on 3"]);
    }

    #[test]
    fn a_line_without_a_table_is_skipped() {
        assert!(Change::read(&json!({ "seq": 1 })).is_none());
    }
}
