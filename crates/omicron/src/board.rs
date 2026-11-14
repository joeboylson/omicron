//! Projects, statuses, labels, tasks and checklists, as the signed-in person
//! or machine. The database's access rules decide what's allowed; this only
//! shapes the requests and the answers.

use crate::supa::{Session, Supabase};
use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};

/// How many rows the database hands back per request at most (Supabase's
/// PGRST_DB_MAX_ROWS, 1,000 by default).
const PAGE: usize = 1000;

/// Someone signed in: a person, or a machine (which is how Claude sessions act).
#[derive(Clone)]
pub struct Board {
    supabase: Supabase,
    session: Session,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Project {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Status {
    pub id: String,
    pub name: String,
    pub position: f64,
    pub is_done: bool,
    #[serde(default)]
    pub color: Option<String>,
}

/// A Project's To do: its first status that isn't a done one, by position
/// then name. Runs work down it and team questions go in it.
pub fn to_do(statuses: &[Status]) -> Option<&Status> {
    statuses
        .iter()
        .filter(|s| !s.is_done)
        .min_by(|a, b| a.position.total_cmp(&b.position).then_with(|| a.name.cmp(&b.name)))
}

/// Whether a status counts as still being worked on, for a run: To do, or
/// one called Doing. Never a done one.
pub fn in_progress(statuses: &[Status], status_id: &str) -> bool {
    let first = to_do(statuses).map(|s| s.id.as_str());
    statuses.iter().any(|s| s.id == status_id && !s.is_done && (Some(s.id.as_str()) == first || s.name.eq_ignore_ascii_case("doing")))
}

/// The colors a status or label can have: Apple's system colors, by name.
pub const COLORS: &[&str] = &["red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink", "brown", "gray"];

fn check_color(color: &str) -> Result<String> {
    let c = color.to_ascii_lowercase();
    if !COLORS.contains(&c.as_str()) {
        bail!("{color} isn't one of the colors: {}", COLORS.join(", "));
    }
    Ok(c)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Task {
    pub id: String,
    pub number: i64,
    pub title: String,
    pub notes: String,
    pub status_id: String,
    /// Its place within its status (lower is higher up).
    pub position: f64,
    pub due_on: Option<String>,
    pub assignee: Option<String>,
    /// The Claude session it was sent to, if any.
    pub session: Option<String>,
    /// Its topic's name, if it has one.
    pub topic: Option<String>,
    pub needs_review: bool,
    pub labels: Vec<String>,
    pub checklist: Vec<ChecklistItem>,
    /// Who gave it to its session (a person's or machine's id), set by the database.
    pub given_by: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ChecklistItem {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub position: f64,
}

/// A person, with their Tailscale logins and the Projects you share with them.
#[derive(Debug, Clone, PartialEq)]
pub struct Person {
    pub id: String,
    pub name: String,
    pub logins: Vec<String>,
    pub projects: Vec<String>,
}

/// A machine, with the Projects you share with it.
#[derive(Debug, Clone, PartialEq)]
pub struct Machine {
    pub id: String,
    pub name: String,
    pub active: bool,
    pub all_projects: bool,
    pub projects: Vec<String>,
}

fn names(v: &Value, list: &str, inner: &str, field: &str) -> Vec<String> {
    let mut out: Vec<String> = v[list]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|r| if inner.is_empty() { r[field].as_str() } else { r[inner][field].as_str() }.map(String::from))
        .collect();
    out.sort_by_key(|n| n.to_lowercase());
    out
}

/// What a new task starts with.
#[derive(Debug, Default, Clone)]
pub struct NewTask {
    pub title: String,
    /// A status name; the Project's first status when left out.
    pub status: Option<String>,
    /// `YYYY-MM-DD`.
    pub due_on: Option<String>,
    /// Label names. Missing labels are made.
    pub labels: Vec<String>,
    /// A member's name.
    pub assignee: Option<String>,
    pub notes: String,
    /// A topic name. A missing topic is made.
    pub topic: Option<String>,
}

/// Encode a value for a URL query.
fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn check_date(d: &str) -> Result<()> {
    let ok = d.len() == 10
        && d.bytes().enumerate().all(|(i, b)| if i == 4 || i == 7 { b == b'-' } else { b.is_ascii_digit() });
    if !ok {
        bail!("dates look like 2026-11-30");
    }
    Ok(())
}

const TASK_FIELDS: &str = "id,number,title,notes,status_id,due_on,needs_review,position,given_by,\
assignee:people(display_name),session:sessions(name),topic:topics(name),task_labels(labels(name)),checklist_items(id,text,done,position)";

fn task_from(v: &Value) -> Result<Task> {
    let mut labels: Vec<String> = v["task_labels"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|l| l["labels"]["name"].as_str().map(String::from))
        .collect();
    labels.sort();
    let mut checklist: Vec<ChecklistItem> =
        serde_json::from_value(v["checklist_items"].clone()).unwrap_or_default();
    checklist.sort_by(|a, b| a.position.total_cmp(&b.position));
    Ok(Task {
        id: v["id"].as_str().context("task without id")?.to_string(),
        number: v["number"].as_i64().unwrap_or(0),
        title: v["title"].as_str().unwrap_or("").to_string(),
        notes: v["notes"].as_str().unwrap_or("").to_string(),
        status_id: v["status_id"].as_str().unwrap_or("").to_string(),
        position: v["position"].as_f64().unwrap_or(0.0),
        due_on: v["due_on"].as_str().map(String::from),
        assignee: v["assignee"]["display_name"].as_str().map(String::from),
        session: v["session"]["name"].as_str().map(String::from),
        topic: v["topic"]["name"].as_str().map(String::from),
        needs_review: v["needs_review"].as_bool().unwrap_or(false),
        labels,
        checklist,
        given_by: v["given_by"].as_str().map(String::from),
    })
}

/// A session's loop: a prompt typed into it every so often (see `loops`).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct Loop {
    pub id: String,
    pub session_id: String,
    pub machine_id: String,
    pub prompt: String,
    pub every_seconds: i64,
    pub until: Option<String>,
    pub times: Option<i64>,
    pub runs: i64,
    /// running, stopped or finished.
    pub state: String,
    pub note: Option<String>,
    pub next_run_at: String,
    /// Who started it: this machine, or someone elsewhere (who needs its gate open).
    #[serde(default)]
    pub started_by: Option<String>,
    pub last_run_at: Option<String>,
}

/// A team (see `teams_cmd`), as Supabase keeps it.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct TeamRow {
    pub id: String,
    pub project_id: String,
    pub machine_id: String,
    pub name: String,
    pub folder: String,
    pub workflow: String,
    pub state: String,
    #[serde(default)]
    pub session_id: Option<String>,
}

/// A folder: one path, on one machine, for one Project. Sessions start in one.
#[derive(Debug, Clone, PartialEq)]
pub struct Folder {
    pub id: String,
    pub machine_id: String,
    pub machine: String,
    pub project: String,
    pub path: String,
}

fn folder_from(v: &Value) -> Folder {
    let s = |k: &str| v[k].as_str().unwrap_or("").to_string();
    Folder {
        id: s("id"),
        machine_id: s("machine_id"),
        machine: v["machines"]["name"].as_str().unwrap_or("").to_string(),
        project: v["projects"]["name"].as_str().unwrap_or("").to_string(),
        path: s("path"),
    }
}

/// A run: one computer working down a Project's To do column in one
/// session (see `runs`).
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct Run {
    pub id: String,
    pub project_id: String,
    pub machine_id: String,
    pub session_id: Option<String>,
    pub label_id: Option<String>,
    /// running, pausing, stopped or finished.
    pub state: String,
    pub task_id: Option<String>,
    pub done: i64,
    pub note: Option<String>,
    pub started_by: String,
    pub started_at: String,
}

impl Run {
    /// Running, or finishing its task before it stops.
    pub fn active(&self) -> bool {
        matches!(self.state.as_str(), "running" | "pausing")
    }
}

/// A team's worker: a Claude session in one of its roles.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct Worker {
    pub name: String,
    pub role: String,
    /// starting, busy, idle, stopped, or gone.
    pub state: String,
    pub job_id: Option<String>,
}

/// A question a team member asked a person: a task in the team's Project,
/// open until its answer (a comment there) is passed back.
#[derive(Debug, Clone, Deserialize)]
pub struct TeamRequest {
    pub id: String,
    pub team_id: String,
    pub job_id: Option<String>,
    pub worker: String,
    pub task_id: String,
    pub created_at: String,
}

/// What `TaskRow` reads.
const TASK_ROW: &str = "id,number,title,status_id,assignee_person_id,assignee_session_id,task_labels(label_id),task_jobs(job_id)";

/// A task as a run looks at it: where it is, who has it, its labels and
/// whether a team has it.
#[derive(Debug, Clone, Deserialize)]
pub struct TaskRow {
    pub id: String,
    pub number: i64,
    #[serde(default)]
    pub title: String,
    pub status_id: String,
    #[serde(default)]
    pub assignee_person_id: Option<String>,
    #[serde(default)]
    pub assignee_session_id: Option<String>,
    #[serde(default)]
    task_labels: Vec<LabelRef>,
    #[serde(default)]
    task_jobs: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct LabelRef {
    label_id: String,
}

impl TaskRow {
    pub fn label_ids(&self) -> Vec<&str> {
        self.task_labels.iter().map(|l| l.label_id.as_str()).collect()
    }
    /// Linked to a team's job.
    pub fn has_job(&self) -> bool {
        !self.task_jobs.is_empty()
    }
}

/// A task linked to a job of a team on this machine.
#[derive(Debug, Clone)]
pub struct TeamTask {
    pub task: TaskRow,
    pub job_number: i64,
    pub job_state: String,
    pub team: String,
}

impl TeamTask {
    fn read(r: &Value) -> Option<TeamTask> {
        let job = &r["jobs"];
        Some(TeamTask {
            task: serde_json::from_value(r["tasks"].clone()).ok()?,
            job_number: job["number"].as_i64()?,
            job_state: job["state"].as_str()?.to_string(),
            team: job["teams"]["name"].as_str()?.to_string(),
        })
    }
}

/// A team's job.
#[derive(Debug, Clone, PartialEq, serde::Deserialize)]
pub struct Job {
    pub id: String,
    pub team_id: String,
    pub number: i64,
    pub title: String,
    pub text: String,
    pub state: String,
    pub step: Option<String>,
    pub note: Option<String>,
    /// Who added it: the team's machine, or someone elsewhere (who needs to
    /// own the machine, with its gate open).
    #[serde(default)]
    pub created_by: Option<String>,
}

/// Where to put a task in its status.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Place {
    Top,
    Bottom,
    Before(i64),
    After(i64),
}

/// Where a task goes among the others in its status: its new position, and
/// new positions for all the others first when two of them tie (tasks that
/// never had a place can't have anything put between them).
#[derive(Debug, PartialEq)]
pub struct Placement {
    pub renumbered: Vec<f64>,
    pub position: f64,
}

/// Place task #`number` among `others` ((number, position), in order).
pub fn placement(others: &[(i64, f64)], number: i64, place: Place) -> Result<Placement> {
    let mut spots: Vec<f64> = others.iter().map(|(_, p)| *p).collect();
    let renumbered = if spots.windows(2).any(|w| w[0] >= w[1]) {
        spots = (0..spots.len()).map(|i| i as f64).collect();
        spots.clone()
    } else {
        Vec::new()
    };
    let at = match place {
        Place::Top => 0,
        Place::Bottom => spots.len(),
        Place::Before(n) | Place::After(n) => {
            let i = others.iter().position(|(m, _)| *m == n).with_context(|| {
                if n == number {
                    "a task can't be placed next to itself".to_string()
                } else {
                    format!("#{n} isn't in that status")
                }
            })?;
            if matches!(place, Place::After(_)) { i + 1 } else { i }
        }
    };
    let position = match (at.checked_sub(1).map(|i| spots[i]), spots.get(at)) {
        (None, None) => 0.0,
        (None, Some(a)) => a - 1.0,
        (Some(b), None) => b + 1.0,
        (Some(b), Some(a)) => (b + *a) / 2.0,
    };
    Ok(Placement { renumbered, position })
}

/// A request to hand a task to its session (see `dispatch`).
#[derive(Debug, Clone, PartialEq)]
pub struct Dispatch {
    pub id: String,
    pub task_id: String,
    pub session_id: String,
    pub machine_id: String,
    /// pending, claimed, done or failed.
    pub state: String,
    pub result: Option<String>,
    pub error: Option<String>,
}

pub fn dispatch_from(v: &Value) -> Result<Dispatch> {
    let text = |k: &str| v[k].as_str().unwrap_or("").to_string();
    Ok(Dispatch {
        id: v["id"].as_str().context("request without id")?.to_string(),
        task_id: text("task_id"),
        session_id: text("session_id"),
        machine_id: text("machine_id"),
        state: text("state"),
        result: v["result"].as_str().map(String::from),
        error: v["error"].as_str().map(String::from),
    })
}

/// A comment on a task. `session` names the Claude session that wrote it.
#[derive(Debug, Clone, PartialEq)]
pub struct Comment {
    pub author: String,
    pub session: Option<String>,
    pub body: String,
    pub at: String,
    /// Its images' paths in the `comment-images` bucket.
    pub images: Vec<String>,
}

/// Where comments' images are kept.
pub const IMAGES_BUCKET: &str = "comment-images";
const IMAGE_LIMIT: u64 = 10 * 1024 * 1024;

/// The kind of image a file is, from its name: png, jpeg, gif or webp.
pub fn image_type(path: &std::path::Path) -> Result<&'static str> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    Ok(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => bail!("{} isn't an image Omicron keeps (PNG, JPEG, GIF or WebP)", path.display()),
    })
}

/// The file name an image was added with (its path ends `<random>-<name>`).
pub fn image_name(path: &str) -> &str {
    let file = path.rsplit('/').next().unwrap_or(path);
    file.split_once('-').map_or(file, |(_, name)| name)
}

/// A handoff note (see `omicron handoff`).
#[derive(Debug, Clone, PartialEq)]
pub struct Handoff {
    pub id: String,
    pub number: i64,
    pub project: String,
    pub session: Option<String>,
    pub state: String,
    pub written_at: String,
    pub body: String,
}

const HANDOFF_FIELDS: &str = "id,number,state,written_at,body,projects(name),sessions(name)";

fn handoff_from(v: &Value) -> Handoff {
    Handoff {
        id: v["id"].as_str().unwrap_or("").to_string(),
        number: v["number"].as_i64().unwrap_or(0),
        project: v["projects"]["name"].as_str().unwrap_or("").to_string(),
        session: v["sessions"]["name"].as_str().map(String::from),
        state: v["state"].as_str().unwrap_or("").to_string(),
        written_at: v["written_at"].as_str().unwrap_or("").to_string(),
        body: v["body"].as_str().unwrap_or("").to_string(),
    }
}

/// A Claude session's record (see `windows` for the local side).
#[derive(Debug, Clone, PartialEq)]
pub struct SessionRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub project: String,
    pub machine_id: String,
    pub machine: String,
    pub state: String,
    pub claude_session_id: Option<String>,
    pub folder: String,
    /// Why it's gone, when it is.
    pub gone_why: Option<String>,
}

const SESSION_FIELDS: &str = "id,project_id,machine_id,name,state,gone_why,claude_session_id,folder,projects(name),machines(name)";

fn session_from(v: &Value) -> Result<SessionRecord> {
    Ok(SessionRecord {
        id: v["id"].as_str().context("session without id")?.to_string(),
        project_id: v["project_id"].as_str().unwrap_or("").to_string(),
        name: v["name"].as_str().unwrap_or("").to_string(),
        project: v["projects"]["name"].as_str().unwrap_or("").to_string(),
        machine_id: v["machine_id"].as_str().unwrap_or("").to_string(),
        machine: v["machines"]["name"].as_str().unwrap_or("").to_string(),
        state: v["state"].as_str().unwrap_or("").to_string(),
        claude_session_id: v["claude_session_id"].as_str().map(String::from),
        folder: v["folder"].as_str().unwrap_or("").to_string(),
        gone_why: v["gone_why"].as_str().map(String::from),
    })
}

impl Board {
    /// Signed in as this machine, with its key (the daemon, the web page's
    /// server and `omicron` commands all sign in this one way).
    pub fn as_machine(supabase: &Supabase, key: &crate::supa::MachineKey) -> Result<Board> {
        Ok(Board { supabase: supabase.clone(), session: supabase.sign_in_machine(key)? })
    }

    /// On a login already made (like the web page's, for the person using it).
    pub fn signed_in(supabase: &Supabase, session: &Session) -> Board {
        Board { supabase: supabase.clone(), session: session.clone() }
    }

    /// Who's signed in: a person's or a machine's id.
    pub fn me(&self) -> String {
        self.session.user.id.to_string()
    }

    /// The login itself (for Realtime, which listens on it).
    pub fn login(&self) -> &Session {
        &self.session
    }

    /// The Supabase it talks to (for what needs the secret key).
    pub fn supabase(&self) -> &Supabase {
        &self.supabase
    }

    /// The change list's lines from the last moment (in case one finished
    /// saving late; see `changes`).
    pub fn recent_changes(&self) -> Result<Vec<Value>> {
        Ok(self.send("POST", "/rest/v1/rpc/recent_changes", json!({}))?.as_array().cloned().unwrap_or_default())
    }

    /// The newest change line's number, if there are any.
    pub fn newest_change(&self) -> Result<Option<i64>> {
        Ok(self.get("/rest/v1/changes?select=seq&order=seq.desc&limit=1")?.get(0).and_then(|r| r["seq"].as_i64()))
    }

    /// Up to `limit` change lines after `seq`, in order.
    pub fn changes_after(&self, seq: i64, limit: usize) -> Result<Vec<Value>> {
        Ok(self.get(&format!("/rest/v1/changes?seq=gt.{seq}&order=seq.asc&limit={limit}"))?.as_array().cloned().unwrap_or_default())
    }

    /// Tell Omicron when this machine's gate closes (None: it's closed), for
    /// pages to show. Display only: the machine decides from its own file.
    pub fn report_gate(&self, until: Option<String>) -> Result<()> {
        self.send("POST", "/rest/v1/rpc/machine_report_gate", json!({ "until": until }))?;
        Ok(())
    }

    /// Read rows. The database hands back at most a page of rows per
    /// request (1,000 in Supabase's settings), so a list that fills a page
    /// is read on, page by page, until it's all there. (A request with its
    /// own `limit=` is taken as asked.)
    fn get(&self, path: &str) -> Result<Value> {
        let first = self.supabase.request_as(&self.session, "GET", path, None)?;
        let Some(rows) = first.as_array() else { return Ok(first) };
        if path.contains("limit=") || rows.len() < PAGE || !path.starts_with("/rest/v1/") {
            return Ok(first);
        }
        let mut all = rows.clone();
        let join = if path.contains('?') { '&' } else { '?' };
        loop {
            let more = self.supabase.request_as(&self.session, "GET", &format!("{path}{join}offset={}&limit={PAGE}", all.len()), None)?;
            let more = more.as_array().cloned().unwrap_or_default();
            let full = more.len() == PAGE;
            all.extend(more);
            if !full {
                return Ok(Value::Array(all));
            }
        }
    }

    fn send(&self, method: &str, path: &str, body: Value) -> Result<Value> {
        self.supabase.request_as(&self.session, method, path, Some(body))
    }

    pub fn projects(&self) -> Result<Vec<Project>> {
        Ok(serde_json::from_value(self.get("/rest/v1/projects?select=id,name&order=name")?)?)
    }

    /// A Project by name (any case) or id.
    pub fn project(&self, name_or_id: &str) -> Result<Project> {
        let all = self.projects()?;
        let hits: Vec<&Project> =
            all.iter().filter(|p| p.id == name_or_id || p.name.eq_ignore_ascii_case(name_or_id)).collect();
        match hits.as_slice() {
            [one] => Ok((*one).clone()),
            [] => bail!("no Project called {name_or_id} (or you aren't in it)"),
            _ => bail!("more than one Project is called {name_or_id}. Use its id."),
        }
    }

    /// Sessions in one Project, or in every Project this login can see.
    pub fn sessions(&self, project: Option<&Project>) -> Result<Vec<SessionRecord>> {
        let only = project.map(|p| format!("&project_id=eq.{}", p.id)).unwrap_or_default();
        let rows = self.get(&format!("/rest/v1/sessions?select={SESSION_FIELDS}{only}&order=name"))?;
        rows.as_array().map(|a| a.iter().map(session_from).collect()).unwrap_or(Ok(Vec::new()))
    }

    /// Folders: one Project's, or all you can see, by machine then path.
    pub fn folders(&self, project: Option<&Project>) -> Result<Vec<Folder>> {
        let only = project.map(|p| format!("&project_id=eq.{}", p.id)).unwrap_or_default();
        let rows = self.get(&format!("/rest/v1/folders?select=id,machine_id,path,projects(name),machines(name){only}&order=path"))?;
        let mut all: Vec<Folder> = rows.as_array().into_iter().flatten().map(folder_from).collect();
        all.sort_by(|a, b| (&a.machine, &a.path).cmp(&(&b.machine, &b.path)));
        Ok(all)
    }

    /// Add a folder on this machine for a Project (only machines can). A path
    /// already added moves to this Project. Returns it.
    pub fn add_folder(&self, project: &Project, path: &str) -> Result<Folder> {
        let rows = self.supabase.call_as(
            &self.session,
            "POST",
            "/rest/v1/folders?on_conflict=machine_id,path&select=id,machine_id,path,projects(name),machines(name)",
            json!({ "project_id": project.id, "path": path }),
            "return=representation,resolution=merge-duplicates",
        )?;
        rows.get(0).map(folder_from).context("the folder wasn't saved")
    }

    /// Take a folder off the list. True if there was one.
    pub fn remove_folder(&self, folder: &Folder) -> Result<bool> {
        let rows = self.supabase.request_as(&self.session, "DELETE", &format!("/rest/v1/folders?id=eq.{}", folder.id), None)?;
        Ok(rows.as_array().is_some_and(|a| !a.is_empty()))
    }

    pub fn session(&self, project: &Project, name: &str) -> Result<SessionRecord> {
        self.sessions(Some(project))?
            .into_iter()
            .find(|s| s.name.eq_ignore_ascii_case(name))
            .with_context(|| format!("no session called {name} in {}", project.name))
    }

    /// Add a session for this machine (only machines can).
    pub fn add_session(&self, project: &Project, name: &str, claude_session_id: &str, folder: &str) -> Result<SessionRecord> {
        let rows = self.send(
            "POST",
            &format!("/rest/v1/sessions?select={SESSION_FIELDS}"),
            json!({ "project_id": project.id, "name": name, "claude_session_id": claude_session_id, "folder": folder }),
        )?;
        session_from(rows.get(0).context("the session wasn't added")?)
    }

    /// Change a session's fields. Running it twice is fine.
    pub fn rename_session(&self, id: &str, name: &str) -> Result<()> {
        self.update_session(id, json!({ "name": name }))
    }

    /// The Claude conversation a session is in now.
    pub fn session_conversation(&self, id: &str, claude_session_id: &str) -> Result<()> {
        self.update_session(id, json!({ "claude_session_id": claude_session_id }))
    }

    /// Changes worked out from a window starting or ending (sessions_cmd).
    pub fn update_session(&self, id: &str, change: Value) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/sessions?id=eq.{id}"), change)?;
        Ok(())
    }

    /// A session ended: its record goes (its tasks stay, flagged with its
    /// name). Already gone is fine.
    pub fn end_session(&self, id: &str) -> Result<()> {
        self.supabase.request_as(&self.session, "DELETE", &format!("/rest/v1/sessions?id=eq.{id}"), None)?;
        Ok(())
    }

    pub fn remove_session(&self, project: &Project, name: &str) -> Result<()> {
        let s = self.session(project, name)?;
        self.supabase.request_as(&self.session, "DELETE", &format!("/rest/v1/sessions?id=eq.{}", s.id), None)?;
        Ok(())
    }

    pub fn start_project(&self, name: &str) -> Result<Project> {
        Ok(serde_json::from_value(self.send("POST", "/rest/v1/rpc/start_project", json!({ "name": name }))?)?)
    }

    pub fn statuses(&self, project: &Project) -> Result<Vec<Status>> {
        Ok(serde_json::from_value(self.get(&format!(
            "/rest/v1/statuses?project_id=eq.{}&select=id,name,position,is_done,color&order=position,name",
            project.id
        ))?)?)
    }

    /// Add a status at the end. `done` makes it the Project's Done status.
    /// Add a status. A new Done status goes at the end; any other goes just
    /// before the Done status, so Done stays last (as on the web page).
    pub fn add_status(&self, project: &Project, name: &str, done: bool) -> Result<Status> {
        let all = self.statuses(project)?;
        let last = all.iter().map(|s| s.position).fold(0.0, f64::max);
        let position = match all.iter().find(|s| s.is_done) {
            Some(d) if !done => {
                let before = all.iter().filter(|s| !s.is_done && s.position < d.position).map(|s| s.position).fold(f64::MIN, f64::max);
                if before == f64::MIN { d.position - 1.0 } else { (before + d.position) / 2.0 }
            }
            _ => last + 1.0,
        };
        let rows = self.send(
            "POST",
            "/rest/v1/statuses?select=id,name,position,is_done,color",
            json!({ "project_id": project.id, "name": name, "position": position, "is_done": done }),
        )?;
        Ok(serde_json::from_value(rows[0].clone())?)
    }

    fn status_named(&self, project: &Project, name: &str) -> Result<Status> {
        let all = self.statuses(project)?;
        all.iter().find(|s| s.name.eq_ignore_ascii_case(name)).cloned().ok_or_else(|| {
            let names: Vec<&str> = all.iter().map(|s| s.name.as_str()).collect();
            anyhow!("{} has no status called {name}. It has: {}", project.name, names.join(", "))
        })
    }

    /// Give a status a color.
    pub fn color_status(&self, project: &Project, status: &str, color: &str) -> Result<()> {
        let color = check_color(color)?;
        let s = self
            .statuses(project)?
            .into_iter()
            .find(|s| s.name.eq_ignore_ascii_case(status))
            .with_context(|| format!("{} has no status called {status}", project.name))?;
        self.send("PATCH", &format!("/rest/v1/statuses?id=eq.{}", s.id), json!({ "color": color }))?;
        Ok(())
    }

    /// A Project's labels and their colors.
    pub fn labels(&self, project: &Project) -> Result<Vec<(String, Option<String>)>> {
        let rows = self.get(&format!("/rest/v1/labels?project_id=eq.{}&select=name,color&order=name", project.id))?;
        Ok(rows
            .as_array()
            .into_iter()
            .flatten()
            .map(|r| (r["name"].as_str().unwrap_or("").to_string(), r["color"].as_str().map(String::from)))
            .collect())
    }

    /// Give a label a color (making the label if it doesn't exist).
    pub fn color_label(&self, project: &Project, label: &str, color: &str) -> Result<()> {
        let color = check_color(color)?;
        let id = self.label_id(project, label)?;
        self.send("PATCH", &format!("/rest/v1/labels?id=eq.{id}"), json!({ "color": color }))?;
        Ok(())
    }

    pub fn rename_label(&self, project: &Project, name: &str, new_name: &str) -> Result<()> {
        let id = self.existing_label(project, name)?;
        if self.labels(project)?.iter().any(|(n, _)| n.eq_ignore_ascii_case(new_name.trim()) && !n.eq_ignore_ascii_case(name)) {
            bail!("{} already has a label called {}", project.name, new_name.trim());
        }
        self.send("PATCH", &format!("/rest/v1/labels?id=eq.{id}"), json!({ "name": new_name.trim() }))?;
        Ok(())
    }

    /// Remove a label; it comes off every task that has it. Returns how many.
    pub fn remove_label(&self, project: &Project, name: &str) -> Result<usize> {
        let id = self.existing_label(project, name)?;
        let used = self.get(&format!("/rest/v1/task_labels?label_id=eq.{id}&select=task_id"))?;
        self.supabase.request_as(&self.session, "DELETE", &format!("/rest/v1/labels?id=eq.{id}"), None)?;
        Ok(used.as_array().map_or(0, |a| a.len()))
    }

    fn existing_label(&self, project: &Project, name: &str) -> Result<String> {
        let rows = self.get(&format!("/rest/v1/labels?project_id=eq.{}&select=id,name", project.id))?;
        rows.as_array()
            .into_iter()
            .flatten()
            .find(|r| r["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(name.trim())))
            .and_then(|r| r["id"].as_str().map(String::from))
            .with_context(|| format!("{} has no label called {name}", project.name))
    }

    pub fn label_id(&self, project: &Project, name: &str) -> Result<String> {
        let found = self.get(&format!("/rest/v1/labels?project_id=eq.{}&name=eq.{}&select=id", project.id, enc(name)))?;
        if let Some(id) = found.get(0).and_then(|r| r["id"].as_str()) {
            return Ok(id.to_string());
        }
        let made = self.send("POST", "/rest/v1/labels?select=id", json!({ "project_id": project.id, "name": name }))?;
        Ok(made[0]["id"].as_str().context("label wasn't made")?.to_string())
    }

    /// A Project's topics, in board order.
    pub fn topics(&self, project: &Project) -> Result<Vec<String>> {
        let rows = self.get(&format!("/rest/v1/topics?project_id=eq.{}&select=name&order=position,name", project.id))?;
        Ok(rows.as_array().into_iter().flatten().filter_map(|r| r["name"].as_str().map(String::from)).collect())
    }

    pub fn add_topic(&self, project: &Project, name: &str) -> Result<()> {
        if self.topics(project)?.iter().any(|t| t.eq_ignore_ascii_case(name)) {
            bail!("{} already has a topic called {name}", project.name);
        }
        self.send("POST", "/rest/v1/topics", json!({ "project_id": project.id, "name": name.trim() }))?;
        Ok(())
    }

    pub fn rename_topic(&self, project: &Project, name: &str, new_name: &str) -> Result<()> {
        let id = self.topic_id(project, name, false)?;
        self.send("PATCH", &format!("/rest/v1/topics?id=eq.{id}"), json!({ "name": new_name.trim() }))?;
        Ok(())
    }

    /// Remove a topic. Its tasks are kept, without a topic.
    pub fn remove_topic(&self, project: &Project, name: &str) -> Result<()> {
        let id = self.topic_id(project, name, false)?;
        self.supabase.request_as(&self.session, "DELETE", &format!("/rest/v1/topics?id=eq.{id}"), None)?;
        Ok(())
    }

    /// Give a task a topic (made if missing), or take its topic off (None).
    pub fn set_topic(&self, project: &Project, number: i64, topic: Option<&str>) -> Result<Task> {
        let task = self.task(project, number)?;
        let id = topic.map(|n| self.topic_id(project, n, true)).transpose()?;
        self.update_task(&task, json!({ "topic_id": id }))?;
        self.task(project, number)
    }

    fn topic_id(&self, project: &Project, name: &str, make: bool) -> Result<String> {
        let rows = self.get(&format!("/rest/v1/topics?project_id=eq.{}&select=id,name", project.id))?;
        if let Some(id) = rows
            .as_array()
            .into_iter()
            .flatten()
            .find(|r| r["name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(name.trim())))
            .and_then(|r| r["id"].as_str())
        {
            return Ok(id.to_string());
        }
        if !make {
            bail!("{} has no topic called {name}", project.name);
        }
        let made = self.send("POST", "/rest/v1/topics?select=id", json!({ "project_id": project.id, "name": name.trim() }))?;
        Ok(made[0]["id"].as_str().context("topic wasn't made")?.to_string())
    }

    fn member_id(&self, project: &Project, name: &str) -> Result<String> {
        let rows = self.get(&format!(
            "/rest/v1/project_members?project_id=eq.{}&select=person_id,people(display_name)",
            project.id
        ))?;
        let hits: Vec<&Value> = rows
            .as_array()
            .into_iter()
            .flatten()
            .filter(|r| r["people"]["display_name"].as_str().is_some_and(|n| n.eq_ignore_ascii_case(name)))
            .collect();
        match hits.as_slice() {
            [one] => Ok(one["person_id"].as_str().unwrap_or_default().to_string()),
            [] => bail!("nobody called {name} is in {}", project.name),
            _ => bail!("more than one member of {} is called {name}", project.name),
        }
    }

    /// Everyone you can see: yourself, and everyone else once you're in a Project.
    pub fn people(&self) -> Result<Vec<Person>> {
        let rows = self.get("/rest/v1/people?select=id,display_name,tailscale_identities(login),project_members(projects(name))&order=display_name")?;
        Ok(rows
            .as_array()
            .into_iter()
            .flatten()
            .map(|r| Person {
                id: r["id"].as_str().unwrap_or_default().to_string(),
                name: r["display_name"].as_str().unwrap_or_default().to_string(),
                logins: names(r, "tailscale_identities", "", "login"),
                projects: names(r, "project_members", "projects", "name"),
            })
            .collect())
    }

    /// A person by name (any case), Tailscale login, or id.
    pub fn person(&self, who: &str) -> Result<Person> {
        let all = self.people()?;
        let hits: Vec<&Person> = all
            .iter()
            .filter(|p| p.id == who || p.name.eq_ignore_ascii_case(who) || p.logins.iter().any(|l| l.eq_ignore_ascii_case(who)))
            .collect();
        match hits.as_slice() {
            [one] => Ok((*one).clone()),
            [] => bail!("nobody called {who} (people show up after they first sign in)"),
            _ => bail!("more than one person is called {who}. Use their Tailscale login."),
        }
    }

    pub fn add_member(&self, project: &Project, person: &Person) -> Result<()> {
        if person.projects.iter().any(|p| p == &project.name) {
            return Ok(());
        }
        self.send("POST", "/rest/v1/project_members", json!({ "project_id": project.id, "person_id": person.id }))?;
        Ok(())
    }

    pub fn remove_member(&self, project: &Project, person: &Person) -> Result<()> {
        let gone = self.supabase.request_as(
            &self.session,
            "DELETE",
            &format!("/rest/v1/project_members?project_id=eq.{}&person_id=eq.{}", project.id, person.id),
            None,
        )?;
        if gone.as_array().is_some_and(|a| a.is_empty()) {
            bail!("{} isn't in {}", person.name, project.name);
        }
        Ok(())
    }

    pub fn machines(&self) -> Result<Vec<Machine>> {
        let rows = self.get("/rest/v1/machines?select=id,name,active,all_projects,project_machines(projects(name))&order=name")?;
        Ok(rows
            .as_array()
            .into_iter()
            .flatten()
            .map(|r| Machine {
                id: r["id"].as_str().unwrap_or_default().to_string(),
                name: r["name"].as_str().unwrap_or_default().to_string(),
                active: r["active"].as_bool().unwrap_or(false),
                all_projects: r["all_projects"].as_bool().unwrap_or(false),
                projects: names(r, "project_machines", "projects", "name"),
            })
            .collect())
    }

    pub fn machine(&self, name_or_id: &str) -> Result<Machine> {
        self.machines()?
            .into_iter()
            .find(|m| m.id == name_or_id || m.name.eq_ignore_ascii_case(name_or_id))
            .with_context(|| format!("no machine called {name_or_id}"))
    }

    pub fn add_machine(&self, project: &Project, machine: &Machine) -> Result<()> {
        if machine.projects.iter().any(|p| p == &project.name) {
            return Ok(());
        }
        self.send("POST", "/rest/v1/project_machines", json!({ "project_id": project.id, "machine_id": machine.id }))?;
        Ok(())
    }

    pub fn remove_machine(&self, project: &Project, machine: &Machine) -> Result<()> {
        let gone = self.supabase.request_as(
            &self.session,
            "DELETE",
            &format!("/rest/v1/project_machines?project_id=eq.{}&machine_id=eq.{}", project.id, machine.id),
            None,
        )?;
        if gone.as_array().is_some_and(|a| a.is_empty()) {
            bail!("{} isn't in {}", machine.name, project.name);
        }
        Ok(())
    }

    pub fn tasks(&self, project: &Project) -> Result<Vec<Task>> {
        let rows = self.get(&format!("/rest/v1/tasks?project_id=eq.{}&select={TASK_FIELDS}&order=position,number", project.id))?;
        rows.as_array().into_iter().flatten().map(task_from).collect()
    }

    pub fn task(&self, project: &Project, number: i64) -> Result<Task> {
        let rows = self.get(&format!("/rest/v1/tasks?project_id=eq.{}&number=eq.{number}&select={TASK_FIELDS}", project.id))?;
        task_from(rows.get(0).with_context(|| format!("{} has no task #{number}", project.name))?)
    }

    pub fn add_task(&self, project: &Project, new: &NewTask) -> Result<Task> {
        let status = match &new.status {
            Some(name) => self.status_named(project, name)?,
            None => self.statuses(project)?.into_iter().next().context("this Project has no statuses")?,
        };
        if let Some(d) = &new.due_on {
            check_date(d)?;
        }
        let assignee = new.assignee.as_deref().map(|n| self.member_id(project, n)).transpose()?;
        let topic = new.topic.as_deref().map(|n| self.topic_id(project, n, true)).transpose()?;
        // At the bottom of its status, as on the web page.
        let position = self
            .tasks(project)?
            .iter()
            .filter(|t| t.status_id == status.id)
            .map(|t| t.position)
            .fold(None, |m: Option<f64>, p| Some(m.map_or(p, |m| m.max(p))))
            .map_or(0.0, |m| m + 1.0);
        let rows = self.send(
            "POST",
            "/rest/v1/tasks?select=id,number",
            json!({
                "project_id": project.id, "title": new.title, "status_id": status.id,
                "due_on": new.due_on, "assignee_person_id": assignee, "notes": new.notes,
                "topic_id": topic, "position": position,
            }),
        )?;
        let id = rows[0]["id"].as_str().context("task wasn't made")?.to_string();
        let number = rows[0]["number"].as_i64().unwrap_or(0);
        for label in &new.labels {
            let label_id = self.label_id(project, label)?;
            self.send("POST", "/rest/v1/task_labels", json!({ "task_id": id, "label_id": label_id }))?;
        }
        self.task(project, number)
    }

    fn update_task(&self, task: &Task, fields: Value) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/tasks?id=eq.{}", task.id), fields)?;
        Ok(())
    }

    /// Move a task to a status (its own if None), at a place in it: the
    /// bottom unless `place` says otherwise.
    pub fn move_task(&self, project: &Project, number: i64, status: &str) -> Result<Task> {
        self.place_task(project, number, Some(status), Place::Bottom)
    }

    pub fn place_task(&self, project: &Project, number: i64, status: Option<&str>, place: Place) -> Result<Task> {
        let task = self.task(project, number)?;
        let status_id = match status {
            Some(name) => self.status_named(project, name)?.id,
            None => task.status_id.clone(),
        };
        let mut others: Vec<Task> =
            self.tasks(project)?.into_iter().filter(|t| t.status_id == status_id && t.id != task.id).collect();
        others.sort_by(|a, b| a.position.total_cmp(&b.position).then(a.number.cmp(&b.number)));
        let spots: Vec<(i64, f64)> = others.iter().map(|t| (t.number, t.position)).collect();
        let placed = placement(&spots, number, place)?;
        for (i, p) in placed.renumbered.iter().enumerate() {
            others[i].position = *p;
            self.update_task(&others[i], json!({ "position": p }))?;
        }
        let position = placed.position;
        self.update_task(&task, json!({ "status_id": status_id, "position": position }))?;
        self.task(project, number)
    }

    /// Move a task to the Project's Done status.
    pub fn finish_task(&self, project: &Project, number: i64) -> Result<Task> {
        let done = self.statuses(project)?.into_iter().find(|s| s.is_done).context("this Project has no Done status")?;
        self.move_task(project, number, &done.name)
    }

    /// Put the Needs review mark on (`true`, machines only) or take it off.
    /// A Project's runs, newest first.
    pub fn runs(&self, project: &Project) -> Result<Vec<Run>> {
        Ok(serde_json::from_value(self.get(&format!("/rest/v1/runs?project_id=eq.{}&order=started_at.desc&limit=50", project.id))?)?)
    }

    pub fn run(&self, id: &str) -> Result<Option<Run>> {
        let rows: Vec<Run> = serde_json::from_value(self.get(&format!("/rest/v1/runs?id=eq.{id}"))?)?;
        Ok(rows.into_iter().next())
    }

    /// Active runs on the machine signed in.
    pub fn my_active_runs(&self) -> Result<Vec<Run>> {
        Ok(serde_json::from_value(self.get(&format!("/rest/v1/runs?machine_id=eq.{}&state=in.(running,pausing)", self.session.user.id))?)?)
    }

    /// Start a run in a session, optionally only tasks with a label.
    pub fn start_run(&self, project: &Project, session: &SessionRecord, label: Option<&str>) -> Result<Run> {
        let label_id = match label {
            Some(name) => {
                let rows = self.get(&format!("/rest/v1/labels?project_id=eq.{}&name=ilike.{}&select=id", project.id, crate::supa::enc(name)))?;
                Some(rows.get(0).and_then(|r| r["id"].as_str()).map(String::from).with_context(|| format!("{} has no label {name}", project.name))?)
            }
            None => None,
        };
        let rows = self.send(
            "POST",
            "/rest/v1/runs",
            json!({ "project_id": project.id, "machine_id": session.machine_id, "session_id": session.id, "label_id": label_id }),
        );
        let rows = match rows {
            Err(e) if format!("{e:#}").contains("runs_one_per_session") => bail!("{} is already on a run", session.name),
            r => r?,
        };
        Ok(serde_json::from_value(rows.get(0).context("the run wasn't saved")?.clone())?)
    }

    /// Change a run (its machine: anything; anyone else: pausing or stopped).
    fn set_run(&self, id: &str, fields: Value) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/runs?id=eq.{id}"), fields)?;
        Ok(())
    }

    /// Ask a run to pause after its task ("pausing") or stop now ("stopped").
    pub fn ask_run_to(&self, id: &str, state: &str) -> Result<()> {
        self.set_run(id, json!({ "state": state }))
    }

    /// A run stops, saying why.
    pub fn stop_run(&self, id: &str, note: &str) -> Result<()> {
        self.set_run(id, json!({ "state": "stopped", "note": note }))
    }

    /// A run has nothing left: it's finished.
    pub fn finish_run(&self, id: &str, note: &str) -> Result<()> {
        self.set_run(id, json!({ "state": "finished", "note": note }))
    }

    /// A run is on a task now.
    pub fn run_on(&self, id: &str, task_id: &str, note: &str) -> Result<()> {
        self.set_run(id, json!({ "task_id": task_id, "note": note }))
    }

    /// A run's task is finished (`done` counts it), and the run carries on
    /// or, with `stop`, stops there.
    pub fn run_task_finished(&self, id: &str, done: i64, stop: bool, note: &str) -> Result<()> {
        let mut change = json!({ "task_id": null, "done": done, "note": note });
        if stop {
            change["state"] = json!("stopped");
        }
        self.set_run(id, change)
    }

    /// What a run says it's doing, nothing else changed.
    pub fn run_note(&self, id: &str, note: &str) -> Result<()> {
        self.set_run(id, json!({ "note": note }))
    }

    /// A task by id, with its status id, assignees and labels (ids).
    pub fn task_row(&self, id: &str) -> Result<Option<TaskRow>> {
        let rows = self.get(&format!("/rest/v1/tasks?id=eq.{id}&select={TASK_ROW}"))?;
        Ok(serde_json::from_value::<Vec<TaskRow>>(rows)?.into_iter().next())
    }

    /// A Project's tasks in a status, in their order (see `task_row`).
    pub fn task_rows_in(&self, project_id: &str, status_id: &str) -> Result<Vec<TaskRow>> {
        let rows = self.get(&format!("/rest/v1/tasks?project_id=eq.{project_id}&status_id=eq.{status_id}&select={TASK_ROW}&order=position,number"))?;
        Ok(serde_json::from_value(rows)?)
    }

    /// A Project's tasks linked to jobs of teams on the machine signed in.
    pub fn team_tasks_here(&self, project_id: &str) -> Result<Vec<TeamTask>> {
        let rows = self.get(&format!(
            "/rest/v1/task_jobs?select=tasks!inner(id,number,title,status_id,project_id,assignee_session_id),jobs!inner(number,state,teams!inner(name,machine_id))&tasks.project_id=eq.{project_id}&jobs.teams.machine_id=eq.{}",
            self.session.user.id
        ))?;
        Ok(rows.as_array().into_iter().flatten().filter_map(TeamTask::read).collect())
    }

    /// A Project's run rules (empty if it has none).
    pub fn run_rules(&self, project: &Project) -> Result<String> {
        let rows = self.get(&format!("/rest/v1/projects?id=eq.{}&select=run_rules", project.id))?;
        Ok(rows.get(0).and_then(|r| r["run_rules"].as_str()).unwrap_or("").to_string())
    }

    pub fn set_run_rules(&self, project: &Project, rules: &str) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/projects?id=eq.{}", project.id), json!({ "run_rules": rules }))?;
        Ok(())
    }

    /// Who owns the machine signed in (only they can send it orders), if anyone.
    pub fn machine_owner(&self) -> Result<Option<String>> {
        let rows = self.get(&format!("/rest/v1/machines?id=eq.{}&select=owner", self.session.user.id))?;
        Ok(rows.get(0).and_then(|r| r["owner"].as_str()).map(String::from))
    }

    /// Give a task to a Claude session in the same Project. The session gets
    /// it when told to get its tasks (`omicron tasks mine`) or by Dispatch.
    /// Giving it again makes it new again, given by whoever gave it last
    /// (the database sets who; `given_by` here only says "anew").
    pub fn send_task(&self, project: &Project, number: i64, session: &str) -> Result<Task> {
        let task = self.task(project, number)?;
        let s = self.session(project, session)?;
        self.give_anew(&task.id, Some(&s.id))?;
        self.task(project, number)
    }

    /// The one way Omicron gives a task to a session: to `session`, or anew
    /// to the session it's with. It's new again to that session, given by
    /// whoever this board is signed in as: the database sets who (0026's
    /// task_given_by trigger); writing `given_by` here only says "anew".
    /// Signed in as a machine, the session takes it as its own machine's
    /// order, gate or not. (The web page's own assigning is separate.)
    pub fn give_anew(&self, task_id: &str, session: Option<&str>) -> Result<()> {
        let change = match session {
            Some(s) => json!({ "assignee_session_id": s, "assignee_person_id": null, "given_by": null }),
            None => json!({ "given_by": null }),
        };
        self.send("PATCH", &format!("/rest/v1/tasks?id=eq.{task_id}"), change)?;
        Ok(())
    }

    /// The tasks given to a session that aren't done, oldest first, with
    /// their Project's name.
    pub fn session_tasks(&self, session_id: &str) -> Result<Vec<(String, Task)>> {
        let rows = self.get(&format!(
            "/rest/v1/tasks?assignee_session_id=eq.{session_id}&select={TASK_FIELDS},projects(name),statuses!inner(is_done)&statuses.is_done=eq.false&order=created_at"
        ))?;
        rows.as_array()
            .into_iter()
            .flatten()
            .map(|v| Ok((v["projects"]["name"].as_str().unwrap_or("").to_string(), task_from(v)?)))
            .collect()
    }

    /// Take the tasks sent to a session that it hasn't picked up yet, marking
    /// them picked up: only the ones its own machine gave it, unless this
    /// computer's gate is open. Returns (Project name, task) pairs.
    pub fn pick_up_tasks(&self, session_id: &str, gate_open: bool) -> Result<Vec<(String, Task)>> {
        let taken = self.send("POST", "/rest/v1/rpc/pick_up_tasks?select=id", json!({ "session": session_id, "gate_open": gate_open }))?;
        let ids: Vec<&str> = taken.as_array().into_iter().flatten().filter_map(|t| t["id"].as_str()).collect();
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = self.get(&format!(
            "/rest/v1/tasks?id=in.({})&select={TASK_FIELDS},projects(name)&order=number",
            ids.join(",")
        ))?;
        rows.as_array()
            .into_iter()
            .flatten()
            .map(|v| Ok((v["projects"]["name"].as_str().unwrap_or("").to_string(), task_from(v)?)))
            .collect()
    }

    pub fn comments(&self, task: &Task) -> Result<Vec<Comment>> {
        let rows = self.get(&format!(
            "/rest/v1/comments?task_id=eq.{}&select=author_name,body,created_at,images,sessions(name)&order=created_at",
            task.id
        ))?;
        Ok(rows
            .as_array()
            .into_iter()
            .flatten()
            .map(|v| Comment {
                author: v["author_name"].as_str().unwrap_or("").to_string(),
                session: v["sessions"]["name"].as_str().map(String::from),
                body: v["body"].as_str().unwrap_or("").to_string(),
                at: v["created_at"].as_str().unwrap_or("").to_string(),
                images: v["images"].as_array().into_iter().flatten().filter_map(|i| i.as_str().map(String::from)).collect(),
            })
            .collect())
    }

    /// Read one of a comment's images.
    pub fn image(&self, path: &str) -> Result<Vec<u8>> {
        self.supabase.download_as(&self.session, IMAGES_BUCKET, path)
    }

    /// Comment on a task, naming the Claude session it comes from, if any,
    /// with images (files on this machine) uploaded first.
    pub fn add_comment(
        &self,
        project: &Project,
        task: &Task,
        body: &str,
        session_id: Option<&str>,
        images: &[std::path::PathBuf],
    ) -> Result<()> {
        let mut paths = Vec::new();
        for file in images {
            let kind = image_type(file)?;
            let size = match std::fs::metadata(file) {
                Ok(m) => m.len(),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => bail!("can't read {}: there's no such file", file.display()),
                Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => bail!("can't read {}: you don't have permission", file.display()),
                Err(_) => bail!("can't read {}", file.display()),
            };
            if size > IMAGE_LIMIT {
                bail!("{} is {} MB; images can be at most 10 MB", file.display(), size / (1024 * 1024));
            }
            let name: String = file
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("image")
                .chars()
                .map(|c| if c.is_ascii_alphanumeric() || ".-_".contains(c) { c } else { '_' })
                .collect();
            let path = format!("{}/{}-{name}", project.id, uuid::Uuid::new_v4().simple());
            self.supabase.upload_as(&self.session, IMAGES_BUCKET, &path, &std::fs::read(file)?, kind)?;
            paths.push(path);
        }
        self.send("POST", "/rest/v1/comments", json!({ "task_id": task.id, "body": body, "session_id": session_id, "images": paths }))?;
        Ok(())
    }

    /// Save a handoff note for a session. It replaces the session's waiting
    /// note, if there is one.
    pub fn write_handoff(&self, session: &SessionRecord, body: &str) -> Result<Handoff> {
        let rows = self.send(
            "POST",
            &format!("/rest/v1/handoffs?select={HANDOFF_FIELDS}"),
            json!({ "project_id": session.project_id, "session_id": session.id, "body": body }),
        )?;
        Ok(handoff_from(rows.get(0).context("the note wasn't saved")?))
    }

    /// Handoff notes, newest first: one Project's, or all you can see.
    pub fn handoffs(&self, project: Option<&Project>) -> Result<Vec<Handoff>> {
        let only = project.map(|p| format!("&project_id=eq.{}", p.id)).unwrap_or_default();
        let rows = self.get(&format!("/rest/v1/handoffs?select={HANDOFF_FIELDS}{only}&order=written_at.desc&limit=50"))?;
        Ok(rows.as_array().into_iter().flatten().map(handoff_from).collect())
    }

    pub fn handoff(&self, project: &Project, number: i64) -> Result<Handoff> {
        let rows = self.get(&format!("/rest/v1/handoffs?select={HANDOFF_FIELDS}&project_id=eq.{}&number=eq.{number}", project.id))?;
        Ok(handoff_from(rows.get(0).with_context(|| format!("{} has no handoff note #{number}", project.name))?))
    }

    /// The session's waiting note, if any.
    pub fn waiting_handoff(&self, session_id: &str) -> Result<Option<Handoff>> {
        let rows = self.get(&format!("/rest/v1/handoffs?select={HANDOFF_FIELDS}&session_id=eq.{session_id}&state=eq.waiting"))?;
        Ok(rows.get(0).map(handoff_from))
    }

    /// Change a note's state (picked_up, cancelled). Only the machine that
    /// wrote it can.
    pub fn set_handoff_state(&self, id: &str, state: &str) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/handoffs?id=eq.{id}"), json!({ "state": state }))?;
        Ok(())
    }

    /// Cancel a session's waiting note (its window closed).
    pub fn cancel_waiting_handoff(&self, session_id: &str) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/handoffs?session_id=eq.{session_id}&state=eq.waiting"), json!({ "state": "cancelled" }))?;
        Ok(())
    }

    pub fn session_by_id(&self, id: &str) -> Result<SessionRecord> {
        let rows = self.get(&format!("/rest/v1/sessions?select={SESSION_FIELDS}&id=eq.{id}"))?;
        session_from(rows.get(0).context("this session's record is gone")?)
    }

    /// A task by its id, with its Project's name.
    pub fn task_by_id(&self, id: &str) -> Result<(String, Task)> {
        let rows = self.get(&format!("/rest/v1/tasks?id=eq.{id}&select={TASK_FIELDS},projects(name)"))?;
        let v = rows.get(0).context("the task is gone")?;
        Ok((v["projects"]["name"].as_str().unwrap_or("").to_string(), task_from(v)?))
    }

    /// A Project's first status that isn't a done one (To do, usually).
    /// A Project's To do (see `to_do`), by the Project's id.
    pub fn first_open_status(&self, project_id: &str) -> Result<Option<String>> {
        let rows: Vec<Status> = serde_json::from_value(self.get(&format!("/rest/v1/statuses?project_id=eq.{project_id}&select=id,name,position,is_done,color"))?)?;
        Ok(to_do(&rows).map(|s| s.id.clone()))
    }

    /// Whether a person is a member of a Project.
    pub fn is_member(&self, project_id: &str, person_id: &str) -> Result<bool> {
        let rows = self.get(&format!("/rest/v1/project_members?project_id=eq.{project_id}&person_id=eq.{person_id}&select=person_id"))?;
        Ok(rows.as_array().is_some_and(|a| !a.is_empty()))
    }

    /// Add a task at the bottom of a status (not position 0, which ties it
    /// with the top card: #118), given to `to` if anyone. Its id and number.
    pub fn add_task_at_bottom(&self, project_id: &str, status_id: &str, title: &str, notes: &str, to: Option<&str>) -> Result<(String, i64)> {
        let last = self.get(&format!("/rest/v1/tasks?status_id=eq.{status_id}&select=position&order=position.desc&limit=1"))?;
        let position = last.get(0).and_then(|r| r["position"].as_f64()).map_or(0.0, |p| p + 1.0);
        let rows = self.send(
            "POST",
            "/rest/v1/tasks",
            json!({ "project_id": project_id, "status_id": status_id, "title": title, "notes": notes, "assignee_person_id": to, "position": position }),
        )?;
        let id = rows[0]["id"].as_str().context("the task wasn't saved")?.to_string();
        Ok((id, rows[0]["number"].as_i64().unwrap_or(0)))
    }

    /// Record a team member's question, asked as the task `task_id`.
    pub fn add_team_request(&self, team: &TeamRow, job_id: Option<&str>, worker: &str, task_id: &str) -> Result<()> {
        self.send("POST", "/rest/v1/team_requests", json!({ "team_id": team.id, "job_id": job_id, "worker": worker, "task_id": task_id }))?;
        Ok(())
    }

    /// The open question asked as this task, if there is one.
    pub fn open_request_for_task(&self, task_id: &str) -> Result<Option<TeamRequest>> {
        let rows: Vec<TeamRequest> = serde_json::from_value(self.get(&format!("/rest/v1/team_requests?task_id=eq.{task_id}&state=eq.open"))?)?;
        Ok(rows.into_iter().next())
    }

    /// A team's open questions.
    pub fn open_requests(&self, team: &TeamRow) -> Result<Vec<TeamRequest>> {
        Ok(serde_json::from_value(self.get(&format!("/rest/v1/team_requests?team_id=eq.{}&state=eq.open", team.id))?)?)
    }

    /// People's comments on a question's task since it was asked, newest first.
    pub fn answers_to(&self, req: &TeamRequest) -> Result<Vec<Value>> {
        let rows = self.get(&format!(
            "/rest/v1/comments?task_id=eq.{}&session_id=is.null&created_at=gt.{}&select=id,author_id,author_name,body&order=created_at.desc",
            req.task_id,
            req.created_at.replace('+', "%2B")
        ))?;
        Ok(rows.as_array().cloned().unwrap_or_default())
    }

    /// A question was answered, by this comment.
    pub fn mark_answered(&self, req: &TeamRequest, comment_id: &Value) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/team_requests?id=eq.{}", req.id), json!({ "state": "answered", "answer_comment_id": comment_id, "answered_at": "now" }))?;
        Ok(())
    }

    /// This machine's name, and whether it's switched on.
    pub fn my_machine(&self) -> Result<(String, bool)> {
        let rows = self.get(&format!("/rest/v1/machines?id=eq.{}&select=name,active", self.session.user.id))?;
        let row = rows.get(0).context("this machine's record is missing")?;
        Ok((row["name"].as_str().unwrap_or("?").to_string(), row["active"].as_bool() != Some(false)))
    }

    /// This machine is still around (so it isn't switched off after 30 days).
    pub fn check_in(&self) -> Result<()> {
        self.send("POST", "/rest/v1/rpc/machine_check_in", json!({}))?;
        Ok(())
    }

    /// Make the person with this Tailscale login this machine's owner: their name.
    pub fn set_owner(&self, login: &str) -> Result<Option<String>> {
        Ok(self.send("POST", "/rest/v1/rpc/set_machine_owner", json!({ "login": login }))?.as_str().map(String::from))
    }

    /// Tell Omicron which Claude account this machine uses and what's left.
    pub fn report_claude_accounts(&self, info: &Value) -> Result<()> {
        self.send("POST", "/rest/v1/rpc/report_claude_accounts", json!({ "info": info }))?;
        Ok(())
    }

    /// Signed in as a person (not a machine).
    pub fn is_person(&self) -> Result<bool> {
        let rows = self.get(&format!("/rest/v1/people?id=eq.{}&select=id", self.session.user.id))?;
        Ok(rows.as_array().is_some_and(|a| !a.is_empty()))
    }

    /// The Projects the one signed in is a member of.
    pub fn my_project_ids(&self) -> Result<Vec<String>> {
        let rows = self.get(&format!("/rest/v1/project_members?person_id=eq.{}&select=project_id", self.session.user.id))?;
        Ok(rows.as_array().into_iter().flatten().filter_map(|r| r["project_id"].as_str().map(String::from)).collect())
    }

    /// Whether the one signed in can see every one of these Projects.
    pub fn sees_projects(&self, ids: &[String]) -> Result<bool> {
        let rows = self.get(&format!("/rest/v1/projects?id=in.({})&select=id", ids.join(",")))?;
        Ok(rows.as_array().map_or(0, |a| a.len()) == ids.len())
    }

    /// Add a machine to a Project, by ids.
    pub fn add_machine_by_id(&self, project_id: &str, machine_id: &str) -> Result<()> {
        self.send("POST", "/rest/v1/project_machines", json!({ "project_id": project_id, "machine_id": machine_id }))?;
        Ok(())
    }

    /// Whether the one signed in shares a Project with this machine.
    pub fn shares_a_project_with(&self, machine_id: &str) -> Result<bool> {
        let rows = self.get(&format!("/rest/v1/project_machines?machine_id=eq.{machine_id}&select=project_id"))?;
        Ok(rows.as_array().is_some_and(|a| !a.is_empty()))
    }

    /// Whether the one signed in can see this task.
    pub fn sees_task(&self, task_id: &str) -> Result<bool> {
        let rows = self.get(&format!("/rest/v1/tasks?id=eq.{task_id}&select=id"))?;
        Ok(rows.as_array().is_some_and(|a| !a.is_empty()))
    }

    /// The machine a session is on.
    pub fn session_machine(&self, session_id: &str) -> Result<Option<String>> {
        let rows = self.get(&format!("/rest/v1/sessions?id=eq.{session_id}&select=machine_id"))?;
        Ok(rows.get(0).and_then(|r| r["machine_id"].as_str()).map(String::from))
    }

    /// The machine of the session a task is given to, if it's given to one.
    pub fn task_session_machine(&self, task_id: &str) -> Result<Option<String>> {
        let rows = self.get(&format!("/rest/v1/tasks?id=eq.{task_id}&select=id,session:sessions(machine_id)"))?;
        Ok(rows.get(0).and_then(|r| r["session"]["machine_id"].as_str()).map(String::from))
    }

    /// Ask for a task to be dispatched to its session, by id: the request's id.
    pub fn request_dispatch_of(&self, task_id: &str) -> Result<String> {
        let rows = self.send("POST", "/rest/v1/dispatches?select=id", json!({ "task_id": task_id }))?;
        Ok(rows.get(0).and_then(|r| r["id"].as_str()).context("the dispatch wasn't saved")?.to_string())
    }

    /// Ask for a task to be dispatched to its session. The database fills in
    /// the session and its machine, and refuses if the task has no session.
    pub fn request_dispatch(&self, task: &Task) -> Result<Dispatch> {
        let rows = self.send("POST", "/rest/v1/dispatches", json!({ "task_id": task.id }))?;
        dispatch_from(rows.get(0).context("the request wasn't saved")?)
    }

    pub fn dispatch(&self, id: &str) -> Result<Dispatch> {
        let rows = self.get(&format!("/rest/v1/dispatches?id=eq.{id}"))?;
        dispatch_from(rows.get(0).context("the request is gone")?)
    }

    /// Take a request (only its machine can, once, while it's new). None if
    /// it can't be taken.
    pub fn claim_dispatch(&self, id: &str) -> Result<Option<Dispatch>> {
        let rows = self.send("POST", "/rest/v1/rpc/claim_dispatch", json!({ "dispatch": id }))?;
        rows.get(0).map(dispatch_from).transpose()
    }

    /// Say how a taken request went.
    pub fn finish_dispatch(&self, id: &str, ok: bool, message: &str) -> Result<()> {
        self.send("POST", "/rest/v1/rpc/finish_dispatch", json!({ "dispatch": id, "ok": ok, "message": message }))?;
        Ok(())
    }

    /// Give up on a request nobody took. Returns false if it was taken after all.
    pub fn give_up_dispatch(&self, id: &str, why: &str) -> Result<bool> {
        let rows = self.send("POST", "/rest/v1/rpc/give_up_dispatch", json!({ "dispatch": id, "why": why }))?;
        Ok(rows.as_array().is_some_and(|r| !r.is_empty()))
    }

    /// Start a loop for a session (one running loop per session).
    pub fn start_loop(&self, session_id: &str, prompt: &str, every_seconds: i64, until: Option<&str>, times: Option<i64>) -> Result<Loop> {
        let rows = self
            .send(
                "POST",
                "/rest/v1/loops",
                json!({ "session_id": session_id, "prompt": prompt, "every_seconds": every_seconds, "until": until, "times": times }),
            )
            .map_err(|e| {
                if crate::supa::said(&e, "loops_one_running") {
                    anyhow!("that session already has a loop running. Stop it first (`omicron loops stop`).")
                } else {
                    e
                }
            })?;
        Ok(serde_json::from_value(rows.get(0).cloned().context("the loop wasn't started")?)?)
    }

    /// Running loops, all or one session's.
    pub fn loops(&self, session_id: Option<&str>) -> Result<Vec<Loop>> {
        let only = session_id.map(|s| format!("&session_id=eq.{s}")).unwrap_or_default();
        let rows = self.get(&format!("/rest/v1/loops?state=eq.running{only}&order=started_at"))?;
        Ok(serde_json::from_value(rows)?)
    }

    /// This machine's running loops.
    pub fn machine_loops(&self, machine_id: &str) -> Result<Vec<Loop>> {
        let rows = self.get(&format!("/rest/v1/loops?state=eq.running&machine_id=eq.{machine_id}"))?;
        Ok(serde_json::from_value(rows)?)
    }

    pub fn stop_loop(&self, id: &str) -> Result<bool> {
        let rows = self.send("POST", "/rest/v1/rpc/stop_loop", json!({ "loop": id }))?;
        Ok(rows.as_array().is_some_and(|r| !r.is_empty()))
    }

    /// Record a run (only the loop's machine, once per due time). Returns
    /// the loop as it is now, or None if it wasn't this run's to record.
    pub fn loop_ran(&self, id: &str, due: &str) -> Result<Option<Loop>> {
        let rows = self.send("POST", "/rest/v1/rpc/loop_ran", json!({ "loop": id, "due": due }))?;
        rows.get(0).map(|r| serde_json::from_value(r.clone())).transpose().map_err(Into::into)
    }

    pub fn loop_note(&self, id: &str, note: Option<&str>) -> Result<()> {
        self.send("POST", "/rest/v1/rpc/loop_note", json!({ "loop": id, "note": note }))?;
        Ok(())
    }

    pub fn finish_loop(&self, id: &str) -> Result<()> {
        self.send("POST", "/rest/v1/rpc/finish_loop", json!({ "loop": id }))?;
        Ok(())
    }

    /// Start a team on this machine (or start it again, if it's here).
    pub fn start_team(&self, project: &Project, name: &str, folder: &str, workflow: &str, session_id: Option<&str>) -> Result<TeamRow> {
        let me = self.session.user.id;
        let body = json!({ "project_id": project.id, "name": name, "folder": folder, "workflow": workflow, "session_id": session_id, "state": "running" });
        let here = self.get(&format!("/rest/v1/teams?machine_id=eq.{me}&name=eq.{}&select=id", enc(name)))?;
        let rows = match here.get(0).and_then(|r| r["id"].as_str()) {
            Some(id) => self.send("PATCH", &format!("/rest/v1/teams?id=eq.{id}"), body)?,
            None => self.send("POST", "/rest/v1/teams", body)?,
        };
        Ok(serde_json::from_value(rows.get(0).cloned().context("the team wasn't saved")?)?)
    }

    pub fn teams(&self) -> Result<Vec<TeamRow>> {
        Ok(serde_json::from_value(self.get("/rest/v1/teams?order=name")?)?)
    }

    /// A team by name (names are unique on each machine).
    pub fn team(&self, name: &str) -> Result<TeamRow> {
        let all: Vec<TeamRow> = self.teams()?.into_iter().filter(|t| t.name.eq_ignore_ascii_case(name)).collect();
        match all.len() {
            0 => bail!("no team called {name}"),
            1 => Ok(all.into_iter().next().unwrap()),
            _ => bail!("more than one machine has a team called {name}"),
        }
    }

    pub fn stop_team(&self, id: &str) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/teams?id=eq.{id}"), json!({ "state": "stopped" }))?;
        Ok(())
    }

    pub fn add_job(&self, team: &TeamRow, title: &str, text: &str) -> Result<Job> {
        let rows = self.send("POST", "/rest/v1/jobs", json!({ "team_id": team.id, "title": title, "text": text }))?;
        Ok(serde_json::from_value(rows[0].clone())?)
    }

    pub fn team_by_id(&self, id: &str) -> Result<TeamRow> {
        let rows: Vec<TeamRow> = serde_json::from_value(self.get(&format!("/rest/v1/teams?id=eq.{id}"))?)?;
        rows.into_iter().next().context("the team is gone")
    }

    pub fn job(&self, team: &TeamRow, number: i64) -> Result<Job> {
        let rows: Vec<Job> = serde_json::from_value(self.get(&format!("/rest/v1/jobs?team_id=eq.{}&number=eq.{number}", team.id))?)?;
        rows.into_iter().next().with_context(|| format!("{} has no job #{number}", team.name))
    }

    fn update_job(&self, job: &Job, change: Value) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/jobs?id=eq.{}", job.id), change)?;
        Ok(())
    }

    /// A job is being worked on, by the role `step`, with a note (or its
    /// note kept, with None).
    pub fn job_at(&self, job: &Job, step: &str, note: Option<&str>) -> Result<()> {
        let mut change = json!({ "state": "working", "step": step });
        if let Some(n) = note {
            change["note"] = json!(n);
        }
        self.update_job(job, change)
    }

    /// A job can't go on until something's answered or fixed: why.
    pub fn block_job(&self, job: &Job, why: &str) -> Result<()> {
        self.update_job(job, json!({ "state": "blocked", "note": why }))
    }

    /// A waiting job's note (None clears it); left alone once it's started.
    pub fn waiting_job_note(&self, job_id: &str, note: Option<&str>) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/jobs?id=eq.{job_id}&state=eq.waiting"), json!({ "note": note }))?;
        Ok(())
    }

    /// A job blocked on a question goes back to work with its answer.
    pub fn unblock_job(&self, job_id: &str, note: &str) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/jobs?id=eq.{job_id}&state=eq.blocked"), json!({ "state": "working", "note": note }))?;
        Ok(())
    }

    pub fn finish_job(&self, job: &Job) -> Result<()> {
        self.update_job(job, json!({ "state": "done" }))
    }

    /// A team's workers, by name.
    pub fn workers(&self, team: &TeamRow) -> Result<Vec<Worker>> {
        let rows = self.get(&format!("/rest/v1/workers?team_id=eq.{}&select=name,role,state,job_id&order=name", team.id))?;
        Ok(serde_json::from_value(rows)?)
    }

    /// Record a worker (added, or changed if it's there). Only the team's machine can.
    pub fn set_worker(&self, team: &TeamRow, name: &str, role: &str, state: &str, job_id: Option<&str>) -> Result<()> {
        let body = json!({ "team_id": team.id, "name": name, "role": role, "state": state, "job_id": job_id });
        let here = self.get(&format!("/rest/v1/workers?team_id=eq.{}&name=eq.{}&select=id", team.id, enc(name)))?;
        match here.get(0).and_then(|r| r["id"].as_str()) {
            Some(id) => self.send("PATCH", &format!("/rest/v1/workers?id=eq.{id}"), body)?,
            None => self.send("POST", "/rest/v1/workers", body)?,
        };
        Ok(())
    }

    /// Link a task to a team's job (both in the same Project).
    pub fn link_job(&self, task: &Task, team: &TeamRow, number: i64) -> Result<Job> {
        let job = self.job(team, number)?;
        self.send("POST", "/rest/v1/task_jobs", json!({ "task_id": task.id, "job_id": job.id })).map_err(|e| {
            if crate::supa::said(&e, "duplicate key") {
                anyhow!("#{} is already linked to {} job #{number}", task.number, team.name)
            } else {
                e
            }
        })?;
        Ok(job)
    }

    pub fn unlink_job(&self, task: &Task, team: &TeamRow, number: i64) -> Result<()> {
        let job = self.job(team, number)?;
        self.supabase.request_as(&self.session, "DELETE", &format!("/rest/v1/task_jobs?task_id=eq.{}&job_id=eq.{}", task.id, job.id), None)?;
        Ok(())
    }

    /// A task's linked jobs: (team name, job).
    pub fn task_jobs(&self, task: &Task) -> Result<Vec<(String, Job)>> {
        let rows = self.get(&format!("/rest/v1/task_jobs?task_id=eq.{}&select=jobs(*,teams(name))", task.id))?;
        let mut out = Vec::new();
        for r in rows.as_array().into_iter().flatten() {
            let team = r["jobs"]["teams"]["name"].as_str().unwrap_or("").to_string();
            let job: Job = serde_json::from_value(r["jobs"].clone())?;
            out.push((team, job));
        }
        out.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.number.cmp(&b.1.number)));
        Ok(out)
    }

    pub fn jobs(&self, team: &TeamRow) -> Result<Vec<Job>> {
        Ok(serde_json::from_value(self.get(&format!("/rest/v1/jobs?team_id=eq.{}&order=number", team.id))?)?)
    }

    pub fn set_needs_review(&self, project: &Project, number: i64, on: bool) -> Result<Task> {
        let task = self.task(project, number)?;
        self.update_task(&task, json!({ "needs_review": on }))?;
        self.task(project, number)
    }

    pub fn add_label(&self, project: &Project, number: i64, label: &str) -> Result<Task> {
        let task = self.task(project, number)?;
        let label_id = self.label_id(project, label)?;
        if !task.labels.iter().any(|l| l.eq_ignore_ascii_case(label)) {
            self.send("POST", "/rest/v1/task_labels", json!({ "task_id": task.id, "label_id": label_id }))?;
        }
        self.task(project, number)
    }

    pub fn add_checklist_item(&self, project: &Project, number: i64, text: &str) -> Result<Task> {
        let task = self.task(project, number)?;
        let last = task.checklist.iter().map(|c| c.position).fold(0.0, f64::max);
        self.send("POST", "/rest/v1/checklist_items", json!({ "task_id": task.id, "text": text, "position": last + 1.0 }))?;
        self.task(project, number)
    }

    /// Tick or untick checklist item `item` (counting from 1).
    pub fn toggle_checklist_item(&self, project: &Project, number: i64, item: usize) -> Result<Task> {
        let task = self.task(project, number)?;
        let entry = item
            .checked_sub(1)
            .and_then(|i| task.checklist.get(i))
            .with_context(|| format!("task #{number} has no checklist item {item}"))?;
        self.send("PATCH", &format!("/rest/v1/checklist_items?id=eq.{}", entry.id), json!({ "done": !entry.done }))?;
        self.task(project, number)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_do_is_the_first_status_that_isnt_done() {
        let st = |id: &str, position: f64, is_done: bool| Status { id: id.into(), name: id.into(), position, is_done, color: None };
        // Done was dragged to the front: To do is still To do.
        let all = [st("Done", 0.0, true), st("To do", 1.0, false), st("Doing", 2.0, false), st("Review", 3.0, false)];
        assert_eq!(to_do(&all).map(|s| s.name.as_str()), Some("To do"));
        assert!(in_progress(&all, "To do") && in_progress(&all, "Doing"));
        assert!(!in_progress(&all, "Done") && !in_progress(&all, "Review"));
        // Tied positions: by name.
        assert_eq!(to_do(&[st("b", 1.0, false), st("a", 1.0, false)]).map(|s| s.name.as_str()), Some("a"));
        // Only done statuses: no To do.
        assert!(to_do(&[st("Done", 0.0, true)]).is_none());
    }

    #[test]
    fn placing_a_task() {
        let col = [(1, 0.0), (2, 1.0), (3, 2.0)];
        let at = |place| placement(&col, 9, place).unwrap();
        assert_eq!(at(Place::Top), Placement { renumbered: vec![], position: -1.0 });
        assert_eq!(at(Place::Bottom).position, 3.0);
        assert_eq!(at(Place::Before(2)).position, 0.5);
        assert_eq!(at(Place::After(2)).position, 1.5);
        assert_eq!(at(Place::After(3)).position, 3.0);
        // An empty status.
        assert_eq!(placement(&[], 9, Place::Top).unwrap().position, 0.0);
        // Not there, or itself.
        assert!(placement(&col, 9, Place::Before(7)).unwrap_err().to_string().contains("#7 isn't in that status"));
        // (The task itself is never among the others.)
        assert!(placement(&[(1, 0.0), (3, 2.0)], 2, Place::After(2)).unwrap_err().to_string().contains("next to itself"));
    }

    #[test]
    fn tied_tasks_are_numbered_before_one_goes_between() {
        // Three that never had a place (all 0), as the database's old default did (#118).
        let col = [(1, 0.0), (2, 0.0), (3, 0.0)];
        let p = placement(&col, 9, Place::After(1)).unwrap();
        assert_eq!(p.renumbered, vec![0.0, 1.0, 2.0]);
        assert_eq!(p.position, 0.5);
        assert_eq!(placement(&col, 9, Place::Top).unwrap().position, -1.0);
        // A tie anywhere renumbers the whole status.
        assert_eq!(placement(&[(1, 0.0), (2, 5.0), (3, 5.0)], 9, Place::Bottom).unwrap(), Placement { renumbered: vec![0.0, 1.0, 2.0], position: 3.0 });
    }

    #[test]
    fn task_rows_team_tasks_and_workers_are_read() {
        let row = json!({ "id": "t1", "number": 4, "title": "Fix it", "status_id": "s1", "assignee_person_id": null,
            "assignee_session_id": "x", "task_labels": [{ "label_id": "l1" }, { "label_id": "l2" }], "task_jobs": [] });
        let t: TaskRow = serde_json::from_value(row.clone()).unwrap();
        assert_eq!((t.number, t.label_ids(), t.has_job(), t.assignee_session_id.as_deref()), (4, vec!["l1", "l2"], false, Some("x")));
        // A team's task: fewer fields, read all the same.
        let tt = TeamTask::read(&json!({ "tasks": { "id": "t1", "number": 4, "title": "Fix it", "status_id": "s1", "assignee_session_id": null },
            "jobs": { "number": 2, "state": "done", "teams": { "name": "web", "machine_id": "m" } } })).unwrap();
        assert_eq!((tt.task.number, tt.task.has_job(), tt.job_number, tt.job_state.as_str(), tt.team.as_str()), (4, false, 2, "done", "web"));
        // Not one of this machine's teams (no team): left out.
        assert!(TeamTask::read(&json!({ "tasks": row, "jobs": { "number": 2, "state": "done", "teams": null } })).is_none());
        let w: Vec<Worker> = serde_json::from_value(json!([{ "name": "builder-1", "role": "builder", "state": "busy", "job_id": null }])).unwrap();
        assert_eq!(w[0], Worker { name: "builder-1".into(), role: "builder".into(), state: "busy".into(), job_id: None });
    }

    #[test]
    fn dates_must_look_like_dates() {
        assert!(check_date("2026-11-30").is_ok());
        for bad in ["2026-1-30", "30/11/2026", "tomorrow", "2026-11-30T00:00"] {
            assert!(check_date(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn tasks_read_labels_and_checklists_in_order() {
        let v = json!({
            "id": "t", "number": 3, "title": "Milk", "notes": "", "status_id": "s", "due_on": null,
            "needs_review": false, "assignee": { "display_name": "Sam" },
            "task_labels": [{ "labels": { "name": "shop" } }, { "labels": { "name": "food" } }],
            "checklist_items": [
                { "id": "b", "text": "second", "done": false, "position": 2.0 },
                { "id": "a", "text": "first", "done": true, "position": 1.0 },
            ],
        });
        let t = task_from(&v).unwrap();
        assert_eq!(t.labels, vec!["food", "shop"]);
        assert_eq!(t.checklist.iter().map(|c| c.text.as_str()).collect::<Vec<_>>(), vec!["first", "second"]);
        assert_eq!(t.assignee.as_deref(), Some("Sam"));
    }
}
