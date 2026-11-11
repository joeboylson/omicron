// @ts-check
// The Projects and tasks part of the web page, against a real `omicron serve`
// and Supabase.
const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");
const { startOmicron, unique, need, sessionFor, rest, visitAs, fakeWindow } = require("./omicron");

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
  await page.getByRole("button", { name: "New Project" }).first().click();
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
    const claude = crypto.randomUUID();
    omicron.transcript(claude);
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: folder, source: "startup" });
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

    // Off to start with: nobody sees it.
    await expect(page.getByRole("button", { name: "Chat" })).toHaveCount(0);
    await page.getByRole("button", { name: "Project settings" }).click();
    const chatSwitch = page.getByRole("switch", { name: "Chat for this Project" });
    await expect(chatSwitch).toHaveAttribute("aria-checked", "false");
    await chatSwitch.click();
    await expect(chatSwitch).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Chat" }).click();
    const sheet = page.getByRole("dialog");
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

    // Turned off from settings: the chat and its button go away.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Project settings" }).click();
    await page.getByRole("switch", { name: "Chat for this Project" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Chat" })).toHaveCount(0);
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

test("a session taken out with its machine says why, and its tasks go to someone else", async ({ page, request }) => {
  const robin = await newPerson(page, request, "Robin Example");
  const name = unique("Code");
  const projectId = await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Write the parser");
  // The add form stays open for the next one.
  await page.getByLabel("New task in To do").fill("Write the docs");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(column(page, "To do").getByRole("button", { name: /Write the docs/ })).toBeVisible();

  // A machine in just this Project, with a session holding both tasks
  // (signed in with its own key, as its daemon and hooks do).
  const box = unique("box");
  const key = omicron.cli("machines", "register", box, "--print").trim();
  const [, id, secret] = key.match(/^omk_([0-9a-f]+)_(.+)$/);
  const uuid = id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  await rest(request, robin.session, "POST", "/rest/v1/project_machines", { project_id: projectId, machine_id: uuid });
  const login = await (
    await request.post(`${need("OMICRON_SUPABASE_URL")}/auth/v1/token?grant_type=password`, {
      headers: { apikey: need("OMICRON_SUPABASE_KEY") },
      data: { email: `${uuid}@machines.omicron.invalid`, password: secret },
    })
  ).json();
  const [session] = await rest(request, login, "POST", "/rest/v1/sessions", { project_id: projectId, name: "parser", folder: "/work" });
  await rest(request, login, "PATCH", `/rest/v1/tasks?project_id=eq.${projectId}`, { assignee_session_id: session.id });
  const sessions = page.getByRole("region", { name: "Claude sessions" });
  await expect(sessions).toContainText(`parser${box} · open`);

  // The machine is taken out of the Project: the page shows it stopped, live.
  await rest(request, robin.session, "DELETE", `/rest/v1/project_machines?project_id=eq.${projectId}&machine_id=eq.${uuid}`);
  await expect(sessions).toContainText(`parser${box} · stopped`);

  // The task says why, and Dispatch is off.
  await page.getByRole("button", { name: "#1 Write the parser" }).click();
  await expect(page.getByTestId("pickup")).toHaveText("parser stopped: its machine was taken out of the Project. Give the task to someone else.");
  await expect(page.getByRole("button", { name: "Dispatch" })).toBeDisabled();
  await page.keyboard.press("Escape");

  // From the session's sheet, both open tasks go to a person at once.
  await sessions.getByRole("button", { name: /parser/ }).click();
  await expect(page.getByTestId("gone-why")).toHaveText("Stopped: its machine was taken out of the Project.");
  await expect(page.getByRole("list", { name: "Open tasks" }).getByRole("listitem")).toHaveCount(2);
  await page.getByLabel("Give parser's open tasks to").click();
  await page.getByRole("option", { name: "Robin Example" }).click();
  await expect(page.getByRole("list", { name: "Open tasks" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "#1 Write the parser" })).toContainText("RE");
  await expect(page.getByRole("button", { name: "#2 Write the docs" })).toContainText("RE");
});

test("a session's loop shows on the page, live, and can be stopped there", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  const win = fakeWindow();
  try {
    omicron.hook(win.pid, "session-start", { session_id: crypto.randomUUID(), cwd: "/work", source: "startup" });
    omicron.addSession(win.pid, "parser", name);
    const sessions = page.getByRole("region", { name: "Claude sessions" });
    await expect(sessions).toContainText("parser");
    await expect(sessions.getByLabel("looping")).toHaveCount(0);

    // The session starts a loop for itself.
    omicron.cliIn(win.pid, "loops", "start", "Keep going with the next task", "--every", "10m", "--times", "5");
    await expect(sessions.getByLabel("looping")).toBeVisible();
    await sessions.getByRole("button", { name: /parser/ }).click();
    const loop = page.getByTestId("loop");
    await expect(loop).toContainText("every 10m");
    await expect(loop).toContainText("0 of 5 runs done");
    await expect(loop).toContainText("Keep going with the next task");
    await expect(loop).toContainText(/Next run in (9|10) min/);

    // Stopped from the page: gone from the sheet and the strip, and the command agrees.
    await page.getByRole("button", { name: "Stop loop" }).click();
    await expect(loop).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(sessions.getByLabel("looping")).toHaveCount(0);
    expect(omicron.cliIn(win.pid, "loops", "list", "--project", name, "--as-machine")).toContain("No loops are running.");
  } finally {
    win.kill();
  }
});

test("the People page: everyone, their Projects, and adding or taking them out", async ({ page, request }) => {
  await newPerson(page, request, "Robin Example");
  const garden = unique("Garden");
  const house = unique("House");
  await startProjectIn(page, garden);
  await startProjectIn(page, house);
  // Someone who has signed in but isn't in any Project yet.
  const sam = await sessionFor(request, omicron, `${unique("sam")}@example.com`, "Sam Example");
  void sam;

  await page.goto(omicron.url);
  await page.getByRole("button", { name: "People" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  await page.getByLabel("Search people").fill("sam example");
  const row = page.getByRole("list", { name: "People" }).getByRole("listitem", { name: "Sam Example" }).first();
  await expect(row).toContainText("No Projects you're in.");

  // Added to a Project: it shows at once.
  await row.getByLabel("Add Sam Example to a Project").click();
  await page.getByRole("option", { name: garden }).click();
  const projects = row.getByRole("group", { name: "Sam Example's Projects" });
  await expect(projects).toContainText(garden);
  await expect(projects).not.toContainText(house);

  // Taken out again.
  await row.getByRole("button", { name: `Take Sam Example out of ${garden}` }).click();
  await expect(row).toContainText("No Projects you're in.");

  // Search narrows the list; back goes to Projects.
  await page.getByLabel("Search people").fill("nobody-like-this");
  await expect(page.getByText("Nobody matches")).toBeVisible();
  await page.getByRole("button", { name: "Back to Projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
});

test("tasks move by dragging, within and between statuses, and with the keyboard", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("House");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Alpha");
  for (const t of ["Bravo", "Charlie"]) {
    await page.getByLabel("New task in To do").fill(t);
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await expect(column(page, "To do").getByRole("button", { name: new RegExp(t) })).toBeVisible();
  }
  await page.getByRole("button", { name: "Cancel" }).click();
  const titles = (status) => column(page, status).getByRole("button", { name: /^#\d+ / }).allTextContents();
  const card = (t) => page.getByRole("button", { name: new RegExp(`^#\\d+ ${t}$`) });
  async function drag(from, to, dy = -10) {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 5 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + dy, { steps: 15 });
    await page.mouse.up();
  }

  // Within a status: Charlie to the top.
  await drag(card("Charlie"), card("Alpha"), -20);
  await expect.poll(async () => (await titles("To do")).map((t) => t.replace(/#\d+$/, "").trim())).toEqual(["Charlie", "Alpha", "Bravo"].map(String));
  // To another status.
  await drag(card("Alpha"), column(page, "Done"), 0);
  await expect(column(page, "Done")).toContainText("Alpha");

  // With the keyboard: Space picks Bravo up, the up arrow moves it, Space drops it.
  await card("Bravo").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  await expect.poll(async () => (await titles("To do")).map((t) => t.replace(/#\d+$/, "").trim())).toEqual(["Bravo", "Charlie"]);

  // Saved: the same after reloading.
  await page.reload();
  await expect.poll(async () => (await titles("To do")).map((t) => t.replace(/#\d+$/, "").trim())).toEqual(["Bravo", "Charlie"]);
  await expect(column(page, "Done")).toContainText("Alpha");
  // A click still opens a task.
  await card("Charlie").click();
  await expect(page.getByRole("dialog")).toContainText("Charlie");
});

test("labels are renamed and removed in Project settings", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("House");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Buy milk");
  omicron.cli("tasks", "label", name, "1", "shop", "--as-machine");
  const card = page.getByRole("button", { name: /#1 Buy milk/ });
  await expect(card).toContainText("shop");

  await page.getByRole("button", { name: "Project settings" }).click();
  const box = page.getByLabel("Label name: shop");
  await box.fill("groceries");
  await box.press("Enter");
  await expect(page.getByLabel("Label name: groceries")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toContainText("groceries");

  await page.getByRole("button", { name: "Project settings" }).click();
  await page.getByRole("button", { name: "Remove label groceries" }).click();
  await expect(page.getByRole("list", { name: "Labels" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(card).not.toContainText("groceries");
});

test("a new Project starts in a modal, and Cancel or Escape leaves nothing behind", async ({ page, request }) => {
  await newPerson(page, request);
  await page.goto(omicron.url);
  await page.getByRole("button", { name: "New Project" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New Project" });
  await expect(dialog).toBeVisible();
  // The name box has focus, and Start waits for a name.
  await expect(dialog.getByLabel("New Project name")).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Start Project" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  const name = unique("Kitchen");
  await page.getByRole("button", { name: "New Project" }).first().click();
  await page.getByLabel("New Project name").fill(name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("appearance: Light, Dark or the system, saved with you and on every device", async ({ page, request, browser }) => {
  const me = await newPerson(page, request);
  await page.goto(omicron.url);
  await page.getByTestId("me").click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  const choice = (n) => page.getByRole("radio", { name: n });
  await expect(choice("Match the system")).toHaveAttribute("aria-checked", "true");
  const theme = (p) => p.evaluate(() => document.documentElement.dataset.theme ?? "system");

  await choice("Dark").click();
  await expect(choice("Dark")).toHaveAttribute("aria-checked", "true");
  expect(await theme(page)).toBe("dark");
  // The page's colors follow.
  expect(await page.evaluate(() => getComputedStyle(document.body).colorScheme)).toBe("dark");

  // Kept on reload, from the very first paint.
  await page.reload();
  expect(await theme(page)).toBe("dark");

  // Another device (a fresh browser) gets it once signed in.
  const other = await (await browser.newContext()).newPage();
  await visitAs(other, omicron, me.login, me.name);
  await other.goto(omicron.url);
  await expect(other.getByTestId("me")).toBeVisible();
  await expect.poll(() => theme(other)).toBe("dark");

  await choice("Light").click();
  expect(await theme(page)).toBe("light");
  await choice("Match the system").click();
  expect(await theme(page)).toBe("system");
  await other.close();
});

test("API keys: make one for a new machine, see it, switch it off, remove it", async ({ page, request }) => {
  const me = await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await page.goto(omicron.url);
  await page.getByTestId("me").click();
  await page.getByRole("button", { name: "API keys" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "API keys" })).toBeVisible();

  const box = unique("box");
  await page.getByRole("button", { name: "New key" }).first().click();
  await page.getByLabel("Machine name").fill(box);
  await page.getByLabel(name).check();
  await page.getByRole("button", { name: "Make key" }).click();
  const shown = page.getByTestId("new-key");
  await expect(shown).toContainText("omicron machines use-key omk_");
  const key = (await shown.textContent()).split(" ").pop();
  await page.getByRole("button", { name: "Done" }).click();

  // The key works: it signs in as the new machine, which is in the Project.
  const [, id, secret] = key.match(/^omk_([0-9a-f]+)_(.+)$/);
  const uuid = id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  const login = await (
    await request.post(`${need("OMICRON_SUPABASE_URL")}/auth/v1/token?grant_type=password`, {
      headers: { apikey: need("OMICRON_SUPABASE_KEY") },
      data: { email: `${uuid}@machines.omicron.invalid`, password: secret },
    })
  ).json();
  expect(login.access_token).toBeTruthy();
  const projects = await rest(request, login, "GET", "/rest/v1/projects?select=name");
  expect(projects.map((p) => p.name)).toEqual([name]);

  const row = page.getByRole("list", { name: "Machines" }).getByRole("listitem", { name: box });
  await expect(row).toContainText("asleep · never seen");
  await expect(row).toContainText(name);
  await row.getByRole("button", { name: "Switch off" }).click();
  await expect(row).toContainText("switched off");
  // Switched off, the key gets nothing.
  expect(await rest(request, login, "GET", "/rest/v1/projects?select=name")).toEqual([]);
  await row.getByRole("button", { name: "Switch on" }).click();
  await expect(row).toContainText("asleep");
  // Removing asks first; Cancel keeps it.
  await row.getByRole("button", { name: `Remove ${box}…` }).click();
  await expect(row.getByRole("alert")).toContainText("This can't be undone.");
  await row.getByRole("button", { name: "Cancel" }).click();
  await expect(row.getByRole("alert")).toHaveCount(0);
  await row.getByRole("button", { name: `Remove ${box}…` }).click();
  await row.getByRole("button", { name: `Remove ${box}`, exact: true }).click();
  await expect(row).toHaveCount(0);

  // Machines outside your Projects can't be touched.
  const others = await rest(request, me.session, "GET", `/rest/v1/machines?name=eq.${machineName}&select=id`);
  const res = await request.post(`${omicron.url}/api/machines/${others[0].id}/remove`, {
    headers: { Authorization: `Bearer ${me.session.access_token}`, "tailscale-user-login": me.login },
  });
  expect(res.status()).toBe(403);
});

test("deleting a task can be undone, and it's gone for good after", async ({ page, request }) => {
  const me = await newPerson(page, request);
  const name = unique("House");
  const id = await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Fix the gate");
  const card = page.getByRole("button", { name: /#1 Fix the gate/ });

  await card.click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await expect(card).toHaveCount(0);
  const toast = page.getByRole("status").filter({ hasText: "Deleted #1 Fix the gate" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(card).toBeVisible();

  await card.click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await expect(card).toHaveCount(0);
  // Not undone: deleted in the database a few seconds later.
  await expect
    .poll(async () => (await rest(request, me.session, "GET", `/rest/v1/tasks?project_id=eq.${id}&select=id`)).length, { timeout: 10000 })
    .toBe(0);
});

test("search and filters narrow the board", async ({ page, request }) => {
  await newPerson(page, request, "Robin Example");
  const name = unique("House");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Fix the gate");
  for (const t of ["Paint the fence", "Water plants"]) {
    await page.getByLabel("New task in To do").fill(t);
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await expect(column(page, "To do").getByRole("button", { name: new RegExp(t) })).toBeVisible();
  }
  const cards = () => column(page, "To do").getByRole("button", { name: /^#\d+ / });
  await expect(cards()).toHaveCount(3);

  await page.getByLabel("Search tasks").fill("fence");
  await expect(cards()).toHaveCount(1);
  await expect(cards().first()).toContainText("Paint the fence");
  await page.getByLabel("Search tasks").fill("#3");
  await expect(cards()).toHaveCount(1);
  await expect(cards().first()).toContainText("Water plants");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(cards()).toHaveCount(3);

  // Mine: given to me.
  await cards().first().click();
  await pick(page, "Given to", "Robin Example");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Mine" }).click();
  await expect(cards()).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect(cards()).toHaveCount(3);
});

test("the command menu (Ctrl/⌘-K) and shortcuts", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Garden");
  await startProjectIn(page, name);
  await page.goto(omicron.url);
  await expect(page.getByTestId("me")).toBeVisible();

  // Go to a Project by typing its name.
  await page.keyboard.press("Control+k");
  const menu = page.getByRole("dialog", { name: "Commands" });
  await expect(menu).toBeVisible();
  await page.getByRole("combobox", { name: "Command" }).fill(name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // c adds a task; / searches.
  await page.keyboard.press("c");
  await expect(page.getByLabel("New task in To do")).toBeFocused();
  await page.keyboard.type("Plant tulips");
  await page.keyboard.press("Enter");
  await expect(column(page, "To do")).toContainText("Plant tulips");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("/");
  await expect(page.getByLabel("Search tasks")).toBeFocused();

  // Open a task from the menu by its number; switch the theme from it.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("#1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Plant tulips");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("dark");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
});
