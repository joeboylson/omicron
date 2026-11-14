//! The daemon's reactions to the change list (see `omicron::reactions`):
//! loops, runs, teams and dispatch, each wrapped to say which lines it
//! wants and how it runs.

use crate::{dispatch_cmd, loops_cmd, runs_cmd, teams_run};
use anyhow::Result;
use omicron::reactions::{Change, Reaction, Runs};
use omicron::supa::{MachineKey, Supabase};
use std::sync::Arc;

/// Loops due on this machine: kept in memory, so heard right away.
pub struct Loops(pub Arc<loops_cmd::Runner>);

impl Reaction for Loops {
    fn name(&self) -> &'static str {
        "loops"
    }
    fn wants(&self, c: &Change) -> bool {
        c.is(&["loops", "sessions", "machines"])
    }
    fn react(&self, c: &Change) -> Result<()> {
        self.0.heard(&c.row);
        Ok(())
    }
    fn runs(&self) -> Runs {
        Runs::Inline
    }
}

/// Runs going on this machine: a step when their task or a team's job moves.
pub struct RunSteps {
    pub supabase: Supabase,
    pub key: MachineKey,
}

impl Reaction for RunSteps {
    fn name(&self) -> &'static str {
        "runs"
    }
    fn wants(&self, c: &Change) -> bool {
        c.is(&["runs", "tasks", "jobs"])
    }
    fn react(&self, c: &Change) -> Result<()> {
        runs_cmd::heard(&self.supabase, &self.key, &c.row);
        Ok(())
    }
    fn runs(&self) -> Runs {
        Runs::InOrder
    }
}

/// Teams on this machine: leads started, jobs and answers passed on.
pub struct Teams {
    pub supabase: Supabase,
    pub key: MachineKey,
}

impl Reaction for Teams {
    fn name(&self) -> &'static str {
        "teams"
    }
    fn wants(&self, c: &Change) -> bool {
        c.is(&["teams", "jobs", "comments"])
    }
    fn react(&self, c: &Change) -> Result<()> {
        teams_run::heard(&self.supabase, &self.key, &c.row)
    }
}

/// Tasks dispatched to this machine.
pub struct Dispatch {
    pub supabase: Supabase,
    pub key: MachineKey,
    pub name: String,
}

impl Reaction for Dispatch {
    fn name(&self) -> &'static str {
        "dispatch"
    }
    fn wants(&self, c: &Change) -> bool {
        c.table == "dispatches" && c.kind == "INSERT"
    }
    fn react(&self, c: &Change) -> Result<()> {
        dispatch_cmd::carry_out(&self.supabase, &self.key, &self.name, &c.record)
    }
}
