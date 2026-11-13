//! A conversation's inbox: messages for a session that's open in a Claude
//! window Omicron doesn't host, so they can't be typed in. Omicron's add-on
//! in that window follows the inbox (`omicron sessions inbox <conversation>`)
//! and puts each message into the window as if typed, once Claude is free.
//!
//! One file per message under `~/.omicron/inbox/<conversation>/`, plus a
//! `listener` file naming the follower's process, so a sender can tell a
//! window is there to take it.

use anyhow::{Context, Result};
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// How often a follower looks for new messages. Local files only.
const FOLLOW_EVERY: Duration = Duration::from_millis(500);

fn dir(claude_id: &str) -> Result<PathBuf> {
    uuid::Uuid::parse_str(claude_id).with_context(|| format!("{claude_id} isn't a Claude conversation id"))?;
    Ok(crate::config::home()?.join("inbox").join(claude_id))
}

/// Is a window following this conversation's inbox right now?
pub fn listening(claude_id: &str) -> bool {
    let Ok(d) = dir(claude_id) else { return false };
    listener(&d).is_some_and(crate::windows::alive)
}

fn listener(d: &std::path::Path) -> Option<u32> {
    std::fs::read_to_string(d.join("listener")).ok()?.trim().parse().ok()
}

/// Leave a message. Written whole, then moved in, so a follower never reads
/// half of one. Names sort oldest first.
pub fn put(claude_id: &str, text: &str) -> Result<()> {
    let d = dir(claude_id)?;
    std::fs::create_dir_all(&d)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let name = format!("{stamp:024}-{}", uuid::Uuid::new_v4().simple());
    let part = d.join(format!("{name}.part"));
    std::fs::write(&part, text)?;
    std::fs::rename(&part, d.join(format!("{name}.msg")))?;
    Ok(())
}

/// Take the waiting messages, oldest first. Each is claimed by renaming it,
/// so two followers never both take the same one.
pub fn take(claude_id: &str) -> Result<Vec<String>> {
    let d = dir(claude_id)?;
    let mut names: Vec<String> = match std::fs::read_dir(&d) {
        Ok(entries) => entries.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".msg")).collect(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    names.sort();
    let mut taken = Vec::new();
    for n in names {
        let claimed = d.join(format!("{n}.taken"));
        if std::fs::rename(d.join(&n), &claimed).is_err() {
            continue;
        }
        taken.push(std::fs::read_to_string(&claimed)?);
        std::fs::remove_file(&claimed)?;
    }
    Ok(taken)
}

/// Follow the inbox: say this process is listening, then hand each message
/// to `each` as it arrives, until `each` says stop (returns false). The
/// newest follower of a conversation wins; an older one stops once it sees
/// it's been replaced.
pub fn follow(claude_id: &str, mut each: impl FnMut(&str) -> bool) -> Result<()> {
    let d = dir(claude_id)?;
    std::fs::create_dir_all(&d)?;
    let me = std::process::id();
    std::fs::write(d.join("listener"), me.to_string())?;
    let result = (|| -> Result<()> {
        while listener(&d) == Some(me) {
            for text in take(claude_id)? {
                if !each(&text) {
                    return Ok(());
                }
            }
            std::thread::sleep(FOLLOW_EVERY);
        }
        Ok(())
    })();
    if listener(&d) == Some(me) {
        let _ = std::fs::remove_file(d.join("listener"));
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each test its own home; OMICRON_HOME is process-wide, so they share a lock.
    fn with_home<T>(f: impl FnOnce() -> T) -> T {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = std::env::temp_dir().join(format!("omicron-inbox-{}", uuid::Uuid::new_v4().simple()));
        unsafe { std::env::set_var("OMICRON_HOME", &home) };
        let out = f();
        let _ = std::fs::remove_dir_all(&home);
        out
    }

    #[test]
    fn messages_come_out_whole_oldest_first_and_once() {
        with_home(|| {
            let id = uuid::Uuid::new_v4().to_string();
            assert!(take(&id).unwrap().is_empty());
            put(&id, "first\nwith a second line").unwrap();
            put(&id, "second").unwrap();
            assert_eq!(take(&id).unwrap(), ["first\nwith a second line", "second"]);
            assert!(take(&id).unwrap().is_empty());
        })
    }

    #[test]
    fn only_a_live_follower_counts_as_listening() {
        with_home(|| {
            let id = uuid::Uuid::new_v4().to_string();
            assert!(!listening(&id));
            let d = dir(&id).unwrap();
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("listener"), std::process::id().to_string()).unwrap();
            assert!(listening(&id));
            // A follower that died without cleaning up.
            let mut gone = std::process::Command::new("true").spawn().unwrap();
            let pid = gone.id();
            gone.wait().unwrap();
            std::fs::write(d.join("listener"), pid.to_string()).unwrap();
            assert!(!listening(&id));
        })
    }

    #[test]
    fn follow_hands_over_messages_then_stops_when_told() {
        with_home(|| {
            let id = uuid::Uuid::new_v4().to_string();
            put(&id, "one").unwrap();
            put(&id, "two").unwrap();
            let mut got = Vec::new();
            follow(&id, |t| {
                got.push(t.to_string());
                got.len() < 2
            })
            .unwrap();
            assert_eq!(got, ["one", "two"]);
            // Stopped: it no longer says it's listening.
            assert!(!listening(&id));
        })
    }

    #[test]
    fn a_newer_follower_replaces_an_older_one() {
        with_home(|| {
            let id = uuid::Uuid::new_v4().to_string();
            let d = dir(&id).unwrap();
            let home = crate::config::home().unwrap();
            let old = std::thread::spawn({
                let id = id.clone();
                move || {
                    unsafe { std::env::set_var("OMICRON_HOME", &home) };
                    follow(&id, |_| true)
                }
            });
            while listener(&d).is_none() {
                std::thread::sleep(Duration::from_millis(20));
            }
            // Another process takes over.
            std::fs::write(d.join("listener"), "1").unwrap();
            old.join().unwrap().unwrap();
            assert_eq!(listener(&d), Some(1));
        })
    }

    #[test]
    fn a_conversation_id_must_be_one() {
        with_home(|| {
            assert!(put("../../etc", "x").is_err());
            assert!(!listening("../x"));
        })
    }
}
