// @ts-check
// The Projects and tasks part of the web page, against a real `omicron serve`
// and Supabase.
const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");
const { startOmicron, unique, sessionFor, rest, visitAs, fakeWindow } = require("./omicron");

let omicron;
let machineName;
test.beforeAll(async () => {
  omicron = await startOmicron();
  // A machine for this server, standing in for a Claude session.
  machineName = unique("mac");
  omicron.cli("machines", "register", machineName, "--all-projects");
});
test.afterAll(() => omicron?.stop());

/** A new person, with a browser page signed in as them. */
async function newPerson(page, request, name = "Robin Example") {
  const login = `${unique("p")}@example.com`;
  const session = await sessionFor(request, omicron, login, name);
  await visitAs(page, omicron, login, name);
  return { login, name, session };
}

async function startProjectIn(page, name) {
  await page.goto(omicron.url);
  await page.getByLabel("New Project name").fill(name);
  await page.getByRole("button", { name: "Start Project" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url().split("/p/")[1];
}

const column = (page, status) => page.getByRole("region", { name: status, exact: true });

async function addTaskIn(page, status, title) {
  await column(page, status).getByRole("button", { name: "Add a task" }).click();
  await page.getByLabel(`New task in ${status}`).fill(title);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(column(page, status).getByRole("button", { name: new RegExp(title) })).toBeVisible();
}

async function pick(page, field, option) {
  await page.getByLabel(field, { exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("start a Project and add a task to it", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Groceries");
  await startProjectIn(page, name);
  // New Projects start with To do and Done.
  await expect(page.getByRole("region")).toHaveCount(2);
  await expect(column(page, "To do")).toBeVisible();
  await expect(column(page, "Done")).toContainText("Done");

  await addTaskIn(page, "To do", "Buy milk");
  await expect(column(page, "To do").getByRole("button", { name: "#1 Buy milk" })).toBeVisible();

  // Back on the Projects list, it shows with its task count.
  await page.getByRole("button", { name: "Back to Projects" }).click();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toContainText("1 task");
});

test("a task can be filled in and finished", async ({ page, request }) => {
  const me = await newPerson(page, request, "Robin Example");
  const projectId = await startProjectIn(page, unique("House"));
  await addTaskIn(page, "To do", "Fix the gate");
  await page.getByRole("button", { name: "#1 Fix the gate" }).click();
  const dialog = page.getByRole("dialog");

  await dialog.getByLabel("Title").fill("Fix the back gate");
  await dialog.getByLabel("Title").press("Enter");
  await dialog.getByLabel("Notes").fill("The latch is loose.");
  await dialog.getByLabel("Date").fill("2026-12-01");
  await pick(page, "Given to", me.name);
  await dialog.getByLabel("New label").fill("outside");
  await dialog.getByLabel("New label").press("Enter");
  await expect(dialog.getByRole("button", { name: "outside", pressed: true })).toBeVisible();
  await dialog.getByLabel("New checklist item").fill("Buy a new latch");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await dialog.getByLabel("New checklist item").fill("Fit it");
  await dialog.getByLabel("New checklist item").press("Enter");
  await dialog.getByRole("checkbox", { name: "Buy a new latch" }).check();
  await expect(dialog.getByRole("list", { name: "Checklist" }).getByRole("listitem")).toHaveCount(2);

  // The card shows it all.
  await page.keyboard.press("Escape");
  const card = column(page, "To do").getByRole("button", { name: "#1 Fix the back gate" });
  await expect(card).toContainText("outside");
  await expect(card).toContainText("1/2");
  await expect(card).toContainText("RE");
  await expect(card).toContainText("Dec 1");

  await card.click();
  await dialog.getByRole("button", { name: "Mark done" }).click();
  await expect(dialog.getByRole("button", { name: "Mark done" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(column(page, "Done").getByRole("button", { name: "#1 Fix the back gate" })).toBeVisible();
  await expect(column(page, "To do").getByRole("button", { name: /^#\d+ / })).toHaveCount(0);

  // And it's all saved in Supabase.
  const [task] = await rest(
    request,
    me.session,
    "GET",
    `/rest/v1/tasks?project_id=eq.${projectId}&select=title,notes,due_on,assignee_person_id,statuses(is_done),task_labels(labels(name)),checklist_items(text,done)`,
  );
  expect(task).toMatchObject({
    title: "Fix the back gate",
    notes: "The latch is loose.",
    due_on: "2026-12-01",
    assignee_person_id: me.session.person_id,
    statuses: { is_done: true },
    task_labels: [{ labels: { name: "outside" } }],
  });
  expect(task.checklist_items).toEqual(
    expect.arrayContaining([
      { text: "Buy a new latch", done: true },
      { text: "Fit it", done: false },
    ]),
  );
});

test("changes made somewhere else show up without reloading", async ({ page, request, browser }) => {
  const me = await newPerson(page, request);
  const name = unique("Trip");
  const projectId = await startProjectIn(page, name);
  const [todo] = await rest(request, me.session, "GET", `/rest/v1/statuses?project_id=eq.${projectId}&name=eq.To%20do&select=id`);

  // Someone adds a task from the terminal (here, straight through Supabase).
  await rest(request, me.session, "POST", "/rest/v1/tasks", { project_id: projectId, status_id: todo.id, title: "Book the ferry" });
  await expect(column(page, "To do").getByRole("button", { name: "#1 Book the ferry" })).toBeVisible();

  // A second person sees the Project appear on their list once they're added.
  const other = await browser.newPage();
  const them = await newPerson(other, request, "Sam Example");
  await other.goto(omicron.url);
  await expect(other.getByText("No Projects yet.")).toBeVisible();
  await rest(request, me.session, "POST", "/rest/v1/project_members", { project_id: projectId, person_id: them.session.person_id });
  await expect(other.getByRole("link", { name: new RegExp(name) })).toBeVisible();

  // And sees the first person's changes live.
  await other.getByRole("link", { name: new RegExp(name) }).click();
  await addTaskIn(page, "To do", "Pack");
  await expect(column(other, "To do").getByRole("button", { name: "#2 Pack" })).toBeVisible();
  await other.close();
});

test("a Claude session marks a task for review, and a person takes it off", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Write the parser");

  // The Claude session, through its machine's key.
  omicron.cli("tasks", "needs-review", name, "1", "--as-machine");
  const card = column(page, "To do").getByRole("button", { name: "#1 Write the parser" });
  await expect(card).toContainText("Needs review");

  await card.click();
  await expect(page.getByTestId("needs-review")).toBeVisible();
  await page.getByRole("button", { name: "Reviewed" }).click();
  await expect(page.getByTestId("needs-review")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).not.toContainText("Needs review");
});

test("statuses and members are set in Project settings", async ({ page, request }) => {
  await newPerson(page, request, "Robin Example");
  const friend = unique("Alex");
  await sessionFor(request, omicron, `${friend}@example.com`, friend);
  await startProjectIn(page, unique("Garden"));

  // The columns can't be seen behind the settings dialog, so check them
  // after closing it.
  const settings = async (work) => {
    await page.getByRole("button", { name: "Project settings" }).click();
    await work(page.getByRole("dialog"));
    await page.keyboard.press("Escape");
  };
  const addStatus = async (dialog, name) => {
    await dialog.getByLabel("New status").fill(name);
    await dialog.getByRole("button", { name: "Add", exact: true }).click();
    await expect(dialog.getByLabel(`Status name: ${name}`)).toBeVisible();
  };

  // New statuses go before the Done status.
  await settings((dialog) => addStatus(dialog, "Doing"));
  await expect(page.getByRole("region")).toHaveText([/^To do/, /^Doing/, /^Done/]);

  // Move the Done mark to a new "Finished" status, then the old one can go.
  await settings(async (dialog) => {
    await addStatus(dialog, "Finished");
    const finished = dialog.getByRole("listitem").filter({ has: page.getByLabel("Status name: Finished") });
    await finished.getByRole("button", { name: "Make Done" }).click();
    await expect(finished).toContainText("Done status");
    await dialog.getByRole("button", { name: "Remove status Done" }).click();
    await expect(dialog.getByLabel("Status name: Done")).toHaveCount(0);
  });
  await expect(page.getByRole("region")).toHaveText([/^To do/, /^Doing/, /^Finished0Done/]);

  await page.getByRole("button", { name: "Project settings" }).click();
  const dialog = page.getByRole("dialog");
  // Add a member, who can then be given tasks.
  await pick(page, "Add a member", friend);
  await expect(dialog.getByRole("region", { name: "Members" })).toContainText(friend);
  await page.keyboard.press("Escape");
  await addTaskIn(page, "To do", "Plant bulbs");
  await page.getByRole("button", { name: "#1 Plant bulbs" }).click();
  await pick(page, "Given to", friend);
  await expect(page.getByLabel("Given to", { exact: true })).toHaveText(friend);
});

test("a Project you're not in isn't shown", async ({ page, request }) => {
  await newPerson(page, request);
  await page.goto(`${omicron.url}/p/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByText("This Project doesn't exist, or you're not a member of it.")).toBeVisible();
});

test("a Project's Claude sessions show, and follow the session live", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await expect(page.getByRole("region", { name: "Claude sessions" })).toHaveCount(0);

  // A Claude Code window on the machine starts, and adds itself.
  const win = fakeWindow();
  try {
    omicron.hook(win.pid, "session-start", { session_id: crypto.randomUUID(), cwd: "/work/code", source: "startup" });
    omicron.addSession(win.pid, "parser", name);
    const sessions = page.getByRole("region", { name: "Claude sessions" });
    await expect(sessions).toContainText(`parser${machineName} · open`);

    // Its handoff notes show when the session is tapped, live.
    await sessions.getByRole("button", { name: /parser/ }).click();
    await expect(page.getByRole("dialog")).toContainText("No notes yet.");
    omicron.cliIn(win.pid, "handoff", "write", "Parser half done. Next: error messages.");
    const notes = page.getByRole("list", { name: "Handoff notes" });
    await expect(notes).toContainText("#1waiting");
    await expect(notes).toContainText("Parser half done. Next: error messages.");
    await page.keyboard.press("Escape");

    // It's closed: the page shows that without reloading.
    omicron.hook(win.pid, "session-end", { session_id: crypto.randomUUID(), reason: "prompt_input_exit" });
    await expect(sessions).toContainText(`parser${machineName} · closed`);
  } finally {
    win.kill();
  }
});

test("a task sent to a Claude session from the page is picked up by it", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Write the parser");

  const win = fakeWindow();
  try {
    const claude = crypto.randomUUID();
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: "/work/code", source: "startup" });
    omicron.addSession(win.pid, "parser", name);
    await expect(page.getByRole("region", { name: "Claude sessions" })).toContainText("parser");

    const card = page.getByRole("button", { name: "#1 Write the parser" });
    await card.click();
    await pick(page, "Given to", "parser");
    await expect(page.getByTestId("pickup")).toHaveText(/Waiting for the session/);

    // The session's turn ends: it's told, and the page sees it was picked up.
    const out = JSON.parse(omicron.hook(win.pid, "stop", { session_id: claude, stop_hook_active: false }));
    expect(out.decision).toBe("block");
    expect(out.reason).toContain(`#1 in ${name}: Write the parser`);
    await expect(page.getByTestId("pickup")).toHaveText("Picked up by the session.");

    // It reports back and asks for review; the page shows it live.
    omicron.cliIn(win.pid, "tasks", "comment", name, "1", "Parser done, with tests.", "--review", "--as-machine");
    const comments = page.getByRole("list", { name: "Comments" });
    await expect(comments).toContainText(`${machineName}parser`);
    await expect(comments).toContainText("Parser done, with tests.");
    await expect(page.getByTestId("needs-review")).toBeVisible();

    // A person answers from the page.
    await page.getByLabel("New comment").fill("Thanks, looks good.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(comments.getByRole("listitem")).toHaveCount(2);
    await expect(comments.getByRole("listitem").last()).toContainText("Thanks, looks good.");
    await page.keyboard.press("Escape");
    await expect(card).toContainText("2");
    await expect(card).toContainText("parser");
    await expect(card).not.toContainText("waiting");
  } finally {
    win.kill();
  }
});
