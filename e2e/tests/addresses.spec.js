// @ts-check
// Every page by its own address, Back and Forward, reloading anywhere, and
// addresses that don't lead anywhere: a Project you were taken out of, a
// deleted task, a page that doesn't exist.
const { test, expect } = require("@playwright/test");
const { startOmicron, unique, sessionFor, rest, visitAs } = require("./omicron");

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
});
test.afterAll(() => omicron?.stop());

test("addresses, Back and Forward, reloading, and addresses that lead nowhere", async ({ page, request, context }) => {
  const login = `${unique("ad")}@example.com`;
  const me = await sessionFor(request, omicron, login, "Robin Example");
  const name = unique("Garden");
  const project = await rest(request, me, "POST", "/rest/v1/rpc/start_project", { name });
  const [todo] = await rest(request, me, "GET", `/rest/v1/statuses?project_id=eq.${project.id}&select=id,name&order=position&limit=1`);
  for (const title of ["Plant tulips", "Fix the gate", "Prune roses"]) {
    await rest(request, me, "POST", "/rest/v1/tasks", { project_id: project.id, status_id: todo.id, title });
  }
  await visitAs(page, omicron, login, "Robin Example");
  const board = `${omicron.url}/p/${project.id}`;

  // Each page by its own address.
  for (const [path, heading] of [
    ["/", "Projects"],
    [`/p/${project.id}`, name],
    ["/people", "People"],
    ["/settings", "Settings"],
    ["/machines", "Machines"],
  ]) {
    await page.goto(omicron.url + path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }

  // Back and Forward through Projects, the board and People.
  await page.goto(omicron.url);
  await page.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.goto(`${omicron.url}/people`);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // An open task is in the address: reloading keeps it open, Back closes it.
  await page.getByRole("button", { name: /^#2 Fix the gate/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Fix the gate");
  expect(new URL(page.url()).searchParams.get("task")).toBe("2");
  await page.reload();
  await expect(page.getByRole("dialog")).toContainText("Fix the gate");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("task")).toBeNull();
  await page.getByRole("button", { name: /^#3 Prune roses/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Prune roses");
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // A link straight to a task opens it, in a second tab too.
  const second = await context.newPage();
  await visitAs(second, omicron, login, "Robin Example");
  await second.goto(`${board}?task=1`);
  await expect(second.getByRole("dialog")).toContainText("Plant tulips");
  await second.close();

  // The search is kept on reload.
  await page.getByLabel("Search tasks").fill("roses");
  await expect(page.getByRole("button", { name: /Plant tulips/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Search tasks")).toHaveValue("roses");
  await expect(page.getByRole("button", { name: /Plant tulips/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Prune roses/ })).toBeVisible();
  await page.getByLabel("Search tasks").fill("");

  // A link to a task that was deleted (or never was) says so.
  await page.goto(`${board}?task=99`);
  await expect(page.getByRole("status").filter({ hasText: "There's no task #99 in this Project" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("task")).toBeNull();

  // A Project you're not in (or that doesn't exist).
  await page.goto(`${omicron.url}/p/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByRole("heading", { level: 1, name: "Can't open this Project" })).toBeVisible();
  await page.getByRole("button", { name: "Back to Projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

  // An address that isn't a page.
  for (const path of ["/nope", "/p/not-an-id", "/people/extra"]) {
    await page.goto(omicron.url + path);
    await expect(page.getByRole("heading", { level: 1, name: "Nothing here" })).toBeVisible();
  }
  await page.getByRole("button", { name: "Go to Projects" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Projects" })).toBeVisible();

  // Taken out of the Project while looking at it: the board says so.
  const other = await sessionFor(request, omicron, `${unique("own")}@example.com`, "Owner Example");
  const theirs = await rest(request, other, "POST", "/rest/v1/rpc/start_project", { name: unique("Theirs") });
  await rest(request, other, "POST", "/rest/v1/project_members", { project_id: theirs.id, person_id: me.person_id });
  await page.goto(`${omicron.url}/p/${theirs.id}`);
  await expect(page.getByRole("heading", { level: 1, name: theirs.name })).toBeVisible();
  await rest(request, other, "DELETE", `/rest/v1/project_members?project_id=eq.${theirs.id}&person_id=eq.${me.person_id}`);
  await expect(page.getByRole("heading", { level: 1, name: "Can't open this Project" })).toBeVisible({ timeout: 15_000 });
});
