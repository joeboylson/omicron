// @ts-check
// Screenshots of the web page with made-up data, for looking at by eye.
// Only runs when asked: OMICRON_SCREENSHOTS=1 bash dev/e2e.sh screenshots
// Saved to ~/omicron-e2e-results/screenshots on the test machine.
const { test, expect, devices } = require("@playwright/test");
const path = require("node:path");
const crypto = require("node:crypto");
const { startOmicron, unique, sessionFor, rest, visitAs } = require("./omicron");

test.skip(!process.env.OMICRON_SCREENSHOTS, "set OMICRON_SCREENSHOTS=1 to take screenshots");

const out = path.join(process.env.HOME ?? ".", "omicron-e2e-results", "screenshots");
let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
});
test.afterAll(() => omicron?.stop());

test("screenshots", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const login = `${unique("joe")}@example.com`;
  const me = await sessionFor(request, omicron, login, "Joe Boylson");
  const sam = await sessionFor(request, omicron, `${unique("sam")}@example.com`, "Sam Boylson");
  const call = (method, p, data) => rest(request, me, method, p, data);

  const project = (await call("POST", "/rest/v1/rpc/start_project", { name: "House and garden" }));
  await call("POST", "/rest/v1/rpc/start_project", { name: "Groceries" });
  const omicronProject = await call("POST", "/rest/v1/rpc/start_project", { name: "Omicron" });
  await call("POST", "/rest/v1/project_members", { project_id: project.id, person_id: sam.person_id });
  const statuses = await call("GET", `/rest/v1/statuses?project_id=eq.${project.id}&select=id,name`);
  const todo = statuses.find((s) => s.name === "To do").id;
  const done = statuses.find((s) => s.name === "Done").id;
  const [doing] = await call("POST", "/rest/v1/statuses", { project_id: project.id, name: "Doing", position: 0.5 });
  const [waiting] = await call("POST", "/rest/v1/statuses", { project_id: project.id, name: "Waiting on someone", position: 0.75 });
  const labels = Object.fromEntries(
    await Promise.all(
      ["outside", "car", "shopping", "kids"].map(async (name) => [
        name,
        (await call("POST", "/rest/v1/labels", { project_id: project.id, name }))[0].id,
      ]),
    ),
  );
  const add = async (status, title, extra = {}, labelNames = [], checklist = []) => {
    const [t] = await call("POST", "/rest/v1/tasks", { project_id: project.id, status_id: status, title, ...extra });
    for (const l of labelNames) await call("POST", "/rest/v1/task_labels", { task_id: t.id, label_id: labels[l] });
    for (const [i, [text, isDone]] of checklist.entries()) {
      await call("POST", "/rest/v1/checklist_items", { task_id: t.id, text, done: isDone, position: i });
    }
    return t;
  };
  const [doingId, waitingId] = [doing.id, waiting.id];
  await add(todo, "Clean out the gutters", { due_on: "2026-11-22" }, ["outside"]);
  await add(todo, "Book the winter tyre swap", { assignee_person_id: sam.person_id }, ["car"]);
  await add(todo, "Birthday present for Mia", { due_on: "2026-12-04", notes: "She wants the big Lego set." }, ["shopping", "kids"]);
  const gate = await add(
    doingId,
    "Fix the back gate",
    { due_on: "2026-11-15", assignee_person_id: me.person_id, notes: "The latch is loose and the bottom hinge is bent. Hardware store has both." },
    ["outside"],
    [["Buy a new latch", true], ["Buy a hinge", true], ["Fit them", false]],
  );
  await add(doingId, "Sort the garage shelves", {}, [], [["Paint cans", true], ["Tools", false], ["Bikes", false], ["Camping gear", false]]);
  await add(waitingId, "Quote for the new fence", { notes: "Asked two companies on Monday." }, ["outside"]);
  await add(done, "Renew the car insurance", {}, ["car"]);
  await add(done, "Pick up the dry cleaning");

  // A Claude session marks one task for review.
  const [code] = await call("GET", `/rest/v1/statuses?project_id=eq.${omicronProject.id}&name=eq.To%20do&select=id`);
  await call("POST", "/rest/v1/tasks", { project_id: omicronProject.id, status_id: code.id, title: "Wire up the web page" });
  const machine = unique("mac-mini");
  omicron.cli("machines", "register", machine, "--all-projects");
  omicron.cli("tasks", "unread", omicronProject.id, "1", "--as-machine");
  // Three Claude sessions on the Omicron Project: two open, one closed.
  await call("POST", "/rest/v1/tasks", { project_id: omicronProject.id, status_id: code.id, title: "Sessions on the web page" });
  const windows = [];
  for (const [name, folder] of [["web-page", "~/omicron/web"], ["parser", "~/omicron"], ["handoff", "~/omicron"]]) {
    const claude = crypto.randomUUID();
    const win = await omicron.open(name, omicronProject.id, claude);
    windows.push(win);
    omicron.hook(win.pid, "session-start", { session_id: claude, cwd: folder, source: "startup" });
  }
  omicron.hook(windows[2].pid, "session-end", { session_id: crypto.randomUUID(), reason: "prompt_input_exit" });
  // Task #2 sent to web-page, which picked it up; a third waits for parser.
  const [{ id: webPage }] = await call("GET", `/rest/v1/sessions?project_id=eq.${omicronProject.id}&name=eq.web-page&select=id`);
  const [{ id: parser }] = await call("GET", `/rest/v1/sessions?project_id=eq.${omicronProject.id}&name=eq.parser&select=id`);
  await call("PATCH", `/rest/v1/tasks?project_id=eq.${omicronProject.id}&number=eq.2`, { assignee_session_id: webPage });
  omicron.hook(windows[0].pid, "stop", { session_id: crypto.randomUUID(), stop_hook_active: false });
  omicron.cliIn(windows[0].pid, "handoff", "write", "Started the sessions strip. Chips are done; tapping one should open its notes. Next: the sheet itself.");
  omicron.cliIn(windows[0].pid, "handoff", "write", "Sessions strip and notes sheet are done and tested.\n\nNext: screenshots on the phone, then ask Joe about fading closed sessions.\nCheck first: git status, and that dev/e2e.sh passes.");
  omicron.cliIn(windows[0].pid, "tasks", "comment", omicronProject.id, "2", "Added the sessions strip above the columns, with open ones first. Screenshots in the PR.", "--review", "--as-machine");
  await call("POST", "/rest/v1/comments", { task_id: (await call("GET", `/rest/v1/tasks?project_id=eq.${omicronProject.id}&number=eq.2&select=id`))[0].id, body: "Nice. Can the closed ones fade a bit more?" });
  await call("POST", "/rest/v1/tasks", { project_id: omicronProject.id, status_id: code.id, title: "Parse the change list", assignee_session_id: parser });
  // The house task gets it too, so it shows on the main screenshot.
  omicron.cli("tasks", "unread", project.id, String(gate.number), "--as-machine");

  const shoot = async (page, name) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  };

  for (const [kind, options] of [
    ["desktop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }],
    ["phone", { ...devices["iPhone 13"] }],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const context = await browser.newContext({ ...options, colorScheme: scheme });
      const page = await context.newPage();
      await visitAs(page, omicron, login, "Joe Boylson");
      await page.goto(omicron.url);
      await expect(page.getByRole("link", { name: /Groceries/ })).toBeVisible();
      await shoot(page, `${kind}-${scheme}-1-projects`);
      await page.getByRole("link", { name: /and garden/ }).click();
      await expect(page.getByRole("button", { name: /Fix the back gate/ })).toBeVisible();
      await shoot(page, `${kind}-${scheme}-2-project`);
      await page.getByRole("button", { name: /Fix the back gate/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await shoot(page, `${kind}-${scheme}-3-task`);
      await page.keyboard.press("Escape");
      await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("region", { name: "Project settings" })).toBeVisible();
      await shoot(page, `${kind}-${scheme}-4-settings`);
      await page.getByRole("heading", { level: 1 }).getByRole("button").click();
      await page.getByRole("menuitem", { name: "Home" }).click();
      await page.getByRole("link", { name: /^Omicron\s*\d+ tasks?$/ }).click();
      await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: "Dev", exact: true }).click();
      await expect(page.getByRole("region", { name: "Claude sessions" })).toContainText("handoff");
      await shoot(page, `${kind}-${scheme}-5-sessions`);
      await page.getByRole("button", { name: /^#2 Sessions on the web page/ }).click();
      await expect(page.getByRole("list", { name: "Comments" })).toBeVisible();
      await page.getByRole("list", { name: "Comments" }).scrollIntoViewIfNeeded();
      await shoot(page, `${kind}-${scheme}-6-comments`);
      await page.keyboard.press("Escape");
      await page.getByRole("region", { name: "Claude sessions" }).getByRole("button", { name: /web-page/ }).click();
      await expect(page.getByRole("list", { name: "Handoff notes" })).toContainText("Not picked up yet");
      await shoot(page, `${kind}-${scheme}-7-handoffs`);
      await page.keyboard.press("Escape");
      await context.close();
    }
  }
  for (const w of windows) w.kill();
});
