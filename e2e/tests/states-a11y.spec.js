// @ts-check
// Accessibility (axe) in the states the main check doesn't reach: an error
// showing, a task with everything filled in, the "Deleted · Undo" message,
// a newly made API key, and search finding nothing.
// Light and dark. Serious and critical problems fail the test.
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { startOmicron, unique, sessionFor, rest, visitAs } = require("./omicron");

test.describe.configure({ mode: "serial", timeout: 240_000 });

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
  omicron.cli("machines", "register", unique("mac"), "--all-projects");
});
test.afterAll(() => omicron?.stop());

async function check(page, where) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${where}: ${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n  ")}`);
  expect(bad, bad.join("\n")).toEqual([]);
}

for (const scheme of ["light", "dark"]) {
  test(`more states have no serious accessibility problems (${scheme})`, async ({ page, request, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const login = `${unique("st")}@example.com`;
    const me = await sessionFor(request, omicron, login, "Ada Example");
    const name = unique("House");
    const project = await rest(request, me, "POST", "/rest/v1/rpc/start_project", { name });
    const [todo] = await rest(request, me, "GET", `/rest/v1/statuses?project_id=eq.${project.id}&select=id,name&order=position&limit=1`);
    const [label] = await rest(request, me, "POST", "/rest/v1/labels", { project_id: project.id, name: "outside", color: "green" });
    const [task] = await rest(request, me, "POST", "/rest/v1/tasks", {
      project_id: project.id,
      status_id: todo.id,
      title: "Fix the back gate",
      notes: "The latch sticks.\nNeeds oil.",
      due_on: "2026-12-01",
      assignee_person_id: me.person_id,
    });
    await rest(request, me, "POST", "/rest/v1/task_labels", { task_id: task.id, label_id: label.id });
    await rest(request, me, "POST", "/rest/v1/checklist_items", { task_id: task.id, text: "Buy oil", done: true });
    await rest(request, me, "POST", "/rest/v1/checklist_items", { task_id: task.id, text: "Oil the latch" });
    await rest(request, me, "POST", "/rest/v1/comments", { task_id: task.id, body: "Bought the oil." });
    await rest(request, me, "POST", "/rest/v1/tasks", { project_id: project.id, status_id: todo.id, title: "Paint the fence" });
    await visitAs(page, omicron, login, "Ada Example");
    await page.goto(`${omicron.url}/p/${project.id}`);
    await expect(page.getByRole("button", { name: /Fix the back gate/ })).toBeVisible();

    // A task with everything filled in.
    await page.getByRole("button", { name: /Fix the back gate/ }).click();
    await expect(page.getByRole("dialog")).toContainText("Bought the oil.");
    await check(page, "Task, filled in");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Search finding nothing.
    await page.getByLabel("Search tasks").fill("nothing like this");
    await check(page, "Search finds nothing");
    await page.getByLabel("Search tasks").fill("");

    // "Deleted · Undo".
    await page.getByRole("button", { name: /Paint the fence/ }).click();
    await page.getByRole("button", { name: "More for this task" }).click();
    await page.getByRole("menuitem", { name: "Delete task" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Deleted" })).toBeVisible();
    await check(page, "Deleted, with Undo");

    // An error showing.
    await context.setOffline(true);
    await page.getByRole("region", { name: todo.name, exact: true }).getByRole("button", { name: "Add Task" }).click();
    await page.getByRole("dialog").getByLabel("Title").fill("Won't save");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toBeVisible();
    await check(page, "An error showing");
    await context.setOffline(false);
    await page.close();

    // A newly made API key.
    const tab = await context.newPage();
    await tab.emulateMedia({ colorScheme: scheme });
    await visitAs(tab, omicron, login, "Ada Example");
    await tab.goto(`${omicron.url}/machines`);
    await tab.getByRole("button", { name: "New key" }).first().click();
    await tab.getByLabel("Machine name").fill(unique("box"));
    await tab.getByRole("button", { name: "Make key" }).click();
    await expect(tab.getByTestId("new-key")).toContainText("omk_");
    await check(tab, "A new API key");
    await tab.close();
  });
}
