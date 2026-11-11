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
    await dialog.getByRole("button", { name: "Add status" }).click();
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
    await expect(page.getByTestId("pickup")).toHaveText(/Waiting until the session is told/);

    // The end of the session's turn doesn't hand it over...
    expect(omicron.hook(win.pid, "stop", { session_id: claude, stop_hook_active: false })).toBe("");
    await expect(page.getByTestId("pickup")).toHaveText(/Waiting until the session is told/);
    // ...the session gets it when told to get its tasks.
    const mine = omicron.cliIn(win.pid, "tasks", "mine", "--as-machine");
    expect(mine).toContain(`#1 in ${name}: Write the parser (new)`);
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

test("Dispatch hands a task to its session on its machine, and says how it went", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Write the parser");

  const win = fakeWindow();
  let daemon;
  try {
    const folder = omicron.folder();
    omicron.hook(win.pid, "session-start", { session_id: crypto.randomUUID(), cwd: folder, source: "startup" });
    omicron.addSession(win.pid, "parser", name);
    await page.getByRole("button", { name: "#1 Write the parser" }).click();
    await pick(page, "Given to", "parser");

    // The machine's daemon isn't running: it's asleep, and Dispatch is off.
    const button = page.getByRole("button", { name: "Dispatch" });
    const outcome = page.getByTestId("dispatch");
    await expect(page.getByTestId("dispatch-asleep")).toHaveText(`${machineName} is asleep, so Dispatch is off until its daemon runs.`);
    await expect(button).toBeDisabled();

    // It wakes up: the page hears at once.
    daemon = await omicron.daemon();
    await expect(button).toBeEnabled();
    await expect(page.getByTestId("dispatch-asleep")).toHaveCount(0);

    // Open in a window Omicron doesn't host: it can't be typed into.
    await button.click();
    await expect(outcome).toContainText("open in a window Omicron doesn't host");

    // The window closes. Dispatch reopens the session in the host, with the task.
    win.kill();
    await button.click();
    await expect(outcome).toContainText(`Reopened parser on ${machineName} with the task.`);
    expect(omicron.cli("sessions", "hosted").trim()).toBe("parser");
    await expect.poll(() => omicron.cli("sessions", "list", "--project", name, "--as-machine")).toContain("\topen\t");

    // Running in the host now, so the next one is typed in.
    await button.click();
    await expect(outcome).toHaveText(`Typed the task into parser on ${machineName}.now`);
  } finally {
    win.kill();
    try {
      omicron.cli("sessions", "send", "parser", "\u0004");
    } catch {}
    daemon?.stop();
  }
});

test("a Project's chat: turned on, a session named in it answers, live", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  const win = fakeWindow();
  try {
    const claude = crypto.randomUUID();
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: "/work/code", source: "startup" });
    omicron.addSession(win.pid, "parser", name);

    await page.getByRole("button", { name: "Chat" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Chat is off for this Project.");
    await sheet.getByRole("button", { name: "Turn on chat" }).click();
    await sheet.getByLabel("New message").fill("@parser how far did you get?");
    await sheet.getByLabel("New message").press("Enter");
    const messages = sheet.getByRole("list", { name: "Messages" });
    await expect(messages).toContainText("@parser how far did you get?");

    // The session is told at the end of its turn, and answers.
    const out = JSON.parse(omicron.hook(win.pid, "stop", { session_id: claude, stop_hook_active: false }));
    expect(out.reason).toContain("@parser how far did you get?");
    omicron.cliIn(win.pid, "chat", "send", name, "Half way: parser done, errors next.", "--as-machine");
    await expect(messages.getByRole("listitem")).toHaveCount(2);
    await expect(messages.getByRole("listitem").last()).toContainText(`${machineName}parser`);
    await expect(messages.getByRole("listitem").last()).toContainText("Half way: parser done, errors next.");
  } finally {
    win.kill();
  }
});

test("opening the chat doesn't stop the Project page's live updates", async ({ page, request }) => {
  const me = await newPerson(page, request);
  const projectId = await startProjectIn(page, unique("Code"));
  await rest(request, me.session, "PATCH", `/rest/v1/projects?id=eq.${projectId}`, { chat_enabled: true });
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("No messages yet.");
  await page.keyboard.press("Escape");

  const [todo] = await rest(request, me.session, "GET", `/rest/v1/statuses?project_id=eq.${projectId}&name=eq.To%20do&select=id`);
  await rest(request, me.session, "POST", "/rest/v1/tasks", { project_id: projectId, status_id: todo.id, title: "Added while the page is open" });
  await expect(column(page, "To do").getByRole("button", { name: "#1 Added while the page is open" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("topics group the board into rows, as well as by status", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("House");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Water the plants");

  // Grouped by topic with no topics yet: one row, and how to add some.
  await page.getByRole("radio", { name: "Status and topic" }).click();
  await expect(page.getByText("No topics yet.")).toBeVisible();
  await expect(page.getByRole("region", { name: "No topic", exact: true })).toContainText("Water the plants");

  await page.getByRole("button", { name: "Add topics in Project settings" }).click();
  for (const topic of ["Joe's to-do", "Claire's to-do"]) {
    await page.getByLabel("New topic").fill(topic);
    await page.getByLabel("New topic").press("Enter");
    await expect(page.getByRole("list", { name: "Topics" }).getByLabel(`Topic name: ${topic}`)).toHaveValue(topic);
  }
  await page.keyboard.press("Escape");

  // A row per topic, in order, then the tasks without one.
  const lanes = page.locator("main > div > section");
  await expect(lanes).toHaveCount(3);
  await expect(lanes.nth(0)).toHaveAttribute("aria-label", "Joe's to-do");
  await expect(lanes.nth(2)).toHaveAttribute("aria-label", "No topic");

  // A task added in a row gets that row's topic.
  const joe = page.getByRole("region", { name: "Joe's to-do", exact: true });
  await joe.getByRole("region", { name: "To do in Joe's to-do" }).getByRole("button", { name: "Add a task" }).click();
  await page.getByLabel("New task in To do in Joe's to-do").fill("Fix the gate");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(joe).toContainText("Fix the gate");

  // Moved to another topic from the task.
  await page.getByRole("button", { name: /Water the plants/ }).click();
  await pick(page, "Topic", "Claire's to-do");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Claire's to-do", exact: true })).toContainText("Water the plants");
  // Nothing left without a topic: that row goes.
  await expect(page.getByRole("region", { name: "No topic", exact: true })).toHaveCount(0);

  // Rows fold away.
  await joe.getByRole("button", { name: /Joe's to-do/ }).click();
  await expect(joe.getByRole("region")).toHaveCount(0);
  await expect(joe.getByRole("button", { name: /Joe's to-do/ })).toHaveAttribute("aria-expanded", "false");

  // The choice is kept on reload; back to status only.
  await page.reload();
  await expect(page.getByRole("radio", { name: "Status and topic" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Status", exact: true }).click();
  await expect(column(page, "To do")).toContainText("Fix the gate");
  await expect(column(page, "To do")).toContainText("Water the plants");
});

test("comments hold images: picked, dropped, or posted by a session, and open full size", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("House");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Fix the gate");
  await page.getByRole("button", { name: "#1 Fix the gate" }).click();

  // A tiny real PNG.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
    "base64",
  );
  // Picked with the button: uploads at once, then sends with the comment.
  await page.getByLabel("Images to add").setInputFiles([{ name: "gate.png", mimeType: "image/png", buffer: png }]);
  const pending = page.getByRole("list", { name: "New images" });
  await expect(pending.getByRole("img", { name: "gate.png" })).toBeVisible();
  await expect(pending.getByLabel("Adding gate.png")).toHaveCount(0);
  // Not an image: said so, and it isn't sent.
  await page.getByLabel("Images to add").setInputFiles([{ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") }]);
  await expect(pending.getByRole("alert")).toHaveText("notes.txt isn't a PNG, JPEG, GIF or WebP image.");
  await page.getByRole("button", { name: "Remove notes.txt" }).click();

  // Dropped onto the comment box.
  const drop = await page.evaluateHandle((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
    return dt;
  }, png.toString("base64"));
  await page.getByLabel("New comment").dispatchEvent("drop", { dataTransfer: drop });
  await expect(pending.getByRole("img")).toHaveCount(2);

  await page.getByLabel("New comment").fill("Before and after.");
  await page.getByRole("button", { name: "Send" }).click();
  const comments = page.getByRole("list", { name: "Comments" });
  await expect(comments).toContainText("Before and after.");
  await expect(comments.getByRole("img", { name: "gate.png" })).toBeVisible();
  await expect(comments.getByRole("img", { name: "dropped.png" })).toBeVisible();
  await expect(pending).toHaveCount(0);

  // Opens full size.
  await comments.getByRole("button", { name: "Open gate.png" }).click();
  const viewer = page.getByRole("dialog", { name: "gate.png" });
  await expect(viewer.getByRole("img", { name: "gate.png" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  // Focus goes back to the image that was opened.
  await expect(comments.getByRole("button", { name: "Open gate.png" })).toBeFocused();

  // A Claude session posts a screenshot with its report, from the command.
  const shot = require("node:path").join(require("node:os").tmpdir(), `${unique("shot")}.png`);
  require("node:fs").writeFileSync(shot, png);
  omicron.cli("tasks", "comment", name, "1", "Done, screenshot attached.", "--image", shot, "--as-machine");
  await expect(comments.getByRole("listitem").filter({ hasText: "Done, screenshot attached." }).getByRole("img")).toBeVisible();
});
