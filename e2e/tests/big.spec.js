// @ts-check
// A big Project: 1,200 tasks (more than the database hands back in one go),
// 50 labels, 30 statuses, a long comment thread. Nothing is cut off, and the
// board, search, the command menu and the CLI stay quick. The time limits
// fail the test if things get slow.
const { test, expect } = require("@playwright/test");
const { startOmicron, unique, sessionFor, rest, visitAs } = require("./omicron");

test.describe.configure({ timeout: 180_000 });

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
});
test.afterAll(() => omicron?.stop());

test("a Project with 1,200 tasks: nothing cut off, and it stays quick", async ({ page, request }) => {
  // This machine's own person, so the command line sees the Project too.
  const login = omicron.me.login;
  const me = await sessionFor(request, omicron, login, omicron.me.name);
  const name = unique("Big");
  const project = await rest(request, me, "POST", "/rest/v1/rpc/start_project", { name });
  // 30 statuses (2 already), 50 labels.
  const extra = Array.from({ length: 28 }, (_, i) => ({ project_id: project.id, name: `Stage ${String(i + 1).padStart(2, "0")}`, position: i + 2 }));
  await rest(request, me, "POST", "/rest/v1/statuses", extra);
  const statuses = await rest(request, me, "GET", `/rest/v1/statuses?project_id=eq.${project.id}&select=id,name&order=position`);
  expect(statuses.length).toBe(30);
  const labels = await rest(request, me, "POST", "/rest/v1/labels", Array.from({ length: 50 }, (_, i) => ({ project_id: project.id, name: `label-${i + 1}`, color: "blue" })));
  // 1,200 tasks, in batches, spread over the statuses.
  for (let b = 0; b < 6; b++) {
    const batch = Array.from({ length: 200 }, (_, i) => {
      const n = b * 200 + i + 1;
      return { project_id: project.id, status_id: statuses[n % 30].id, title: `Task number ${n}${n === 1199 ? " the needle" : ""}` };
    });
    await rest(request, me, "POST", "/rest/v1/tasks", batch);
  }
  const all = await rest(request, me, "GET", `/rest/v1/tasks?project_id=eq.${project.id}&select=id,number&order=number&number=eq.1`);
  await rest(request, me, "POST", "/rest/v1/task_labels", labels.slice(0, 20).map((l) => ({ task_id: all[0].id, label_id: l.id })));
  await rest(request, me, "POST", "/rest/v1/comments", Array.from({ length: 150 }, (_, i) => ({ task_id: all[0].id, body: `Comment ${i + 1}` })));

  // The CLI: every task listed, quickly.
  let started = Date.now();
  const listed = omicron.cli("tasks", "list", name);
  const cliTime = Date.now() - started;
  const taskLines = listed.split("\n").filter((l) => /^\s+#\d+/.test(l)).length;
  expect(taskLines, "the CLI lists every task").toBe(1200);
  expect(cliTime, "the CLI lists 1,200 tasks within 4 seconds").toBeLessThan(4000);

  // The board: open, with every task (the count on each column adds up).
  await visitAs(page, omicron, login, omicron.me.name);
  started = Date.now();
  await page.goto(`${omicron.url}/p/${project.id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("button", { name: /^#1200 / })).toBeAttached({ timeout: 15_000 });
  const boardTime = Date.now() - started;
  expect(boardTime, "the board shows 1,200 tasks within 5 seconds").toBeLessThan(5000);
  const cards = await page.locator('section[aria-label] [aria-label^="#"]').count();
  expect(cards, "every task is on the board").toBe(1200);

  // Search: finds the one task quickly.
  started = Date.now();
  await page.getByLabel("Search tasks").fill("needle");
  await expect(page.getByRole("button", { name: /the needle/ })).toBeVisible();
  await expect(page.locator('section[aria-label] [aria-label^="#"]')).toHaveCount(1);
  expect(Date.now() - started, "search narrows 1,200 tasks within a second").toBeLessThan(1000);
  await page.getByLabel("Search tasks").fill("");

  // The command menu opens and finds a task quickly.
  started = Date.now();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Command" }).fill("#1199");
  await expect(page.getByRole("option", { name: /the needle/ })).toBeVisible();
  expect(Date.now() - started, "the command menu finds a task within a second").toBeLessThan(1000);
  await page.keyboard.press("Escape");

  // The task with 150 comments and 20 labels opens quickly, all there.
  started = Date.now();
  await page.goto(`${omicron.url}/p/${project.id}?task=1`);
  await expect(page.getByRole("dialog")).toContainText("Comment 150", { timeout: 15_000 });
  expect(Date.now() - started, "a task with 150 comments opens within 5 seconds").toBeLessThan(5000);
  await expect(page.getByRole("list", { name: "Comments" }).getByRole("listitem")).toHaveCount(150);
});
