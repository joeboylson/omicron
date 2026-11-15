// @ts-check
// The Projects and tasks part of the web page, against a real `omicron serve`
// and Supabase.
const { test, expect } = require("@playwright/test");
const crypto = require("node:crypto");
const { startOmicron, unique, need, sessionFor, rest, visitAs } = require("./omicron");

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
/** Escape, once whatever is opening has finished opening (a dialog pressed
 *  mid-animation doesn't close). */
async function escape(page) {
  await settled(page);
  await page.keyboard.press("Escape");
}

/** Nothing on the page is still opening or closing. */
async function settled(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
}

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
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url().split("/p/")[1];
}

/** Supabase as the secret key: to set up what only a machine could make. */
async function admin(request, method, path, data) {
  const key = process.env.OMICRON_SUPABASE_SECRET_KEY;
  const res = await request.fetch(`${process.env.OMICRON_SUPABASE_URL}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=representation" },
    data,
  });
  if (!res.ok()) throw new Error(`${method} ${path}: ${res.status()} ${await res.text()}`);
  return res.json();
}

const column = (page, status) => page.getByRole("region", { name: status, exact: true });
// A Project's sections: the tab bar at the bottom (#248).
const tab = (page, name) => page.getByRole("navigation", { name: "Project" }).getByRole("button", { name, exact: true }).click();
const settingsTab = (page) => page.getByRole("region", { name: "Project settings" });
// Board or List, Status, Topic or Person: from the View menu (#229).
const viewAs = async (page, name) => {
  await page.getByRole("button", { name: /^View and filters/ }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
  await page.getByRole("menu").waitFor({ state: "detached" });
};
const viewIs = async (page, name) => {
  await page.getByRole("button", { name: /^View and filters/ }).click();
  const item = page.getByRole("menuitemradio", { name, exact: true });
  await expect(item).toHaveAttribute("aria-checked", "true");
  // Closed by picking it again (it stays as it is).
  await item.click();
  await page.getByRole("menu").waitFor({ state: "detached" });
};

async function addTaskIn(page, status, title) {
  await column(page, status).getByRole("button", { name: "Add Task" }).click();
  await page.getByLabel(`New task in ${status}`).fill(title);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(column(page, status).getByRole("button", { name: new RegExp(title) })).toBeVisible();
}

async function pick(page, field, option) {
  await page.getByLabel(field, { exact: true }).click();
  // The list opens with a short animation; a click before it's done is lost.
  await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
  await settled(page);
  await page.getByRole("option", { name: option, exact: true }).click();
  // Taken: the list closes.
  await expect(page.getByRole("option", { name: option, exact: true })).toHaveCount(0);
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
  await expect(page.getByRole("row", { name: new RegExp(name) }).getByRole("cell").nth(1)).toHaveText(/^1\b/);
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
  // The date: quick picks, any day, and Clear, shown as on the card (#164).
  await dialog.getByLabel("Date", { exact: true }).click();
  await page.getByRole("button", { name: /^Tomorrow/ }).click();
  await expect(dialog.getByLabel("Date", { exact: true })).not.toHaveText("None");
  await dialog.getByLabel("Date", { exact: true }).click();
  await page.getByRole("button", { name: "Clear the date" }).click();
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveText("None");
  await dialog.getByLabel("Date", { exact: true }).click();
  await page.getByLabel("Pick a date").fill("2026-12-01");
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveText(/^Dec 1/);
  await pick(page, "Given to", me.name);
  // Only the task's labels show; Add label finds or makes one (#165).
  await dialog.getByRole("button", { name: "Add label" }).click();
  await page.getByPlaceholder("Label", { exact: true }).fill("outside");
  await page.getByRole("option", { name: "New label “outside”" }).click();
  await expect(dialog.getByRole("button", { name: "Take off outside" })).toBeVisible();
  await dialog.getByLabel("New checklist item").fill("Buy a new latch");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await dialog.getByLabel("New checklist item").fill("Fit it");
  await dialog.getByLabel("New checklist item").press("Enter");
  await dialog.getByRole("checkbox", { name: "Buy a new latch" }).check();
  await expect(dialog.getByRole("list", { name: "Checklist" }).getByRole("listitem")).toHaveCount(2);
  // Near the top: how far along it is, which jumps to the checklist (#185).
  await dialog.getByRole("button", { name: "1 of 2 done" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Buy a new latch" })).toBeFocused();

  // The card shows it all.
  await escape(page);
  const card = column(page, "To do").getByRole("button", { name: "#1 Fix the back gate" });
  await expect(card).toContainText("outside");
  await expect(card).toContainText("1/2");
  await expect(card).toContainText("RE");
  await expect(card).toContainText("Dec 1");

  await card.click();
  // Mark done and Delete are in the ⋯ menu at the top (#60).
  await dialog.getByRole("button", { name: "More for this task" }).click();
  await page.getByRole("menuitem", { name: "Mark done" }).click();
  await expect(dialog.getByRole("combobox", { name: "Status" })).toHaveText("Done");
  await escape(page);
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
  await escape(page);
  await expect(card).not.toContainText("Needs review");
});

test("statuses are set in Project settings, members from Share", async ({ page, request }) => {
  await newPerson(page, request, "Robin Example");
  const friend = unique("Alex");
  await sessionFor(request, omicron, `${friend}@example.com`, friend);
  await startProjectIn(page, unique("Garden"));

  // Settings is a tab (#248): the columns show again on Tasks.
  const settings = async (work) => {
    await tab(page, "Settings");
    await work(settingsTab(page));
    await tab(page, "Tasks");
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
    // Pick-one, like radio buttons (#208): one on, the rest off.
    await finished.getByRole("radio", { name: "Finished is the Done status" }).click();
    await expect(finished.getByRole("radio")).toBeChecked();
    await expect(dialog.getByRole("radio", { name: "Done is the Done status" })).not.toBeChecked();
    await expect(dialog.getByRole("radiogroup", { name: "Done status" }).getByRole("radio", { checked: true })).toHaveCount(1);
    await dialog.getByRole("button", { name: "Remove status Done" }).click();
    await expect(dialog.getByLabel("Status name: Done")).toHaveCount(0);
  });
  await expect(page.getByRole("region")).toHaveText([/^To do/, /^Doing/, /^Finished0Tasks here count as done/]);

  // Who's in it: at the top of the Settings tab (#209, #248).
  await tab(page, "Settings");
  const dialog = settingsTab(page);
  // The page here is on this computer's own address: no link to copy.
  await expect(dialog.getByRole("region", { name: "Link" })).toContainText("another device");
  // Add a member, who can then be given tasks.
  // Everyone in it is listed, you first (#159).
  const members = dialog.getByRole("list", { name: "Members" });
  await expect(members.getByRole("listitem")).toHaveText([/\(you\)$/]);
  await dialog.getByRole("button", { name: "Add member" }).click();
  await page.getByRole("option", { name: friend }).click();
  await expect(members.getByRole("listitem")).toHaveCount(2);
  await expect(members).toContainText(friend);
  // Taken out, then back in.
  await members.getByRole("button", { name: `Take ${friend} out of this Project` }).click();
  await expect(members.getByRole("listitem")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Add member" }).click();
  await page.getByRole("option", { name: friend }).click();
  await expect(members).toContainText(friend);
  await tab(page, "Tasks");
  await addTaskIn(page, "To do", "Plant bulbs");
  await page.getByRole("button", { name: "#1 Plant bulbs" }).click();
  await pick(page, "Given to", friend);
  await expect(page.getByLabel("Given to", { exact: true })).toHaveText(friend);
});

test("a Project's folders are listed in its settings, added only on their computer", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await tab(page, "Settings");
  // On a Project with no Claude sessions yet, their parts are folded away (#160).
  await settingsTab(page).getByText("Claude sessions", { exact: true }).click();
  const folders = settingsTab(page).getByRole("region", { name: "Folders" });
  await expect(folders).toContainText("No folders yet.");
  await expect(folders).not.toContainText("omicron folders add");

  // Added on the machine: the page shows it live, with nothing to add it from here.
  const dir = require("node:fs").realpathSync(require("node:fs").mkdtempSync("/tmp/of-"));
  omicron.cli("folders", "add", dir, "--project", name);
  await expect(folders).toContainText(dir);
  await expect(folders).toContainText(machineName);
  await expect(folders.getByRole("button")).toHaveCount(0);
  if (process.env.OMICRON_SHOTS) {
    await folders.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.OMICRON_SHOTS}/folders.png` });
  }
});

test("the computer's owner sees its gate on its own page; nobody else does", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  await page.goto(omicron.url);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(page.getByTestId("gate")).toHaveCount(0);

  // Robin owns the computer serving the page: its gate shows, closed.
  omicron.cli("machines", "owner", robin.login);
  omicron.cli("remote", "off");
  await page.reload();
  const gate = page.getByTestId("gate");
  await expect(gate).toHaveAccessibleName(`${machineName}'s remote control: off`);
  // Opened on the computer: the page says until when.
  const later = new Date(Date.now() + 2 * 3600 * 1000);
  omicron.cli("remote", "on", "--until", `${later.getHours()}:${String(later.getMinutes()).padStart(2, "0")}`);
  await page.reload();
  await expect(gate).toHaveAccessibleName(new RegExp(`^${machineName}'s remote control: on until`));
  // Through the tailnet, it can't be opened or closed from the page. It
  // says plainly that this page can always use the computer (#151).
  await gate.click();
  const said = page.getByRole("dialog");
  await expect(said).toContainText(`You can always use ${machineName} from this page.`);
  await expect(said).toContainText("also takes your work from other computers");
  await expect(page.getByRole("button", { name: "Turn off remote control" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // Closed: how to open it, to copy and run on the computer.
  omicron.cli("remote", "off");
  await page.reload();
  await gate.click();
  await expect(said).toContainText("takes no work from other computers");
  await expect(said.locator("code")).toHaveText(/^omicron remote on --until \d{2}:\d{2}$/);
  await expect(said.getByRole("button", { name: "Copy" })).toBeVisible();
});

test("on the computer itself, its owner opens and closes its gate from the page", async ({ page }) => {
  // No Tailscale headers: a visit from this computer, as the person signed in to it.
  await page.goto(omicron.url);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  omicron.cli("machines", "owner", omicron.me.login);
  omicron.cli("remote", "off");
  await page.reload();
  const gate = page.getByTestId("gate");
  await expect(gate).toHaveAccessibleName(`${machineName}'s remote control: off`);
  await gate.click();
  if (process.env.OMICRON_SHOTS) await page.screenshot({ path: `${process.env.OMICRON_SHOTS}/gate-closed.png` });
  await page.getByLabel("On until").fill("23:59");
  await page.getByRole("button", { name: "Turn On", exact: true }).click();
  await expect(gate).toHaveAccessibleName(new RegExp(`^${machineName}'s remote control: on until`));
  expect(omicron.cli("remote", "status")).toContain("Remote control is on until 11:59 PM");
  await page.getByRole("button", { name: "Turn off remote control" }).click();
  await expect(gate).toHaveAccessibleName(`${machineName}'s remote control: off`);
  expect(omicron.cli("remote", "status")).toContain("Remote control is off");
});

test("the Dev view: this computer's sessions in terminals, and tasks handed over here", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Write the parser");
  // Not the computer's owner: no Dev view.
  await expect(page.getByRole("radiogroup", { name: "View" })).toHaveCount(0);

  const claude = crypto.randomUUID();
  const win = await omicron.open("parser", name, claude);
  try {
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: omicron.folder(), source: "resume" });
    omicron.cli("machines", "owner", robin.login);
    omicron.cli("gate", "close"); // the old name still works
    await page.reload();
    await tab(page, "Dev");
    await expect(page).toHaveURL(/view=dev/);
    const sessions = page.getByRole("list", { name: "Sessions" });
    await expect(sessions).toContainText("parser");

    // Its terminal: keys go in, and what it shows comes back.
    await sessions.getByRole("button", { name: /parser/ }).click();
    await expect(page.getByRole("tab", { name: "parser" })).toHaveAttribute("aria-selected", "true");
    const term = page.getByTestId("terminal-parser");
    await expect(term.getByRole("status")).toHaveCount(0);
    await term.locator(".xterm").click();
    await page.keyboard.type("hello from the page");
    await page.keyboard.press("Enter");
    await expect(term.locator(".xterm-rows")).toContainText("hello from the page");
    if (process.env.OMICRON_SHOTS) await page.screenshot({ path: `${process.env.OMICRON_SHOTS}/dev-view.png` });
    // The terminal follows the page's theme, as it changes (#98).
    const background = () => term.locator(".xterm-viewport").evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
    await expect.poll(background).toBe("rgb(255, 255, 255)");
    await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
    await expect.poll(background).not.toBe("rgb(255, 255, 255)");
    if (process.env.OMICRON_SHOTS) await page.screenshot({ path: `${process.env.OMICRON_SHOTS}/dev-view-dark.png` });
    await page.evaluate(() => delete document.documentElement.dataset.theme);

    // Handed over from the Tasks tab (the Dev side has no board now, #250),
    // with the gate closed: the computer's owner gave it, so the session takes it.
    await tab(page, "Tasks");
    await page.getByRole("button", { name: "#1 Write the parser" }).click();
    await pick(page, "Given to", "parser");
    await expect.poll(() => omicron.cliIn(win.pid, "tasks", "show", name, "1", "--as-machine")).toContain("sent to session parser");
    await escape(page);
    // The session says it has one waiting (#177).
    await tab(page, "Dev");
    await expect(page.getByTestId("doing-parser")).toContainText(/1 task to start|working on #1/);
    await page.getByRole("list", { name: "Sessions" }).getByRole("button", { name: /parser/ }).click();

    // Closing the tab leaves the session running.
    await page.getByRole("button", { name: "Close parser's tab (it keeps running)" }).click();
    await expect(page.getByRole("tab")).toHaveCount(0);
    expect(omicron.cli("sessions", "hosted")).toContain("parser");
  } finally {
    win.kill();
  }
});

test("the Dev view's session buttons: open in a folder, hand off, end", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  const dir = require("node:fs").realpathSync(omicron.folder());
  const folderName = require("node:path").basename(dir);
  omicron.cli("folders", "add", dir, "--project", name);
  omicron.cli("machines", "owner", robin.login);
  await page.goto(`${page.url().split("?")[0]}?view=dev`);

  // Open: a new session in the folder, named after it, in a new tab.
  // The folder by its name, the rest dimmed; New session says what it does (#178).
  await expect(page.getByRole("complementary", { name: "Folders and sessions" })).toContainText(dir.replace(/\/+$/, "").split("/").pop());
  await page.getByRole("button", { name: "Add Folder" }).click();
  await expect(page.getByText("omicron folders add", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: `Open a new session in ${dir}` }).click();
  await expect(page.getByRole("tab", { name: folderName })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("list", { name: "Sessions" })).toContainText(folderName);
  const pid = Number(require("node:fs").readFileSync(require("node:path").join(omicron.home, `pid-${folderName}`), "utf8").trim());
  const term = page.getByTestId(`terminal-${folderName}`);
  // The stand-in claude runs no hooks: say it started, as Claude Code would.
  const [row] = await rest(request, robin.session, "GET", `/rest/v1/sessions?name=eq.${folderName}&select=claude_session_id`);
  omicron.hook(pid, "session-start", { session_id: row.claude_session_id, cwd: dir, source: "startup" });
  try {
    // Hand off: it's asked for its note; once the note is saved, /clear.
    await page.getByRole("button", { name: "Hand off" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Asked" })).toContainText(`Asked ${folderName} for its handoff note`);
    await expect(term.locator(".xterm-rows")).toContainText("Omicron: write your handoff note now");
    omicron.cliIn(pid, "handoff", "write", "# Where I stopped\nParser half done.");
    await expect(term.locator(".xterm-rows")).toContainText("/clear", { timeout: 15_000 });
    // Its past notes are under it.
    await page.getByText("1 handoff note").click();
    await expect(page.getByRole("list", { name: "Sessions" })).toContainText("#1");
    if (process.env.OMICRON_SHOTS) await page.screenshot({ path: `${process.env.OMICRON_SHOTS}/dev-buttons.png` });

    // End: asks once more, then quits Claude.
    await page.getByRole("button", { name: "End", exact: true }).click();
    const ask = page.getByRole("alertdialog", { name: `End ${folderName}?` });
    // Nothing is chosen for you: Return alone doesn't end it (#196).
    await expect(ask.getByRole("button", { name: "End Session" })).not.toBeFocused();
    await ask.getByRole("button", { name: "End Session" }).click();
    await expect(page.getByRole("status").filter({ hasText: "quit" })).toHaveText(`Asked ${folderName} to quit.`);
  } finally {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
});

test("This computer, in the Dev view: setup checks, loops, accounts and teams", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  const claude = crypto.randomUUID();
  const win = await omicron.open("parser", name, claude);
  try {
    omicron.cli("machines", "owner", robin.login);
    await page.goto(`${page.url().split("?")[0]}?view=dev`);
    await page.getByRole("button", { name: "This computer" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("heading", { name: machineName })).toBeVisible();
    await expect(sheet.getByRole("region", { name: "Setup checks" })).toContainText(`This computer: ${machineName}`);
    // Plain words, no commands, and a button where the page can fix it
    // (#179, #207). Not pressed here: it would set up this Mac for real.
    const checks = sheet.getByRole("region", { name: "Setup checks" });
    await expect(checks).not.toContainText("Daemon");
    await expect(checks).not.toContainText("supabase.co");
    await expect(checks).not.toContainText("omicron ");
    await expect(checks.getByRole("button", { name: "Start with this computer" })).toHaveCount(1);
    const accounts = sheet.getByRole("region", { name: "Claude accounts" });
    await expect(accounts).toContainText("No Claude accounts saved on this computer.");
    await expect(accounts).not.toContainText("<name>");
    await expect(accounts.getByRole("button", { name: "Copy" })).toBeVisible();
    // Copying refused: it says so, not "Copied" (#243).
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("no"));
      document.execCommand = () => false;
    });
    await accounts.getByRole("button", { name: "Copy" }).click();
    await expect(accounts.getByRole("button", { name: "Couldn't Copy" })).toBeVisible();
    await expect(sheet.getByRole("region", { name: "Teams" })).toBeVisible();

    // A loop for a session here: started and stopped from the Runs tab (#251).
    await escape(page);
    await tab(page, "Runs");
    const runs = page.getByRole("region", { name: "Runs and loops" });
    await runs.getByLabel("What to type into parser").fill("Keep going with the next task");
    await runs.getByLabel("How often, for parser").selectOption({ label: "15 minutes" });
    await runs.getByRole("button", { name: "Start loop" }).click();
    const loops = runs.getByRole("region", { name: "Loops" });
    await expect(loops).toContainText("“Keep going with the next task” every 15m");
    expect(omicron.cli("loops", "list", "--as-machine")).toContain("Keep going with the next task");
    if (process.env.OMICRON_SHOTS) await page.screenshot({ path: `${process.env.OMICRON_SHOTS}/this-computer.png` });
    await loops.getByRole("button", { name: "Stop" }).click();
    await expect(loops.getByRole("button", { name: "Start loop" })).toBeVisible();
  } finally {
    win.kill();
  }
});

test.describe("on a touch screen", () => {
  test.use({ hasTouch: true });
test("the Dev view on a phone, through the home lab's gate, for the computer's owner", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const robin = await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Write the parser");
  const claude = crypto.randomUUID();
  const win = await omicron.open("parser", name, claude);
  try {
    omicron.cli("machines", "owner", robin.login);
    await page.goto(`${page.url().split("?")[0]}?view=dev`);
    // One pane at a time, all of it on screen (#149): the sessions and This
    // computer first, and nothing says "on the left".
    const sessions = page.getByRole("list", { name: "Sessions" });
    const panes = page.getByRole("radiogroup", { name: "Show" });
    await expect(panes.getByRole("radio", { name: "Sessions" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "This computer" })).toBeInViewport();
    await expect(page.getByRole("region", { name: "Terminals" })).toBeHidden();
    await panes.getByRole("radio", { name: /^Terminal/ }).click();
    await expect(page.getByText("Pick a session to open its terminal here.")).toBeVisible();
    // Two panes only: the board is the Tasks tab (#250).
    await expect(panes.getByRole("radio")).toHaveCount(2);
    await panes.getByRole("radio", { name: "Sessions" }).click();
    // Opening a session shows its terminal.
    await sessions.getByRole("button", { name: /parser/ }).click();
    await expect(panes.getByRole("radio", { name: /^Terminal/ })).toHaveAttribute("aria-checked", "true");
    const term = page.getByTestId("terminal-parser");
    await expect(term.getByRole("status")).toHaveCount(0);
    // The terminal fits the screen: nothing scrolls sideways.
    const box = await term.boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await term.locator(".xterm").click();
    await page.keyboard.type("from the phone");
    await expect(term.locator(".xterm-rows")).toContainText("from the phone");
    // Keys a phone's keyboard doesn't have (#150): each sends what a
    // keyboard would; Ctrl applies to the next letter typed.
    const keys = term.getByRole("toolbar", { name: "Extra keys" });
    const sent = (data) => page.waitForRequest((r) => r.url().endsWith("/input") && JSON.parse(r.postData() ?? "{}").data === data);
    const ctrl = keys.getByRole("button", { name: "Control", exact: true });
    await ctrl.tap();
    await expect(ctrl).toHaveAttribute("aria-pressed", "true");
    const ctrlA = sent("\x01");
    await page.keyboard.type("a");
    await ctrlA;
    await expect(ctrl).toHaveAttribute("aria-pressed", "false");
    // Last: Ctrl-C ends the stand-in session.
    for (const [name, data] of [["Escape", "\x1b"], ["Shift+Tab", "\x1b[Z"], ["Up", "\x1b[A"], ["Control+C", "\x03"]]) {
      const req = sent(data);
      await keys.getByRole("button", { name, exact: true }).tap();
      await req;
    }
    if (process.env.OMICRON_SHOTS) await page.screenshot({ path: `${process.env.OMICRON_SHOTS}/dev-phone.png`, fullPage: true });
  } finally {
    win.kill();
  }
});
});

test("run rules are set in Project settings", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await tab(page, "Settings");
  const rules = page.getByLabel("Run rules");
  // Folded on a new Project (#160).
  await expect(rules).toBeHidden();
  await settingsTab(page).getByText("Claude sessions", { exact: true }).click();
  await rules.fill("Run the tests.\nCommit and push.");
  await rules.blur();
  await expect.poll(() => omicron.cli("projects", "rules", name, "--as-machine")).toContain("Run the tests.\nCommit and push.");
  await page.reload();
  await expect(page.getByLabel("Run rules")).toHaveValue("Run the tests.\nCommit and push.");
});

test("a run: started from the page, followed, paused after its task", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Write the parser");
  omicron.cli("tasks", "add", name, "Write the tests", "--as-machine");
  const claude = crypto.randomUUID();
  const win = await omicron.open("parser", name, claude);
  let daemon;
  try {
    omicron.cli("machines", "owner", robin.login);
    daemon = await omicron.daemon();
    // Runs have their own tab (#251), not the Tasks view.
    await page.reload();
    await expect(page.getByRole("button", { name: "Start Run" })).toHaveCount(0);
    await tab(page, "Runs");
    await expect(page).toHaveURL(/view=runs/);
    await page.getByRole("button", { name: "Start Run" }).click();
    // On its own computer a run needs no gate, so nothing about one (#152).
    await expect(page.getByRole("dialog").getByRole("button", { name: "Start", exact: true })).toBeVisible();
    await expect(page.getByTestId("start-gate")).toHaveCount(0);
    // What it'll do, said before it starts (#169).
    await expect(page.getByTestId("start-summary")).toContainText("2 tasks to do, starting with #1 Write the parser.");
    await page.getByRole("dialog").getByRole("button", { name: "Start", exact: true }).click();
    const bar = page.getByTestId("run");
    await expect(bar).toContainText("Run in parser");
    await expect(bar).toContainText("Working on #1 Write the parser");
    await expect(bar).toContainText("0 of 2 done");
    // Its sheet: what's next, and when it ends.
    await bar.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).not.toContainText("It stops when To do is empty.");
    await expect(sheet.getByRole("region", { name: "Up next" })).toContainText("#2 Write the tests");
    await escape(page);
    // Stop now asks first, as an alert: no ×, and Cancel keeps it (#223).
    await page.getByRole("button", { name: "Stop now" }).click();
    const stop = page.getByRole("alertdialog", { name: "Stop the run now?" });
    await expect(stop.getByRole("button", { name: "Close" })).toHaveCount(0);
    await stop.getByRole("button", { name: "Cancel" }).click();
    await expect(bar).toContainText("Run in parser");
    await expect(page.getByTestId("run-gate")).toHaveCount(0);
    if (process.env.OMICRON_SHOTS) await page.screenshot({ path: `${process.env.OMICRON_SHOTS}/run-bar.png` });

    // Paused: it stops once the task it's on is finished.
    await page.getByRole("button", { name: "Pause after this task" }).click();
    await expect(bar).toContainText("Run, pausing");
    omicron.cli("tasks", "done", name, "1", "--as-machine");
    await expect(bar).toContainText("Last run in parser: paused after #1");
    await expect(bar).toContainText("1 done");
    await bar.click();
    await expect(page.getByRole("dialog")).toContainText("The last run");
    await expect(page.getByRole("dialog").getByRole("region", { name: "Notes after each task" })).toContainText("No notes yet.");
  } finally {
    daemon?.stop();
    win.kill();
  }
});

test("adding tasks: Enter adds and keeps going, long titles wrap, Shift+Enter opens it at its notes", async ({ page, request }) => {
  await newPerson(page, request);
  await startProjectIn(page, unique("Home"));
  await column(page, "To do").getByRole("button", { name: "Add Task" }).click();
  const box = page.getByLabel("New task in To do");
  await box.fill("Buy milk");
  await page.keyboard.press("Enter");
  await expect(column(page, "To do").getByRole("button", { name: /Buy milk/ })).toBeVisible();
  await expect(box).toHaveValue("");
  await expect(box).toBeFocused();
  // Said for screen readers, and who and when can be set as it's added (#167).
  await expect(column(page, "To do").getByRole("status")).toHaveText("Added #1.");
  await page.getByRole("button", { name: "For: Anyone" }).click();
  await page.getByRole("menuitemradio", { name: /\(you\)/ }).click();
  await page.getByRole("button", { name: "No date" }).click();
  await page.getByRole("button", { name: /^Tomorrow/ }).click();
  await box.fill("Book a sitter");
  await page.keyboard.press("Enter");
  const sitter = column(page, "To do").getByRole("button", { name: /^#2 Book a sitter/ });
  await expect(sitter).toBeVisible();
  const [y, m, d] = (() => { const t = new Date(); t.setDate(t.getDate() + 1); return [t.getFullYear(), t.getMonth(), t.getDate()]; })();
  await expect(sitter).toContainText(new Date(y, m, d).toLocaleDateString("en-US", { month: "short", day: "numeric" }));
  // Picked for that one only: the next starts again from Anyone and no date.
  await expect(page.getByRole("button", { name: "For: Anyone" })).toBeVisible();
  await expect(page.getByRole("button", { name: "No date" })).toBeVisible();

  // A long title wraps onto more lines instead of scrolling sideways.
  const before = (await box.boundingBox()).height;
  await box.fill("Plant the tulips along the fence before the first frost comes, and the daffodils by the gate too");
  expect((await box.boundingBox()).height).toBeGreaterThan(before);
  expect(await box.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  // Shift+Enter (or Add and open) adds it and opens it, ready for its notes.
  await page.getByRole("button", { name: "Add and open" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Plant the tulips along the fence");
  await expect(dialog.getByLabel("Notes")).toBeFocused();
  // Its long title wraps in the sheet too (#59).
  const titleBox = dialog.getByLabel("Title");
  expect(await titleBox.evaluate((el) => el.scrollWidth <= el.clientWidth && el.clientHeight > 40)).toBe(true);
  if (process.env.OMICRON_SHOTS) await page.screenshot({ path: `${process.env.OMICRON_SHOTS}/task-sheet.png` });
  await page.keyboard.type("Bulbs are in the shed.");
  await escape(page);
  await expect(column(page, "To do").getByRole("button", { name: /Plant the tulips/ })).toBeVisible();
});

test("a column's ⋯ menu organizes it, and finishing a task doesn't scroll the board away", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Home");
  await startProjectIn(page, name);
  for (const t of ["Cherry pie", "Apple crumble", "Banana bread"]) omicron.cli("tasks", "add", name, t, "--as-machine");
  // A long Done column.
  for (let i = 1; i <= 14; i++) omicron.cli("tasks", "add", name, `Old thing ${i}`, "--status", "Done", "--as-machine");
  await page.reload();
  const titles = () => column(page, "To do").getByRole("button", { name: /^#\d+ / }).allTextContents();

  await column(page, "To do").getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Sort by" }).click();
  await page.getByRole("menuitem", { name: "Name", exact: true }).click();
  await expect.poll(async () => (await titles()).map((t) => t.replace(/#\d+$/, ""))).toEqual(["Apple crumble", "Banana bread", "Cherry pie"]);
  await column(page, "To do").getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Sort by" }).click();
  await page.getByRole("menuitem", { name: "Number", exact: true }).click();
  await expect.poll(async () => (await titles()).map((t) => t.replace(/#\d+$/, ""))).toEqual(["Cherry pie", "Apple crumble", "Banana bread"]);
  // Sorting reorders for good, so it says so, with Undo (#182).
  await expect(page.getByText("To do sorted by number")).toBeVisible();
  await column(page, "To do").getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Sort by" }).click();
  await page.getByRole("menuitem", { name: "Name", exact: true }).click();
  await expect.poll(async () => (await titles()).map((t) => t.replace(/#\d+$/, ""))).toEqual(["Apple crumble", "Banana bread", "Cherry pie"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await titles()).map((t) => t.replace(/#\d+$/, ""))).toEqual(["Cherry pie", "Apple crumble", "Banana bread"]);
  // Add a task here, from the same menu.
  await column(page, "To do").getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Add Task Here" }).click();
  await expect(page.getByLabel("New task in To do")).toBeFocused();
  await page.keyboard.press("Escape");
  // The Done column says so with a check, not a second "Done".
  await expect(column(page, "Done").getByTitle("Tasks here count as done")).toBeVisible();

  // Marked done from its sheet: it goes to Done, and closing the sheet
  // leaves the board where it was.
  await column(page, "To do").getByRole("button", { name: /Apple crumble/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "More for this task" }).click();
  await expect(page.getByRole("menuitem", { name: "Copy link" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Mark done" }).click();
  await escape(page);
  await expect(column(page, "Done")).toContainText("Apple crumble");
  const scrolled = await column(page, "Done").getByRole("list").evaluate((el) => el.scrollTop);
  expect(scrolled).toBe(0);
});

test("a dispatch left waiting by an asker who went away shows as failed, and Dispatch works again", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Write the parser");
  const claude = crypto.randomUUID();
  const win = await omicron.open("parser", name, claude);
  try {
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: omicron.folder(), source: "resume" });
    omicron.cli("tasks", "send", name, "1", "parser", "--as-machine");
    // Asked for, then the tab closed: nobody gave up on it.
    const [task] = await rest(request, robin.session, "GET", `/rest/v1/tasks?number=eq.1&select=id,projects!inner(name)&projects.name=eq.${encodeURIComponent(name)}`);
    const [d] = await rest(request, robin.session, "POST", "/rest/v1/dispatches", { task_id: task.id });
    const res = await request.fetch(`${need("OMICRON_SUPABASE_URL")}/rest/v1/dispatches?id=eq.${d.id}`, {
      method: "PATCH",
      headers: { apikey: need("OMICRON_SUPABASE_SECRET_KEY"), Authorization: `Bearer ${need("OMICRON_SUPABASE_SECRET_KEY")}` },
      data: { created_at: "2020-01-01T00:00:00Z", claim_by: "2020-01-01T00:00:20Z" },
    });
    expect(res.ok()).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: "#1 Write the parser" }).click();
    await expect(page.getByTestId("dispatch")).toContainText("didn't pick it up in time");
    await expect(page.getByRole("button", { name: "Sending" })).toHaveCount(0);
    // Its computer isn't awake here (no daemon): no button, and the line
    // says why (#219). Awake, Send again shows (the Dispatch test).
    await expect(page.getByTestId("dispatch")).toContainText("is off, so it can't be sent now");
    await expect(page.getByRole("button", { name: "Send again" })).toHaveCount(0);
  } finally {
    win.kill();
  }
});

test("a card dropped between tied cards lands there, and Organize while filtered numbers the whole column (#118)", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  const name = unique("Home");
  await startProjectIn(page, name);
  for (const t of ["Milk", "Bread", "Eggs", "Butter"]) omicron.cli("tasks", "add", name, t, "--as-machine");
  // Ties, as an old Organize or a team's question used to leave them.
  const tasks = await rest(request, robin.session, "GET", `/rest/v1/tasks?select=id,title,projects!inner(name)&projects.name=eq.${encodeURIComponent(name)}`);
  const id = (t) => tasks.find((x) => x.title === t).id;
  for (const [t, position] of [["Milk", 1], ["Bread", 1], ["Butter", 2], ["Eggs", 3]]) {
    await rest(request, robin.session, "PATCH", `/rest/v1/tasks?id=eq.${id(t)}`, { position });
  }
  await page.reload();
  const todo = column(page, "To do");
  const titles = async () => (await todo.getByRole("button", { name: /^#\d+ / }).allTextContents()).map((t) => t.replace(/#\d+$/, "").trim());
  await expect.poll(titles).toEqual(["Milk", "Bread", "Butter", "Eggs"]);

  // Eggs dropped between Milk and Bread lands there.
  const from = await todo.getByRole("button", { name: /Eggs/ }).boundingBox();
  const to = await todo.getByRole("button", { name: /Bread/ }).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 6, { steps: 15 });
  await page.waitForTimeout(150);
  // Shown at once; saved a moment later (wait for it before reloading).
  const saved = page.waitForResponse((r) => r.url().includes("/rest/v1/tasks") && r.request().method() === "PATCH" && r.request().postData()?.includes('"status_id"'));
  await page.mouse.up();
  await expect.poll(titles).toEqual(["Milk", "Eggs", "Bread", "Butter"]);
  await saved;
  await page.reload();
  await expect.poll(titles).toEqual(["Milk", "Eggs", "Bread", "Butter"]);

  // Organize while a search hides some: the whole column is put in order.
  await page.getByLabel("Search tasks").fill("b");
  await todo.getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Sort by" }).hover();
  await page.getByRole("menuitem", { name: "Name", exact: true }).click();
  await page.getByLabel("Search tasks").fill("");
  await expect.poll(titles).toEqual(["Bread", "Butter", "Eggs", "Milk"]);
});

test("a Project you're not in isn't shown", async ({ page, request }) => {
  await newPerson(page, request);
  await page.goto(`${omicron.url}/p/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByRole("heading", { level: 1, name: "Can't open this Project" })).toBeVisible();
  // Why, what to do, and the way back, with the usual top bar (#168).
  await expect(page.getByText("Ask whoever sent you the link to add you.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await page.getByRole("button", { name: "Back to Projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
});

test("a Project's Claude sessions show, and follow the session live", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  // Sessions are on the Dev tab (#248).
  await tab(page, "Dev");
  await expect(page.getByRole("region", { name: "Claude sessions" })).toHaveCount(0);
  await expect(page.getByText("No Claude sessions in this Project.")).toBeVisible();

  // A Claude Code window on the machine starts, and adds itself.
  const claude = crypto.randomUUID();
  const win = await omicron.open("parser", name, claude);
  try {
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: "/work/code", source: "startup" });
    const sessions = page.getByRole("region", { name: "Claude sessions" });
    await expect(sessions).toContainText(`parser${machineName}`);

    // Its handoff notes show when the session is tapped, live.
    await sessions.getByRole("button", { name: /parser/ }).click();
    await expect(page.getByRole("dialog")).toContainText("No notes yet.");
    // What it's doing, first (#170).
    await expect(page.getByTestId("session-doing")).toHaveText("Nothing given to it");
    omicron.cliIn(win.pid, "handoff", "write", "# Parser\n\nHalf done. Next: **error messages**.");
    const notes = page.getByRole("list", { name: "Handoff notes" });
    // Its state in plain words, and its Markdown shown as text.
    await expect(notes).toContainText("Not picked up yet");
    await expect(notes.getByRole("heading", { name: "Parser" })).toBeVisible();
    await expect(notes.locator("strong")).toHaveText("error messages");
    await escape(page);

    // It's closed: it ends, and leaves the page without reloading.
    omicron.hook(win.pid, "session-end", { session_id: crypto.randomUUID(), reason: "prompt_input_exit" });
    await expect(page.getByRole("region", { name: "Claude sessions" })).toHaveCount(0);
  } finally {
    win.kill();
  }
});

test("a session's tasks can be given away one at a time or all at once (#171)", async ({ page, request }) => {
  await newPerson(page, request, "Robin Example");
  const name = unique("Code");
  await startProjectIn(page, name);
  for (const t of ["Write the parser", "Write the tests", "Write the docs"]) omicron.cli("tasks", "add", name, t, "--as-machine");
  const claude = crypto.randomUUID();
  const win = await omicron.open("parser", name, claude);
  try {
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: "/work/code", source: "startup" });
    for (const n of ["1", "2", "3"]) omicron.cliIn(win.pid, "tasks", "send", name, n, "parser", "--as-machine");
    await tab(page, "Dev");
    const sessions = page.getByRole("region", { name: "Claude sessions" });
    await sessions.getByRole("button", { name: /parser/ }).click();
    const sheet = page.getByRole("dialog");
    const open = sheet.getByRole("list", { name: "Open tasks" });
    await expect(open.getByRole("listitem")).toHaveCount(3);

    // One, to a person: only that one goes.
    await sheet.getByRole("combobox", { name: "Give #1 to" }).click();
    await page.getByRole("option", { name: "Robin Example" }).click();
    await expect(open.getByRole("listitem")).toHaveCount(2);
    // All of them, said as all.
    await expect(sheet.getByRole("combobox", { name: "Give parser's open tasks to" })).toHaveText("Give all 2 open tasks to…");
    // A row opens its task.
    await open.getByRole("button", { name: /#2 Write the tests/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Write the tests");
    await expect(page.getByLabel("Given to", { exact: true })).toHaveText("parser");
    await escape(page);
    await tab(page, "Dev");
    await sessions.getByRole("button", { name: /parser/ }).click();
    await sheet.getByRole("combobox", { name: "Give parser's open tasks to" }).click();
    await page.getByRole("option", { name: "Robin Example" }).click();
    await expect(sheet.getByRole("list", { name: "Open tasks" })).toHaveCount(0);
  } finally {
    win.kill();
  }
});

test("a task sent to a Claude session from the page is picked up by it", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Write the parser");

  const claude = crypto.randomUUID();
  const win = await omicron.open("parser", name, claude);
  try {
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: "/work/code", source: "startup" });
    await tab(page, "Dev");
    await expect(page.getByRole("region", { name: "Claude sessions" })).toContainText("parser");
    await tab(page, "Tasks");

    const card = page.getByRole("button", { name: "#1 Write the parser" });
    await card.click();
    await pick(page, "Given to", "parser");
    await expect(page.getByTestId("dispatch")).toHaveText("parser gets it when it next looks for tasks.");
    // Saved (the page shows it a moment before).
    await expect.poll(() => omicron.cliIn(win.pid, "tasks", "show", name, "1", "--as-machine")).toContain("sent to session parser");

    // The end of the session's turn doesn't hand it over...
    expect(omicron.hook(win.pid, "stop", { session_id: claude, stop_hook_active: false })).toBe("");
    await expect(page.getByTestId("dispatch")).toHaveText(/parser gets it when it next looks for tasks\./);
    // Given from the page, so from elsewhere: only to read until the
    // machine's owner gives it with its gate open (ref/BRAINSTORM.md, "The gate").
    let mine = omicron.cliIn(win.pid, "tasks", "mine", "--as-machine");
    expect(mine).toContain("Given to this session from elsewhere, only to read");
    await expect(page.getByTestId("dispatch")).toHaveText(/parser gets it when it next looks for tasks\./);
    omicron.cli("machines", "owner", robin.login);
    const later = new Date(Date.now() + 2 * 3600 * 1000);
    omicron.cli("remote", "on", "--until", `${later.getHours()}:${String(later.getMinutes()).padStart(2, "0")}`);
    // ...the session gets it when told to get its tasks.
    mine = omicron.cliIn(win.pid, "tasks", "mine", "--as-machine");
    expect(mine).toContain(`#1 in ${name}: Write the parser (new)`);
    await expect(page.getByTestId("dispatch")).toHaveText("parser has it.");
    await expect(page.getByRole("button", { name: "Send now" })).toHaveCount(0);

    // It reports back and asks for review; the page shows it live.
    omicron.cliIn(win.pid, "tasks", "comment", name, "1", "Parser done, with tests.", "--review", "--as-machine");
    const comments = page.getByRole("list", { name: "Comments" });
    // The session is the author, its computer where; it's marked as the report (#173).
    await expect(comments.getByTestId("comment-author").first()).toHaveText(`parseron ${machineName}`);
    await expect(comments.getByTestId("report-mark")).toHaveText("Report · Needs review");
    await expect(comments).toContainText("Parser done, with tests.");
    await expect(page.getByTestId("needs-review")).toBeVisible();

    // A person answers from the page.
    await page.getByLabel("New comment").fill("Thanks, looks good.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(comments.getByRole("listitem")).toHaveCount(2);
    await expect(comments.getByRole("listitem").last()).toContainText("Thanks, looks good.");
    await escape(page);
    await expect(card).toContainText("2");
    await expect(card).toContainText("parser");
    await expect(card).not.toContainText("hasn't started it");
  } finally {
    win.kill();
  }
});

test("Dispatch hands a task to its session on its machine, and says how it went", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Write the parser");

  const claude = crypto.randomUUID();
  const win = await omicron.open("parser", name, claude);
  let daemon;
  let addon;
  try {
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: omicron.folder(), source: "resume" });
    await page.getByRole("button", { name: "#1 Write the parser" }).click();
    await pick(page, "Given to", "parser");

    // Omicron isn't running on the machine: it's off, and sending is too,
    // said in the one line beside the button (#154), never "daemon".
    const button = page.getByRole("button", { name: /^(Send now|Send again)$/ });
    const outcome = page.getByTestId("dispatch");
    await expect(outcome).toHaveText(`parser gets it when it next looks for tasks. ${machineName} is off, so it can't be sent now.`);
    // Off: no button to press, the line says why (#219).
    await expect(button).toHaveCount(0);

    // It wakes up: the page hears at once.
    daemon = await omicron.daemon();
    await expect(button).toBeEnabled();
    await expect(outcome).not.toContainText("is off");

    // Robin doesn't own the machine: refused, plainly.
    await button.click();
    await expect(outcome).toContainText(`${machineName} only takes orders from its owner`);

    // Robin owns it, and this page is served by that machine: it takes
    // Robin's orders from here with its gate closed (ref/BRAINSTORM.md, "The gate").
    omicron.cli("machines", "owner", robin.login);
    omicron.cli("remote", "off");

    // Its window is running but no add-on follows the inbox yet: the task
    // waits until one does.
    await button.click();
    await expect(outcome).toContainText(`parser on ${machineName} isn't ready for it yet. It gets the task as soon as it is (just now).`);

    // With the add-on: the waiting one arrives, and the next goes straight in.
    addon = await omicron.follow(claude);
    await button.click();
    await expect(outcome).toHaveText(`Sent the task to parser on ${machineName} (just now).`);
    await expect(page.getByRole("button", { name: "Send again" })).toBeVisible();
    await expect.poll(() => addon.got().length).toBe(2);
    expect(addon.got().every((m) => m.startsWith("Omicron dispatched task #1 \"Write the parser\""))).toBe(true);
  } finally {
    addon?.stop();
    win.kill();
    daemon?.stop();
  }
});

test("a sheet opened and closed doesn't stop the Project page's live updates", async ({ page, request }) => {
  const me = await newPerson(page, request);
  const projectId = await startProjectIn(page, unique("Code"));
  // Another tab opened and left (#248), then back on Tasks.
  await tab(page, "Settings");
  await expect(settingsTab(page)).toBeVisible();
  await tab(page, "Tasks");

  const [todo] = await rest(request, me.session, "GET", `/rest/v1/statuses?project_id=eq.${projectId}&name=eq.To%20do&select=id`);
  await rest(request, me.session, "POST", "/rest/v1/tasks", { project_id: projectId, status_id: todo.id, title: "Added while the page is open" });
  await expect(column(page, "To do").getByRole("button", { name: "#1 Added while the page is open" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("the board's columns are statuses or topics", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("House");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Water the plants");
  // No Claude sessions here: no Needs review filter either (#160).
  await expect(page.getByRole("group", { name: "Filters" }).getByRole("button", { name: "Needs review" })).toHaveCount(0);

  // By topic with no topics yet: one "No topic" column, and how to add some.
  await viewAs(page, "Topic");
  await expect(page.getByText(/No topics yet/)).toBeVisible();
  await expect(column(page, "No topic")).toContainText("Water the plants");
  // No columns by status at the same time.
  await expect(column(page, "To do")).toHaveCount(0);

  await page.getByRole("button", { name: "Add topics in Project settings" }).click();
  for (const topic of ["Joe's to-do", "Claire's to-do"]) {
    await page.getByLabel("New topic").fill(topic);
    await page.getByLabel("New topic").press("Enter");
    await expect(page.getByRole("list", { name: "Topics" }).getByLabel(`Topic name: ${topic}`)).toHaveValue(topic);
  }
  // Settings is a tab (#248): back to Tasks.
  await tab(page, "Tasks");

  // A column per topic, in order, then the tasks without one; no rows.
  const cols = page.locator("main section[aria-label]");
  await expect(cols).toHaveCount(3);
  await expect(cols.nth(0)).toHaveAttribute("aria-label", "Joe's to-do");
  await expect(cols.nth(1)).toHaveAttribute("aria-label", "Claire's to-do");
  await expect(cols.nth(2)).toHaveAttribute("aria-label", "No topic");
  // Each card says which status it's in.
  await expect(column(page, "No topic").getByRole("button", { name: /Water the plants/ })).toContainText("To do");

  // A task added in a topic column gets that topic, in the first status.
  await addTaskIn(page, "Joe's to-do", "Fix the gate");
  await page.getByRole("button", { name: "Cancel" }).click();

  // Dragged to another topic: the topic changes, the status doesn't.
  const card = (t) => page.getByRole("button", { name: new RegExp(`^#\\d+ ${t}`) });
  const said = page.locator('[id^="DndLiveRegion"]');
  const a = await card("Water the plants").boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 5 });
  await expect(said).toContainText(/Picked up|is over/);
  const b = await column(page, "Claire's to-do").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.waitForTimeout(150);
  // Where it will land is drawn in the column it's over (#213).
  await expect(column(page, "Claire's to-do").locator('li[aria-hidden="true"].bg-primary')).toHaveCount(1);
  const saved = page.waitForResponse((r) => r.url().includes("/rest/v1/tasks") && r.request().method() === "PATCH");
  await page.mouse.up();
  await expect(said).toContainText("Dropped");
  await expect(column(page, "Claire's to-do").locator('li[aria-hidden="true"].bg-primary')).toHaveCount(0);
  // The card it went to is focused, in view.
  await expect(column(page, "Claire's to-do").getByRole("button", { name: /Water the plants/ })).toBeFocused();
  await saved;
  await expect(column(page, "Claire's to-do")).toContainText("Water the plants");
  // Nothing left without a topic: that column goes.
  await expect(column(page, "No topic")).toHaveCount(0);

  // The choice is kept on reload; back to statuses, where nothing moved.
  await page.reload();
  await viewIs(page, "Topic");
  await expect(column(page, "Claire's to-do")).toContainText("Water the plants");
  await viewAs(page, "Status");
  await expect(column(page, "To do")).toContainText("Fix the gate");
  await expect(column(page, "To do")).toContainText("Water the plants");
  await page.getByRole("button", { name: /Water the plants/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Claire's to-do");
});

test("the board's columns can be who each task is given to (#166)", async ({ page, request }) => {
  await newPerson(page, request, "Robin Example");
  const name = unique("House");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Water the plants");
  await page.getByRole("button", { name: "Cancel" }).click();

  await viewAs(page, "Person");
  // You first, then Nobody (no other members yet).
  const cols = page.locator("main section[aria-label]");
  await expect(cols).toHaveCount(2);
  await expect(cols.nth(0)).toHaveAttribute("aria-label", "Robin Example");
  await expect(cols.nth(1)).toHaveAttribute("aria-label", "Nobody");
  await expect(column(page, "Nobody")).toContainText("Water the plants");

  // Added in your column: given to you.
  await addTaskIn(page, "Robin Example", "Fix the gate");
  await page.getByRole("button", { name: "Cancel" }).click();

  // Dragged from Nobody to you: given to you, status kept.
  const card = page.getByRole("button", { name: /^#1 Water the plants/ });
  const said = page.locator('[id^="DndLiveRegion"]');
  const a = await card.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 5 });
  await expect(said).toContainText(/Picked up|is over/);
  const b = await column(page, "Robin Example").boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.waitForTimeout(150);
  const saved = page.waitForResponse((r) => r.url().includes("/rest/v1/tasks") && r.request().method() === "PATCH");
  await page.mouse.up();
  await saved;
  await expect(column(page, "Robin Example")).toContainText("Water the plants");
  await expect(column(page, "Robin Example")).toContainText("Fix the gate");
  await column(page, "Robin Example").getByRole("button", { name: /^#1 Water the plants/ }).click();
  await expect(page.getByLabel("Given to", { exact: true })).toHaveText("Robin Example");
  await expect(page.getByLabel("Status", { exact: true })).toHaveText("To do");
});

test("a list view shows every task in one grouped list", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("House");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Water the plants");
  await page.getByLabel("New task in To do").fill("Fix the gate");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(column(page, "To do")).toContainText("Fix the gate");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: /Fix the gate/ }).click();
  await pick(page, "Status", "Done");
  await escape(page);

  await viewAs(page, "List");
  // Grouped by status, in the board's order; empty groups left out.
  const groups = page.locator("main section[aria-label]");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute("aria-label", "To do");
  await expect(groups.nth(1)).toHaveAttribute("aria-label", "Done");
  await expect(page.getByRole("list", { name: "To do" }).getByRole("button", { name: /^#\d+ Water the plants$/ })).toBeVisible();
  // The board's control is now "Group by".
  await page.getByRole("button", { name: /^View and filters/ }).click();
  await expect(page.getByRole("menu")).toContainText("Group by");
  await page.getByRole("menuitemradio", { name: "Status", exact: true }).click();
  await page.getByRole("menu").waitFor({ state: "detached" });

  // A row opens its task, by click or keyboard.
  const row = page.getByRole("button", { name: /^#\d+ Water the plants$/ });
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Water the plants");
  await escape(page);

  // Search narrows the list too.
  await page.getByLabel("Search tasks").fill("gate");
  await expect(groups).toHaveCount(1);
  await expect(groups.nth(0)).toHaveAttribute("aria-label", "Done");
  await page.getByLabel("Search tasks").fill("nothing like this");
  await expect(page.getByText("No tasks match “nothing like this”.")).toBeVisible();
  await page.getByLabel("Search tasks").fill("");

  // Grouped by topic: each row says its status.
  await viewAs(page, "Topic");
  await expect(groups).toHaveCount(1);
  await expect(groups.nth(0)).toHaveAttribute("aria-label", "No topic");
  await expect(row).toContainText("To do");

  // Kept on reload; "c" goes back to the board to add a task.
  await page.reload();
  await viewIs(page, "List");
  await page.keyboard.press("c");
  await expect(page.getByLabel(/^New task in /)).toBeFocused();
  await expect(page.getByRole("region").first()).toBeVisible();
});

test("a team's question shows it's waiting on you, and what happened to the answer (#153)", async ({ page, request }) => {
  const me = await newPerson(page, request);
  const name = unique("Code");
  const projectId = await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Which API version should it use?");
  // The team and its question, as the team's computer would make them.
  const [task] = await rest(request, me.session, "GET", `/rest/v1/tasks?project_id=eq.${projectId}&select=id`);
  const [machine] = await admin(request, "GET", `/rest/v1/machines?name=eq.${machineName}&select=id`);
  await admin(request, "PATCH", `/rest/v1/machines?id=eq.${machine.id}`, { gate_until: null });
  const [team] = await admin(request, "POST", "/rest/v1/teams", { project_id: projectId, machine_id: machine.id, name: "Lumen", folder: "/tmp/lumen" });
  const [ask] = await admin(request, "POST", "/rest/v1/team_requests", { team_id: team.id, worker: "builder-2", task_id: task.id });
  await page.reload();

  // The card says so; the sheet says who asks.
  const card = page.getByRole("button", { name: /#1 Which API version/ });
  await expect(card).toContainText("Team is waiting on you");
  await card.click();
  const sheet = page.getByRole("dialog");
  // The question is the title; who asks is plain text; the box says whom
  // the answer goes to (#222).
  await expect(sheet.getByTestId("asked-by")).toHaveText("Lumen team, builder-2");
  await expect(sheet.getByLabel("New comment")).toHaveAttribute("placeholder", "Answer builder-2");
  await expect(sheet.locator("#task-notes")).toHaveCount(0);

  // Answered while the team's computer's gate is closed: held, and says so.
  await sheet.getByLabel("New comment").fill("Use version 2.");
  await sheet.getByRole("button", { name: "Send", exact: true }).click();
  await expect(sheet.getByTestId("answer-mark")).toHaveText(`Held until ${machineName}'s remote control is on`);

  // Passed on (as the computer marks it): it says to whom, and the card's mark goes.
  const [comment] = await rest(request, me.session, "GET", `/rest/v1/comments?task_id=eq.${task.id}&select=id`);
  await admin(request, "PATCH", `/rest/v1/team_requests?id=eq.${ask.id}`, { state: "answered", answer_comment_id: comment.id, answered_at: new Date().toISOString() });
  await expect(sheet.getByTestId("answer-mark")).toHaveText("Passed on to builder-2");
  await escape(page);
  await expect(card).not.toContainText("Team is waiting on you");
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
  // Full screen, with the comment's other image a swipe, button or key away (#155).
  const box = await viewer.boundingBox();
  const size = page.viewportSize();
  expect([box.width, box.height]).toEqual([size.width, size.height]);
  await expect(viewer).toContainText("1 of 2");
  await expect(viewer.getByRole("link", { name: "Open original" })).toHaveAttribute("href", /gate\.png/);
  await viewer.getByRole("button", { name: "Next image" }).click();
  await expect(page.getByRole("dialog", { name: "dropped.png" })).toContainText("2 of 2");
  await page.keyboard.press("ArrowRight");
  await expect(viewer).toContainText("1 of 2");
  // Tapped: at full size, to look around; tapped again, back to fit.
  const img = viewer.getByRole("img", { name: "gate.png" });
  await img.click();
  await expect(img).toHaveClass(/max-w-none/);
  await img.click();
  await expect(img).not.toHaveClass(/max-w-none/);
  await escape(page);
  await expect(viewer).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  // Focus goes back to the image that was opened.
  await expect(comments.getByRole("button", { name: "Open gate.png" })).toBeFocused();

  // A Claude session posts a screenshot with its report, from the command.
  const shot = require("node:path").join(require("node:os").tmpdir(), `${unique("shot")}.png`);
  require("node:fs").writeFileSync(shot, png);
  omicron.cli("tasks", "comment", name, "1", "Done, screenshot attached.", "--image", shot, "--as-machine");
  await expect(comments.getByRole("listitem").filter({ hasText: "Done, screenshot attached." }).getByRole("img")).toBeVisible();
});

test("a session taken out with its machine ends, and its tasks are flagged until given out", async ({ page, request }) => {
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
  await tab(page, "Dev");
  const sessions = page.getByRole("region", { name: "Claude sessions" });
  await expect(sessions).toContainText(`parser${box}`);

  // The machine is taken out of the Project: the session ends and leaves
  // the page, live, and its tasks say whose they were.
  await rest(request, robin.session, "DELETE", `/rest/v1/project_machines?project_id=eq.${projectId}&machine_id=eq.${uuid}`);
  await expect(sessions).toHaveCount(0);
  await tab(page, "Tasks");
  const card = page.getByRole("button", { name: "#1 Write the parser" });
  await expect(card).toContainText(/parser\s*has ended/);
  await card.click();
  // The sheet says what the card says, and offers Give to… right there (#172).
  await expect(page.getByLabel("Given to", { exact: true })).toHaveText("parser (ended)");
  await expect(page.getByTestId("ended-session")).toHaveText("parser has ended.");
  await expect(page.getByRole("button", { name: /^Send (now|again)$/ })).toHaveCount(0);

  // Given to a person, from the warning: no longer flagged.
  await page.getByRole("button", { name: "Give To…" }).click();
  await page.getByRole("option", { name: "Robin Example" }).click();
  await expect(page.getByTestId("ended-session")).toHaveCount(0);
  await escape(page);
  await expect(card).toContainText("RE");
  await expect(card).not.toContainText("ended");
  await expect(page.getByRole("button", { name: "#2 Write the docs" })).toContainText(/parser\s*has ended/);
});

test("a session's loop shows on the page, live, and can be stopped there", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  const claude = crypto.randomUUID();
  const win = await omicron.open("parser", name, claude);
  try {
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: "/work", source: "startup" });
    await tab(page, "Dev");
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
    // The Runs tab lists it too (#251).
    await escape(page);
    await tab(page, "Runs");
    await expect(page.getByRole("region", { name: "Runs and loops" })).toContainText("Keep going with the next task");
    await tab(page, "Dev");
    await sessions.getByRole("button", { name: /parser/ }).click();

    // Stopped from the page: gone from the sheet and the strip, and the command agrees.
    await page.getByRole("button", { name: "Stop loop" }).click();
    // It asks first: stopping is for good (#196).
    await page.getByRole("alertdialog", { name: "Stop this loop?" }).getByRole("button", { name: "Stop Loop" }).click();
    await expect(loop).toHaveCount(0);
    await escape(page);
    await expect(sessions.getByLabel("looping")).toHaveCount(0);
    expect(omicron.cliIn(win.pid, "loops", "list", "--project", name, "--as-machine")).toContain("No loops are running.");
  } finally {
    win.kill();
  }
});

test("the People page: everyone, their Projects, and adding or taking them out", async ({ page, request }) => {
  const me = await newPerson(page, request, "Robin Example");
  const garden = unique("Garden");
  const house = unique("House");
  await startProjectIn(page, garden);
  await startProjectIn(page, house);
  // Someone who has signed in but isn't in any Project yet.
  const sam = unique("Sam");
  await sessionFor(request, omicron, `${unique("sam")}@example.com`, sam);

  await page.goto(omicron.url);
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "People" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
  // How to add someone new: they open Omicron's address once (#158).
  await page.getByRole("button", { name: "Add person" }).click();
  const adding = page.getByRole("dialog", { name: "Add someone" });
  await expect(adding).toContainText("Once they’ve opened it, they’re listed here");
  await adding.getByRole("button", { name: "Done" }).click();
  await expect(adding).toHaveCount(0);
  await page.getByLabel("Search people").fill(sam);
  const row = page.getByRole("table", { name: "People" }).getByRole("row", { name: sam });
  // Their Projects as text; changed in a sheet from their ⋯ menu (#236).
  const projects = row.getByTestId("person-projects");
  await expect(projects).toHaveText("None");
  const toggle = async () => {
    await row.getByRole("button", { name: `More for ${sam}` }).click();
    await page.getByRole("menuitem", { name: "Projects…" }).click();
    const sheet = page.getByRole("dialog", { name: `${sam}'s Projects` });
    await sheet.getByLabel(garden, { exact: true }).click();
    await sheet.getByRole("button", { name: "Done" }).click();
    await expect(sheet).toHaveCount(0);
  };

  // Added to a Project: it shows at once.
  await toggle();
  await expect(projects).toHaveText(garden);

  // Taken out again.
  await toggle();
  await expect(projects).toHaveText("None");

  // Only the people in one Project (#73).
  await toggle();
  await expect(projects).toHaveText(garden);
  await page.getByLabel("Search people").fill("");
  await page.getByLabel("Only people in").selectOption({ label: `In ${house}` });
  await expect(page.getByRole("table", { name: "People" }).getByRole("row", { name: sam })).toHaveCount(0);
  await page.getByLabel("Only people in").selectOption({ label: `In ${garden}` });
  await expect(row).toBeVisible();
  if (process.env.OMICRON_SHOTS) await page.screenshot({ path: `${process.env.OMICRON_SHOTS}/people.png` });

  // Filtered to a Project, the first thing offered is taking them out of
  // just that one: they stay, in no Project of yours (#145).
  // Your own row's menu only changes your Projects (#236).
  const mine = page.getByRole("button", { name: "More for Robin Example" });
  await mine.click();
  await expect(page.getByRole("menuitem", { name: "Projects…" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Delete|^Remove from/ })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Projects…" }).click();
  await page.getByRole("dialog", { name: "Robin Example's Projects" }).getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await row.getByRole("button", { name: `More for ${sam}` }).click();
  await page.getByRole("menuitem", { name: `Remove from ${garden}` }).click();
  await expect(row).toHaveCount(0);
  await page.getByLabel("Only people in").selectOption({ label: "Everyone" });
  await expect(projects).toHaveText("None");
  await toggle();
  await page.getByLabel("Only people in").selectOption({ label: `In ${garden}` });

  // Deleted, after asking once more and naming what they leave: gone for good.
  await row.getByRole("button", { name: `More for ${sam}` }).click();
  await page.getByRole("menuitem", { name: `Delete ${sam}…` }).click();
  const asked = page.getByRole("alertdialog", { name: `Delete ${sam}?` });
  await expect(asked).toContainText(`taken out of ${garden}`);
  await asked.getByRole("button", { name: `Delete ${sam}`, exact: true }).click();
  await expect(asked).toHaveCount(0);
  await expect(page.getByRole("table", { name: "People" }).getByRole("row", { name: sam })).toHaveCount(0);
  await page.getByLabel("Only people in").selectOption({ label: "Everyone" });
  await page.getByLabel("Search people").fill(sam);
  await expect(page.getByText(/Nothing matches/)).toBeVisible();

  // Someone in a Project Robin isn't in: the Web Machine refuses.
  const zed = await sessionFor(request, omicron, `${unique("zed")}@example.com`, unique("Zed"));
  await rest(request, zed, "POST", "/rest/v1/rpc/start_project", { name: unique("Zed's") });
  const refused = await request.post(`${omicron.url}/api/people/${zed.person_id}/delete`, { headers: { Authorization: `Bearer ${me.session.access_token}` } });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error).toContain("in a Project you're not in");

  // Search narrows the table; the top menu goes back to Projects.
  await page.getByLabel("Search people").fill("nobody-like-this");
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Projects" }).click();
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
  // What a drag says aloud, as a screen reader hears it: each step waits for it.
  const said = page.locator('[id^="DndLiveRegion"]');
  async function drag(from, to, dy = -10) {
    const a = await from.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 10, { steps: 5 });
    await expect(said).toContainText(/Picked up|is over/);
    const b = await to.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + dy, { steps: 15 });
    // Let the board see where it's over before letting go.
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect(said).toContainText("Dropped");
  }

  // Within a status: Charlie to the top.
  await drag(card("Charlie"), card("Alpha"), -20);
  await expect.poll(async () => (await titles("To do")).map((t) => t.replace(/#\d+$/, "").trim())).toEqual(["Charlie", "Alpha", "Bravo"].map(String));
  // To another status.
  await drag(card("Alpha"), column(page, "Done"), 0);
  await expect(column(page, "Done")).toContainText("Alpha");

  // With the keyboard: Space picks Bravo up, the up arrow moves it, Space drops it.
  // The card says how to move it (#147).
  await expect(card("Bravo")).toHaveAccessibleDescription(/press Space/);
  await card("Bravo").focus();
  await page.keyboard.press("Space");
  // Picked up, and over its own place, in words: no ids (#147)...
  await expect(said).toContainText(/#\d+ Bravo is over To do, place 2 of 2\./);
  // ...then the up arrow moves it over Charlie's.
  await page.keyboard.press("ArrowUp");
  await expect(said).toContainText(/#\d+ Bravo is over To do, place 1 of 2\./);
  const moved = page.waitForResponse((r) => r.url().includes("/rest/v1/tasks") && r.request().method() === "PATCH");
  await page.keyboard.press("Space");
  await expect(said).toContainText(/Dropped #\d+ Bravo in To do, place 1 of 2\./);
  await expect(said).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}|col\|/);
  await moved;
  await expect.poll(async () => (await titles("To do")).map((t) => t.replace(/#\d+$/, "").trim())).toEqual(["Bravo", "Charlie"]);

  // Saved: the same after reloading.
  await page.reload();
  await expect.poll(async () => (await titles("To do")).map((t) => t.replace(/#\d+$/, "").trim())).toEqual(["Bravo", "Charlie"]);
  // Arrow keys go from card to card: down the column, across to the next (#174).
  await card("Bravo").focus();
  await page.keyboard.press("ArrowDown");
  await expect(card("Charlie")).toBeFocused();
  await page.keyboard.press("l");
  await expect(card("Alpha")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(card("Bravo")).toBeFocused();
  // Moved without dragging: Move to, in the task's menu.
  await card("Charlie").click();
  await page.getByRole("button", { name: "More for this task" }).click();
  await page.getByRole("menuitem", { name: "Move to" }).hover();
  await page.getByRole("menuitem", { name: "Done" }).click();
  await escape(page);
  await expect(column(page, "Done")).toContainText("Charlie");
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

  await tab(page, "Settings");
  const box = page.getByLabel("Label name: shop");
  await box.fill("groceries");
  await box.press("Enter");
  await expect(page.getByLabel("Label name: groceries")).toBeVisible();
  await tab(page, "Tasks");
  await expect(card).toContainText("groceries");

  await tab(page, "Settings");
  await page.getByRole("button", { name: "Remove label groceries" }).click();
  // On a task, so it asks first; Cancel keeps it (#196).
  const ask = page.getByRole("alertdialog", { name: "Delete “groceries”?" });
  await expect(ask).toContainText("It comes off 1 task.");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Label name: groceries")).toBeVisible();
  await page.getByRole("button", { name: "Remove label groceries" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete Label" }).click();
  await expect(page.getByRole("list", { name: "Labels" })).toHaveCount(0);
  await tab(page, "Tasks");
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
  await expect(dialog.getByRole("button", { name: "Create Project" })).toBeDisabled();
  await escape(page);
  await expect(dialog).toHaveCount(0);

  const name = unique("Kitchen");
  await page.getByRole("button", { name: "New Project" }).first().click();
  await page.getByLabel("New Project name").fill(name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("a new Project can start with people and machines, its machines change in settings, and it can be deleted", async ({ page, request }) => {
  await newPerson(page, request);
  // In a Project already: people in none yet see only themselves.
  await startProjectIn(page, unique("First"));
  const sam = unique("Sam");
  await sessionFor(request, omicron, `${unique("p")}@example.com`, sam);
  const [box, other] = [unique("box"), unique("box")];
  omicron.cli("machines", "register", box, "--print");
  omicron.cli("machines", "register", other, "--print");

  // People and machines are dropdowns, with nothing picked at first.
  await page.goto(omicron.url);
  await page.getByRole("button", { name: "New Project" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New Project" });
  await expect(dialog.getByRole("combobox", { name: "People" })).toHaveText("Just you");
  await expect(dialog.getByRole("combobox", { name: "Machines" })).toHaveText("No machines");
  await dialog.getByRole("combobox", { name: "People" }).click();
  await page.getByRole("option", { name: sam }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("combobox", { name: "People" })).toHaveText(sam);
  await dialog.getByRole("combobox", { name: "Machines" }).click();
  await page.getByRole("option", { name: box }).click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("combobox", { name: "Machines" })).toHaveText(box);
  const name = unique("Garden");
  await dialog.getByLabel("New Project name").fill(name);
  await dialog.getByRole("button", { name: "Create Project" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // It started with them, both in the Settings tab (#248).
  await tab(page, "Settings");
  await expect(page.getByRole("list", { name: "Members" })).toContainText(sam);
  const settings = settingsTab(page);
  const machines = settings.getByRole("combobox", { name: "Machines" });
  await expect(machines).toHaveText(box);

  // A machine added, and one taken out, with the same dropdown.
  await machines.click();
  await page.getByRole("option", { name: other }).click();
  await expect(page.getByRole("option", { name: other })).toHaveAttribute("data-checked", "true");
  await page.getByRole("option", { name: box }).click();
  await expect(page.getByRole("option", { name: box })).toHaveAttribute("data-checked", "false");
  await page.keyboard.press("Escape");
  await expect(machines).toHaveText(other);

  // Deleting asks for its name, typed, first.
  const del = settings.getByRole("button", { name: "Delete" });
  await expect(del).toBeDisabled();
  await settings.getByLabel("Delete Project").fill("garden");
  await expect(del).toBeDisabled();
  await settings.getByLabel("Delete Project").fill(name);
  await del.click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Projects" })).not.toContainText(name);
});

test("appearance: Light, Dark or the system, saved with you and on every device", async ({ page, request, browser }) => {
  const me = await newPerson(page, request);
  await page.goto(omicron.url);
  // Your menu, with Settings in it (#162).
  await page.getByTestId("me").click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  // The same top bar as the other pages.
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  const choice = (n) => page.getByRole("radio", { name: n });
  await expect(choice("Match the system")).toHaveAttribute("aria-checked", "true");
  const theme = (p) => p.evaluate(() => document.documentElement.dataset.theme ?? "system");

  // Saved with the person before anything else happens.
  const saved = page.waitForResponse((r) => r.url().includes("/rest/v1/people") && r.request().method() === "PATCH");
  await choice("Dark").click();
  await saved;
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

test("Machines: make a key for a new machine, see it, change its Projects, switch it off, remove it", async ({ page, request }) => {
  const me = await newPerson(page, request);
  const name = unique("Code");
  await startProjectIn(page, name);
  await page.goto(omicron.url);
  await page.getByTestId("me").click();
  await page.getByRole("button", { name: "Machines and their keys" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Machines" })).toBeVisible();

  const box = unique("box");
  await page.getByRole("button", { name: "New key" }).first().click();
  await page.getByLabel("Machine name").fill(box);
  // Their only Project is picked already.
  await expect(page.getByLabel(name)).toBeChecked();
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

  const row = page.getByRole("table", { name: "Machines" }).getByRole("row", { name: box });
  // A new key that hasn't connected says so, not "asleep" (#161).
  await expect(row).toContainText("Waiting to connect");
  const its = row.getByRole("combobox", { name: `${box}'s Projects` });
  await expect(its).toHaveText(name);
  // Its Projects change in place.
  await its.click();
  await page.getByRole("option", { name }).click();
  await page.keyboard.press("Escape");
  await expect(its).toHaveText("No Projects");
  await its.click();
  await page.getByRole("option", { name }).click();
  await page.keyboard.press("Escape");
  await expect(its).toHaveText(name);
  // Switch Off and Remove are in its ⋯ menu, with no lines of help under them (#217).
  await row.getByRole("button", { name: `More for ${box}` }).click();
  await expect(page.getByRole("menuitem", { name: /Switch Off/ })).toHaveText("Switch Off");
  await page.getByRole("menuitem", { name: /Switch Off/ }).click();
  await expect(row).toContainText("Switched off");
  // Switched off, the key gets nothing.
  expect(await rest(request, login, "GET", "/rest/v1/projects?select=name")).toEqual([]);
  await row.getByRole("button", { name: `More for ${box}` }).click();
  await page.getByRole("menuitem", { name: /Switch On/ }).click();
  await expect(row).toContainText(/Waiting to connect|Last seen just now/);
  // Removing asks first; Cancel keeps it.
  await row.getByRole("button", { name: `More for ${box}` }).click();
  await page.getByRole("menuitem", { name: new RegExp(`Remove ${box}…`) }).click();
  const ask = page.getByRole("alertdialog", { name: `Remove ${box}?` });
  await expect(ask).toContainText("This can't be undone.");
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toHaveCount(0);
  await row.getByRole("button", { name: `More for ${box}` }).click();
  await page.getByRole("menuitem", { name: new RegExp(`Remove ${box}…`) }).click();
  await ask.getByRole("button", { name: `Remove ${box}`, exact: true }).click();
  await expect(row).toHaveCount(0);

  // Machines outside your Projects can't be touched.
  const others = await rest(request, me.session, "GET", `/rest/v1/machines?name=eq.${machineName}&select=id`);
  const res = await request.post(`${omicron.url}/api/machines/${others[0].id}/remove`, {
    headers: { Authorization: `Bearer ${me.session.access_token}`, "tailscale-user-login": me.login },
  });
  expect(res.status()).toBe(403);
});

test("a task moves up or down its column from its menu, without dragging", async ({ page, request }) => {
  await newPerson(page, request);
  await startProjectIn(page, unique("House"));
  await addTaskIn(page, "To do", "First");
  for (const t of ["Second", "Third"]) {
    await page.getByLabel("New task in To do").fill(t);
    await page.getByRole("button", { name: "Add task", exact: true }).click();
  }
  await page.getByRole("button", { name: "Cancel" }).click();
  const order = () => column(page, "To do").getByRole("button", { name: /^#\d/ });
  await expect(order()).toHaveText([/First/, /Second/, /Third/]);
  const put = async (n, where) => {
    await page.getByRole("button", { name: new RegExp(`^#${n} `) }).click();
    await page.getByRole("button", { name: "More for this task" }).click();
    await page.getByRole("menuitem", { name: "Order" }).click();
    await page.getByRole("menuitem", { name: where }).click();
    await escape(page);
  };
  // To the top, then one down; it says so, with Undo (#212).
  await put(3, "To the Top");
  await expect(order()).toHaveText([/Third/, /First/, /Second/]);
  await expect(page.getByRole("status").filter({ hasText: "Moved #3 in To do" })).toBeVisible();
  await put(3, "Move Down");
  await expect(order()).toHaveText([/First/, /Third/, /Second/]);
  // Where it can't go is greyed out.
  await page.getByRole("button", { name: /^#1 / }).click();
  await page.getByRole("button", { name: "More for this task" }).click();
  await page.getByRole("menuitem", { name: "Order" }).click();
  await expect(page.getByRole("menuitem", { name: "Move Up" })).toBeDisabled();
});

test("deleting a task can be undone, and it's gone for good after", async ({ page, request }) => {
  const me = await newPerson(page, request);
  const name = unique("House");
  const id = await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Fix the gate");
  await page.getByLabel("New task in To do").fill("Paint the fence");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByRole("button", { name: "Cancel" }).click();
  const card = page.getByRole("button", { name: /#1 Fix the gate/ });
  const next = page.getByRole("button", { name: /#2 Paint the fence/ });
  const del = async () => {
    await card.click();
    await page.getByRole("button", { name: "More for this task" }).click();
    await page.getByRole("menuitem", { name: "Delete task" }).click();
    await expect(card).toHaveCount(0);
  };

  // Deleted: focus goes to the next card, not the page (#148).
  await del();
  await expect(next).toBeFocused();
  const toast = page.getByRole("status").filter({ hasText: "Deleted #1 Fix the gate" });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole("button", { name: "Undo" })).toHaveAttribute("aria-keyshortcuts", /Meta\+Z/);
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(card).toBeVisible();

  // Cmd/Ctrl+Z brings it back too.
  await del();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(card).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Brought back #1 Fix the gate" })).toBeVisible();

  // Moves can be undone too, and Cmd+Z works back through several (#210).
  await card.click();
  await page.getByRole("button", { name: "More for this task" }).click();
  await page.getByRole("menuitem", { name: "Mark done" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Moved #1 to Done" })).toBeVisible();
  await escape(page);
  await expect(column(page, "Done").getByRole("button", { name: /#1 Fix the gate/ })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("status").filter({ hasText: "Moved #1 back to To do" })).toBeVisible();
  await expect(column(page, "To do").getByRole("button", { name: /#1 Fix the gate/ })).toBeVisible();
  await expect
    .poll(async () => (await rest(request, me.session, "GET", `/rest/v1/tasks?project_id=eq.${id}&number=eq.1&select=statuses(name)`))[0].statuses.name)
    .toBe("To do");

  // Not undone: deleted in the database after 10 seconds, so others see it
  // go, and the message then says so, without Undo (#211, #237).
  await del();
  const gone = page.getByRole("status").filter({ hasText: "Deleted #1 Fix the gate for good" });
  await expect(gone).toBeVisible({ timeout: 15000 });
  await expect(gone.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect
    .poll(async () => (await rest(request, me.session, "GET", `/rest/v1/tasks?project_id=eq.${id}&select=title`)).map((t) => t.title), { timeout: 10000 })
    .toEqual(["Paint the fence"]);
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
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(cards()).toHaveCount(3);
  // Nothing matches: said once, with the way back (#163).
  await page.getByLabel("Search tasks").fill("anniversary");
  await expect(page.getByRole("status").filter({ hasText: "No tasks match “anniversary”." })).toBeVisible();
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(cards()).toHaveCount(3);
  await expect(page.getByLabel("Search tasks")).toHaveValue("");

  // Mine: given to me.
  await cards().first().click();
  await pick(page, "Given to", "Robin Example");
  await escape(page);
  await page.getByRole("button", { name: "Mine" }).click();
  await expect(cards()).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Mine" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(cards()).toHaveCount(3);
});

test("keyboard: c adds where you are, Escape keeps your place, ? lists every shortcut (#176)", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("Home");
  await startProjectIn(page, name);
  omicron.cli("tasks", "add", name, "Paint the fence", "--as-machine");
  omicron.cli("tasks", "done", name, "1", "--as-machine");
  await page.reload();
  const done = page.getByRole("button", { name: /^#1 Paint the fence/ });
  await done.focus();
  await page.keyboard.press("c");
  await expect(page.getByLabel("New task in Done")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(column(page, "Done").getByRole("button", { name: "Add Task" })).toBeFocused();

  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(sheet).toContainText(/(⇧|Shift\+)Enter \(adding a task\)/);
  await expect(sheet).toContainText("Escape");
  // Escape closes it. Under load, the first press now and then doesn't
  // (seen only in full runs; see the #112 report), so it's pressed again
  // if the sheet is still up a second later.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0, { timeout: 1000 });
  }).toPass();
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
  // Projects load into the menu a moment after it opens.
  await expect(menu.getByRole("option", { name: new RegExp(name) })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // c adds a task; / searches (once the board is there).
  await expect(column(page, "To do")).toBeVisible();
  await settled(page);
  await page.keyboard.press("c");
  await expect(page.getByLabel("New task in To do")).toBeFocused();
  await page.keyboard.type("Plant tulips");
  await page.keyboard.press("Enter");
  await expect(column(page, "To do")).toContainText("Plant tulips");
  await escape(page);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("/");
  await expect(page.getByLabel("Search tasks")).toBeFocused();

  // Open a task from the menu by its number; switch the theme from it.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("#1");
  await expect(page.getByRole("option", { name: /Plant tulips/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Plant tulips");
  await escape(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("dark");
  await expect(page.getByRole("option", { name: /dark/i })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

  // On a Project page its own commands come first, in named groups, and
  // the theme in use is ticked (#183).
  await page.keyboard.press("Control+k");
  const groups = menu.getByRole("group");
  await expect(groups.first()).toHaveAccessibleName(name);
  await expect(menu.getByRole("group", { name: "Appearance" }).getByRole("option", { name: "Dark (now)" })).toBeVisible();
  await expect(menu.getByRole("option", { name: "Light", exact: true })).toBeVisible();
  await escape(page);
});

test("a change in a task shows at once, before it's saved", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("House");
  await startProjectIn(page, name);
  await addTaskIn(page, "To do", "Fix the gate");
  // Saving tasks is slow today: two seconds.
  let release;
  const held = new Promise((r) => (release = r));
  await page.route(/\/rest\/v1\/tasks\?/, async (route) => {
    if (route.request().method() === "PATCH") await held;
    await route.continue();
  });
  await page.getByRole("button", { name: /#1 Fix the gate/ }).click();
  await pick(page, "Status", "Done");
  await escape(page);
  // Already in Done, while the save is still held back (it's only let go
  // below, so any wait here is still before it's saved).
  await expect(column(page, "Done")).toContainText("Fix the gate", { timeout: 5000 });
  // Let the save go, and wait for it to land before reloading (a reload
  // would cancel it on the way).
  const saved = page.waitForResponse((r) => r.url().includes("/rest/v1/tasks") && r.request().method() === "PATCH");
  release();
  await saved;
  await page.reload();
  await expect(column(page, "Done")).toContainText("Fix the gate");
});

test("a remote control token lets the computer's owner in from a visit Tailscale can't vouch for (#96)", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  omicron.cli("machines", "owner", robin.login);
  // In a Project, so Robin sees the computer and Settings shows remote control (#227).
  await startProjectIn(page, unique("Code"));
  // Signed in as Robin, but this visit's Tailscale login is someone else's
  // (as on a page hosted elsewhere): no Dev side.
  const dev = (token, who = robin) =>
    request
      .post(`${omicron.url}/api/dev`, {
        headers: { Authorization: `Bearer ${who.session.access_token}`, ...(token ? { "Omicron-Remote": token } : {}) },
        data: {},
      })
      .then((r) => r.json());
  expect((await dev(null)).dev).toBe(false);
  // A token made on the computer: Robin's, shown once.
  const token = omicron.cli("remote", "token", "--for", "2h").trim();
  expect(token).toMatch(/^omr_[0-9a-f]{64}$/);
  expect((await dev(token)).dev).toBe(true);
  expect((await dev("omr_" + "0".repeat(64))).dev).toBe(false);
  // Someone else holding it: no.
  const sam = { session: await sessionFor(request, omicron, `${unique("p")}@example.com`, "Sam Example") };
  expect((await dev(token, sam)).dev).toBe(false);

  // In Settings: pasted, this browser can control the computer; Forget token takes it away.
  await page.route(`${omicron.url}/api/dev**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), "tailscale-user-login": "someone-else@example.com", "tailscale-user-name": "Someone" } }),
  );
  await page.goto(`${omicron.url}/settings`);
  const box = page.getByLabel("Token", { exact: true });
  // A secret: hidden as typed, shown on request (#235).
  await expect(box).toHaveAttribute("type", "password");
  await box.fill("omr_not-a-token");
  await page.getByRole("button", { name: "Show", exact: true }).click();
  await expect(box).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Use token" }).click();
  await expect(page.getByRole("alert")).toContainText("That token doesn't work on this computer");
  await box.fill(token);
  await page.getByRole("button", { name: "Use token" }).click();
  await expect(page.getByText(/^This browser can control /)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^This browser can control /)).toBeVisible();
  await page.getByRole("button", { name: "Forget token" }).click();
  await expect(page.getByLabel("Token", { exact: true })).toBeVisible();

  // Taken back on the computer: it stops working at once.
  const id = omicron.cli("remote", "list").split("\t")[0];
  omicron.cli("remote", "revoke", id);
  expect((await dev(token)).dev).toBe(false);
});

test("a change that fails says so, stays said through reloads, and can be tried again (#197)", async ({ page, request }) => {
  await newPerson(page, request);
  await startProjectIn(page, unique("House"));
  await addTaskIn(page, "To do", "Fix the gate");
  // The next save of a task is refused.
  let refuse = true;
  await page.route(/\/rest\/v1\/tasks\?/, (route) =>
    route.request().method() === "PATCH" && refuse
      ? route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ code: "42501", message: "new row violates row-level security policy" }) })
      : route.continue(),
  );
  await column(page, "To do").getByRole("button", { name: /Fix the gate/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "More for this task" }).click();
  await page.getByRole("menuitem", { name: "Mark done" }).click();
  const alert = page.getByRole("alert").filter({ has: page.getByRole("button", { name: "Try again" }) });
  await expect(alert).toBeVisible();
  // Later reloads of the board don't wipe it away.
  await page.waitForTimeout(3000);
  await expect(alert).toBeVisible();
  // Tried again once it can work: saved, and the message goes.
  refuse = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(alert).toHaveCount(0);
  await escape(page);
  await expect(column(page, "Done")).toContainText("Fix the gate");
});

test("a Project or the Projects list that can't load says so, with Try again (#198)", async ({ page, request }) => {
  await newPerson(page, request);
  const name = unique("House");
  await startProjectIn(page, name);
  const url = page.url();
  // Every read of the database fails, for now.
  let failing = true;
  await page.route(/\/rest\/v1\/(projects|statuses|tasks)\?/, (route) =>
    failing && route.request().method() === "GET" ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "server is down" }) }) : route.continue(),
  );
  await page.reload();
  await expect(page.getByRole("heading", { name: "Couldn't load this Project" })).toBeVisible();
  failing = false;
  await page.getByRole("main").getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  failing = true;
  await page.goto(url.split("/p/")[0] + "/");
  await expect(page.getByRole("heading", { name: "Couldn't load your Projects" })).toBeVisible();
  failing = false;
  await page.getByRole("main").getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
});

test("closing a task keeps a half-written comment and what was typed in its notes (#200)", async ({ page, request }) => {
  await newPerson(page, request);
  await startProjectIn(page, unique("House"));
  await addTaskIn(page, "To do", "Fix the gate");
  const open = () => column(page, "To do").getByRole("button", { name: /Fix the gate/ }).click();
  await open();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("New comment").fill("Half a thought");
  await escape(page);
  await open();
  await expect(sheet.getByLabel("New comment")).toHaveValue("Half a thought");
  // Sent: gone from the box, for next time too.
  await sheet.getByRole("button", { name: "Send" }).click();
  await expect(sheet.getByRole("list", { name: "Comments" })).toContainText("Half a thought");
  await escape(page);
  await open();
  await expect(sheet.getByLabel("New comment")).toHaveValue("");
  // Notes typed and closed straight away: saved.
  const saved = page.waitForResponse((r) => r.url().includes("/rest/v1/tasks") && r.request().method() === "PATCH" && r.request().postData()?.includes("Bring the drill"));
  await sheet.getByLabel("Notes").fill("Bring the drill");
  await page.keyboard.press("Escape");
  await saved;
  await page.reload();
  await open();
  await expect(sheet.getByLabel("Notes")).toHaveValue("Bring the drill");
});

test("Increase Contrast gives stronger borders, grey text and colors, light and dark", async ({ page, request }) => {
  await newPerson(page, request);
  await startProjectIn(page, unique("House"));
  const token = (name) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  const normal = await token("--border");
  await page.emulateMedia({ contrast: "more", colorScheme: "light" });
  // (#214)
  await expect.poll(() => token("--border")).toBe("0 0% 55%");
  expect(await token("--muted-foreground")).toBe("0 0% 24%");
  expect(await token("--sys-green")).toBe("#248a3d");
  await page.emulateMedia({ contrast: "more", colorScheme: "dark" });
  await expect.poll(() => token("--border")).toBe("0 0% 50%");
  expect(await token("--sys-green")).toBe("#30db5b");
  await page.emulateMedia({ contrast: "no-preference", colorScheme: "light" });
  await expect.poll(() => token("--border")).toBe(normal);
});

test("Settings: Ctrl/⌘-, opens it, shortcuts are a row, machine things only for people with a machine", async ({ page, request }) => {
  await newPerson(page, request);
  await startProjectIn(page, unique("House"));
  // (#227)
  await page.keyboard.press("ControlOrMeta+,");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Appearance" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Machines and their keys" })).toHaveCount(0);
  await expect(page.getByLabel("Token", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Settings");
});

test("columns are added, renamed and deleted from the board itself", async ({ page, request }) => {
  await newPerson(page, request);
  await startProjectIn(page, unique("House"));
  // (#228) New column at the end of the board: before Done.
  await page.getByRole("button", { name: "New Column" }).click();
  await page.getByLabel("New column").fill("Waiting");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("region")).toHaveText([/^To do/, /^Waiting/, /^Done/]);
  // Renamed from its ⋯ menu, in place.
  await column(page, "Waiting").getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Rename Column" }).click();
  await page.getByLabel("Column name").fill("Waiting on someone");
  await page.keyboard.press("Enter");
  await expect(column(page, "Waiting on someone")).toBeVisible();
  // Deleted while empty; a column with tasks, or Done, can't be.
  await column(page, "Done").getByRole("button", { name: /^More for / }).click();
  await expect(page.getByRole("menuitem", { name: "Delete Column" })).toBeDisabled();
  // Escape once the menu has focus (pressed sooner, it goes nowhere).
  await expect(page.getByRole("menu")).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "detached" });
  await column(page, "Waiting on someone").getByRole("button", { name: /^More for / }).click();
  await page.getByRole("menuitem", { name: "Delete Column" }).click();
  await expect(page.getByRole("region")).toHaveText([/^To do/, /^Done/]);
});

test("⌘K finds tasks in every Project, and lists recently opened ones before you type", async ({ page, request }) => {
  await newPerson(page, request);
  const garden = unique("Garden");
  await startProjectIn(page, garden);
  await addTaskIn(page, "To do", "Prune the roses");
  await page.getByRole("button", { name: "Cancel" }).click();
  await startProjectIn(page, unique("Kitchen"));
  // (#234) From another Project: found by its words, grouped by its Project.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Command" }).fill("prune roses");
  const found = page.getByRole("option", { name: /#1 Prune the roses/ });
  await expect(found).toBeVisible();
  await expect(page.getByRole("group", { name: `Tasks in ${garden}` })).toBeVisible();
  await found.click();
  await expect.poll(() => page.url()).toContain("task=1");
  await expect(page.getByRole("dialog")).toContainText("Prune the roses");
  await escape(page);
  await expect(page.getByRole("heading", { level: 1, name: garden })).toBeVisible();
  // Before typing: what was opened lately.
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("group", { name: "Recently opened" })).toContainText("Prune the roses");
});

test("someone added to a Project is told who added them, and can open it", async ({ page, request }) => {
  const robin = await newPerson(page, request);
  await page.goto(omicron.url);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  // Sam, elsewhere, adds Robin to Sam's Project (#244).
  const sam = await sessionFor(request, omicron, `${unique("sam")}@example.com`, "Sam Example");
  const garden = unique("Garden");
  const project = await rest(request, sam, "POST", "/rest/v1/rpc/start_project", { name: garden });
  await page.waitForTimeout(500);
  await rest(request, sam, "POST", "/rest/v1/project_members", { project_id: project.id, person_id: robin.session.person_id });
  const notice = page.getByRole("status").filter({ hasText: `Sam Example added you to ${garden}` });
  await expect(notice).toBeVisible({ timeout: 15000 });
  await notice.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("heading", { level: 1, name: garden })).toBeVisible();
  // Once: not again on the next visit.
  await page.goto(omicron.url);
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("status").filter({ hasText: "added you to" })).toHaveCount(0);
});
