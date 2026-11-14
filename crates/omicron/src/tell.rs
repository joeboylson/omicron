//! Telling a Claude session something: the one way a message reaches a
//! session Omicron knows (a dispatched task, a loop's prompt, `omicron
//! sessions send`). It goes into the session's inbox, and the window's
//! add-on types it in once Claude is free (see `inbox`).
//!
//! Typing straight into a hosted window (`host::say`) is a different thing,
//! kept for what must be typed now and in order: a run's next task, a
//! handoff's /clear, a team member's line.

use crate::board::{Board, SessionRecord};
use anyhow::Result;

/// What became of a message.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Delivery {
    /// A window is following its inbox: it's typed in once Claude is free.
    Sent,
    /// Running here, but its add-on isn't following yet: it shows up once it does.
    Waiting,
    /// Not open anywhere: it's there when the session is next opened.
    NotOpen,
}

/// The rule, with nothing read: whether a window follows the inbox, and
/// whether the session's window is running here.
pub fn delivery(listening: bool, running: bool) -> Delivery {
    match (listening, running) {
        (true, _) => Delivery::Sent,
        (false, true) => Delivery::Waiting,
        (false, false) => Delivery::NotOpen,
    }
}

/// Whether the session is open: a window follows its inbox. (Loops wait for
/// this rather than pile prompts up.)
pub fn is_open(session: &SessionRecord) -> bool {
    session.claude_session_id.as_deref().is_some_and(crate::inbox::listening)
}

/// Leave `text` for the session and say what became of it. A session never
/// opened yet is given the conversation it'll start with, so the message is
/// waiting there.
pub fn tell(board: &Board, session: &SessionRecord, text: &str) -> Result<Delivery> {
    let conversation = match &session.claude_session_id {
        Some(c) => c.clone(),
        None => {
            let c = uuid::Uuid::new_v4().to_string();
            board.session_conversation(&session.id, &c)?;
            c
        }
    };
    crate::inbox::put(&conversation, text)?;
    Ok(delivery(crate::inbox::listening(&conversation), crate::host::is_running(&session.name)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_becomes_of_a_message() {
        assert_eq!(delivery(true, true), Delivery::Sent);
        // Followed from a window Omicron doesn't host (a plain `claude` with the add-on).
        assert_eq!(delivery(true, false), Delivery::Sent);
        assert_eq!(delivery(false, true), Delivery::Waiting);
        assert_eq!(delivery(false, false), Delivery::NotOpen);
    }
}
