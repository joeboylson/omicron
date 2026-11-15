// @ts-check
// Losing the connection and coming back: a change that fails says so in
// plain words and can be made again, nothing is lost or shown twice, and
// what changed elsewhere meanwhile shows up once the page is back.
const { test, expect } = require("@playwright/test");
const { startOmicron, unique, sessionFor, rest, visitAs } = require("./omicron");

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
});
test.afterAll(() => omicron?.stop());

test("offline and back: failures say so, nothing is lost or doubled, and the board catches up", async ({ page, context, request }) => {
  const login = `${unique("off")}@example.com`;
  const me = await sessionFor(request, omicron, login, "Robin Example");
  const name = unique("Garden");
  const project = await rest(request, me, "POST", "/rest/v1/rpc/start_project", { name });
  const [todo] = await rest(request, me, "GET", `/rest/v1/statuses?project_id=eq.${project.id}&select=id,name&order=position&limit=1`);
  await rest(request, me, "POST", "/rest/v1/tasks", { project_id: project.id, status_id: todo.id, title: "Already here" });
  await visitAs(page, omicron, login, "Robin Example");
  await page.goto(`${omicron.url}/p/${project.id}`);
  const column = page.getByRole("region", { name: todo.name, exact: true });
  await expect(column).toContainText("Already here");

  // Offline: adding a task can't get through. The page says so plainly,
  // and the add can't be sent twice while it waits.
  await context.setOffline(true);
  await column.getByRole("button", { name: "Add Task" }).click();
  await page.getByLabel(`New task in ${todo.name}`).fill("Water the beans");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Couldn't reach Omicron. Check your connection, then try again.");
  await expect(alert).not.toContainText(/TypeError|Failed to fetch|NetworkError/);
  await page.getByRole("button", { name: "Add task", exact: true }).click({ force: true }).catch(() => {});
  await page.keyboard.press("Enter");

  // Meanwhile, someone else adds a task.
  await rest(request, me, "POST", "/rest/v1/tasks", { project_id: project.id, status_id: todo.id, title: "Added elsewhere" });

  // Back online: the task is added (sent again by hand if it had failed),
  // once; what happened elsewhere shows up too.
  // While offline the page says it may be out of date (#226), and stops
  // saying so once it's back.
  await expect(page.getByTestId("live-down")).toHaveText("Not up to date. Reconnecting…", { timeout: 10_000 });
  await context.setOffline(false);
  await expect(column.getByRole("button", { name: /Added elsewhere/ })).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByTestId("live-down")).toHaveCount(0, { timeout: 15_000 });
  const box = page.getByLabel(`New task in ${todo.name}`);
  if ((await box.inputValue()) === "Water the beans") {
    await page.getByRole("button", { name: "Add task", exact: true }).click();
  }
  await expect(column.getByRole("button", { name: /Water the beans/ })).toHaveCount(1);
  await expect(box).toHaveValue("");
  await page.waitForTimeout(1500);
  const titles = await rest(request, me, "GET", `/rest/v1/tasks?project_id=eq.${project.id}&select=title&order=number`);
  expect(titles.map((t) => t.title).sort()).toEqual(["Added elsewhere", "Already here", "Water the beans"]);
  // Working again: the error goes once the connection is back (#197).
  await page.getByLabel(`New task in ${todo.name}`).fill("One more");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(column.getByRole("button", { name: /One more/ })).toHaveCount(1);
  await expect(alert).toHaveCount(0);

  // A change made elsewhere while the page was away is caught up on
  // without reloading, even with nothing done on the page.
  await context.setOffline(true);
  await page.waitForTimeout(1500);
  await rest(request, me, "POST", "/rest/v1/tasks", { project_id: project.id, status_id: todo.id, title: "While you were away" });
  await context.setOffline(false);
  await expect(column.getByRole("button", { name: /While you were away/ })).toHaveCount(1, { timeout: 20_000 });

  // Reloading while offline: a clear message, not a blank page (the page
  // keeps a copy of itself for this).
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload().catch(() => {});
  await expect(page.getByRole("alert")).toContainText("Couldn't reach Omicron. Check your connection, then try again.", { timeout: 10_000 });
  await context.setOffline(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(column).toContainText("While you were away");
});

test("an hour later, the sign-in has renewed itself and the page still works", async ({ page, request }) => {
  const login = `${unique("hour")}@example.com`;
  const me = await sessionFor(request, omicron, login, "Robin Example");
  const project = await rest(request, me, "POST", "/rest/v1/rpc/start_project", { name: unique("Garden") });
  const [todo] = await rest(request, me, "GET", `/rest/v1/statuses?project_id=eq.${project.id}&select=id,name&order=position&limit=1`);
  await page.clock.install();
  await visitAs(page, omicron, login, "Robin Example");
  await page.goto(`${omicron.url}/p/${project.id}`);
  const column = page.getByRole("region", { name: todo.name, exact: true });
  await expect(column).toBeVisible();
  const renewed = page.waitForRequest((r) => r.url().includes("/auth/v1/token") && r.url().includes("refresh_token"), { timeout: 20_000 });
  // An hour and five minutes go by.
  await page.clock.fastForward("01:05:00");
  await renewed;
  await column.getByRole("button", { name: "Add Task" }).click();
  await page.getByLabel(`New task in ${todo.name}`).fill("Still works");
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await expect(column.getByRole("button", { name: /Still works/ })).toHaveCount(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});
