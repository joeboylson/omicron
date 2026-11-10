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
assignee:people(display_name),task_labels(labels(name)),checklist_items(id,text,done,position)";

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
        needs_review: v["needs_review"].as_bool().unwrap_or(false),
        labels,
        checklist,
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

    pub fn start_project(&self, name: &str) -> Result<Project> {
        Ok(serde_json::from_value(self.send("POST", "/rest/v1/rpc/start_project", json!({ "name": name }))?)?)
    }

    pub fn statuses(&self, project: &Project) -> Result<Vec<Status>> {
        Ok(serde_json::from_value(self.get(&format!(
            "/rest/v1/statuses?project_id=eq.{}&select=id,name,position,is_done&order=position,name",
            project.id
        ))?)?)
    }

    /// Add a status at the end. `done` makes it the Project's Done status.
    pub fn add_status(&self, project: &Project, name: &str, done: bool) -> Result<Status> {
        let last = self.statuses(project)?.iter().map(|s| s.position).fold(0.0, f64::max);
        let rows = self.send(
            "POST",
            "/rest/v1/statuses?select=id,name,position,is_done",
            json!({ "project_id": project.id, "name": name, "position": last + 1.0, "is_done": done }),
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

    fn label_id(&self, project: &Project, name: &str) -> Result<String> {
        let found = self.get(&format!("/rest/v1/labels?project_id=eq.{}&name=eq.{}&select=id", project.id, enc(name)))?;
        if let Some(id) = found.get(0).and_then(|r| r["id"].as_str()) {
            return Ok(id.to_string());
        }
        let made = self.send("POST", "/rest/v1/labels?select=id", json!({ "project_id": project.id, "name": name }))?;
        Ok(made[0]["id"].as_str().context("label wasn't made")?.to_string())
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
        let rows = self.send(
            "POST",
            "/rest/v1/tasks?select=id,number",
            json!({
                "project_id": project.id, "title": new.title, "status_id": status.id,
                "due_on": new.due_on, "assignee_person_id": assignee,
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
