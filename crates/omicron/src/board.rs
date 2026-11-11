//! Projects, statuses, labels, tasks and checklists, as the signed-in person
//! or machine. The database's access rules decide what's allowed; this only
//! shapes the requests and the answers.

use crate::supa::{Session, Supabase};
use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde_json::{json, Value};

/// Someone signed in: a person, or a machine (which is how Claude sessions act).
pub struct Board {
    pub supabase: Supabase,
    pub session: Session,
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
    pub due_on: Option<String>,
    pub assignee: Option<String>,
    /// The Claude session it was sent to, if any.
    pub session: Option<String>,
    /// Its topic's name, if it has one.
    pub topic: Option<String>,
    pub needs_review: bool,
    pub labels: Vec<String>,
    pub checklist: Vec<ChecklistItem>,
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

const TASK_FIELDS: &str = "id,number,title,notes,status_id,due_on,needs_review,position,\
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
        due_on: v["due_on"].as_str().map(String::from),
        assignee: v["assignee"]["display_name"].as_str().map(String::from),
        session: v["session"]["name"].as_str().map(String::from),
        topic: v["topic"]["name"].as_str().map(String::from),
        needs_review: v["needs_review"].as_bool().unwrap_or(false),
        labels,
        checklist,
    })
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

/// A message in a Project's chat.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatMessage {
    pub author: String,
    pub session: Option<String>,
    pub body: String,
    pub at: String,
}

fn chat_from(v: &Value) -> ChatMessage {
    ChatMessage {
        author: v["author_name"].as_str().unwrap_or("").to_string(),
        session: v["sessions"]["name"].as_str().map(String::from),
        body: v["body"].as_str().unwrap_or("").to_string(),
        at: v["created_at"].as_str().unwrap_or("").to_string(),
    }
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
}

const SESSION_FIELDS: &str = "id,project_id,machine_id,name,state,claude_session_id,folder,projects(name),machines(name)";

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
    })
}

impl Board {
    fn get(&self, path: &str) -> Result<Value> {
        self.supabase.request_as(&self.session, "GET", path, None)
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
    pub fn update_session(&self, id: &str, change: Value) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/sessions?id=eq.{id}"), change)?;
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

    fn label_id(&self, project: &Project, name: &str) -> Result<String> {
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
        let rows = self.send(
            "POST",
            "/rest/v1/tasks?select=id,number",
            json!({
                "project_id": project.id, "title": new.title, "status_id": status.id,
                "due_on": new.due_on, "assignee_person_id": assignee, "notes": new.notes,
                "topic_id": topic,
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

    pub fn move_task(&self, project: &Project, number: i64, status: &str) -> Result<Task> {
        let task = self.task(project, number)?;
        let status = self.status_named(project, status)?;
        self.update_task(&task, json!({ "status_id": status.id }))?;
        self.task(project, number)
    }

    /// Move a task to the Project's Done status.
    pub fn finish_task(&self, project: &Project, number: i64) -> Result<Task> {
        let done = self.statuses(project)?.into_iter().find(|s| s.is_done).context("this Project has no Done status")?;
        self.move_task(project, number, &done.name)
    }

    /// Put the Needs review mark on (`true`, machines only) or take it off.
    /// Give a task to a Claude session in the same Project. The session gets
    /// it when told to get its tasks (`omicron tasks mine`) or by Dispatch.
    pub fn send_task(&self, project: &Project, number: i64, session: &str) -> Result<Task> {
        let task = self.task(project, number)?;
        let s = self.session(project, session)?;
        self.update_task(&task, json!({ "assignee_session_id": s.id, "assignee_person_id": null }))?;
        self.task(project, number)
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
    /// them picked up. Returns (Project name, task) pairs.
    pub fn pick_up_tasks(&self, session_id: &str) -> Result<Vec<(String, Task)>> {
        let taken = self.send("POST", "/rest/v1/rpc/pick_up_tasks?select=id", json!({ "session": session_id }))?;
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
            let size = std::fs::metadata(file).with_context(|| format!("can't read {}", file.display()))?.len();
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

    /// Turn a Project's chat on or off.
    pub fn set_chat(&self, project: &Project, on: bool) -> Result<()> {
        self.send("PATCH", &format!("/rest/v1/projects?id=eq.{}", project.id), json!({ "chat_enabled": on }))?;
        Ok(())
    }

    pub fn chat_enabled(&self, project: &Project) -> Result<bool> {
        let rows = self.get(&format!("/rest/v1/projects?id=eq.{}&select=chat_enabled", project.id))?;
        Ok(rows[0]["chat_enabled"].as_bool().unwrap_or(false))
    }

    /// The newest `limit` messages, oldest first.
    pub fn chat(&self, project: &Project, limit: usize) -> Result<Vec<ChatMessage>> {
        let rows = self.get(&format!(
            "/rest/v1/chat_messages?project_id=eq.{}&select=author_name,body,created_at,sessions(name)&order=created_at.desc&limit={limit}",
            project.id
        ))?;
        let mut msgs: Vec<ChatMessage> = rows.as_array().into_iter().flatten().map(chat_from).collect();
        msgs.reverse();
        Ok(msgs)
    }

    pub fn send_chat(&self, project: &Project, body: &str, session_id: Option<&str>) -> Result<()> {
        if !self.chat_enabled(project)? {
            bail!("chat is off for {}. Turn it on with `omicron chat on '{}'`.", project.name, project.name);
        }
        self.send("POST", "/rest/v1/chat_messages", json!({ "project_id": project.id, "body": body, "session_id": session_id }))?;
        Ok(())
    }

    /// Messages that name a session (`@name`) since it last read, not its
    /// own, marking them read. Returns (Project name, messages).
    pub fn take_chat_mentions(&self, session_id: &str) -> Result<(String, Vec<ChatMessage>)> {
        let rows = self.get(&format!("/rest/v1/sessions?id=eq.{session_id}&select=name,project_id,chat_read_at,projects(name)"))?;
        let s = rows.get(0).context("this session's record is gone")?;
        let (name, project_id) = (s["name"].as_str().unwrap_or(""), s["project_id"].as_str().unwrap_or(""));
        let since = s["chat_read_at"].as_str().unwrap_or("");
        let rows = self.get(&format!(
            "/rest/v1/chat_messages?project_id=eq.{project_id}&created_at=gt.{}&select=author_name,body,created_at,session_id,sessions(name)&order=created_at",
            since.replace('+', "%2B")
        ))?;
        let rows: Vec<&Value> = rows.as_array().into_iter().flatten().collect();
        let Some(last) = rows.last() else { return Ok((String::new(), Vec::new())) };
        // Read up to here, whether or not they named it.
        self.send("PATCH", &format!("/rest/v1/sessions?id=eq.{session_id}"), json!({ "chat_read_at": last["created_at"] }))?;
        let mention = format!("@{}", name.to_lowercase());
        let mine = rows
            .iter()
            .filter(|m| m["session_id"].as_str() != Some(session_id))
            .filter(|m| {
                m["body"].as_str().unwrap_or("").to_lowercase().split(|c: char| c.is_whitespace() || ",.:;!?()".contains(c)).any(|w| w == mention)
            })
            .map(|m| chat_from(m))
            .collect();
        Ok((s["projects"]["name"].as_str().unwrap_or("").to_string(), mine))
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
