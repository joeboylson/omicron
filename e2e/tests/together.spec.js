// @ts-check
// Two people on one board at once, and a Claude session changing it too:
// both boards end up the same, live, with nothing lost and nothing twice.
const { test, expect } = require("@playwright/test");
const { startOmicron, unique, sessionFor, rest, visitAs } = require("./omicron");

let omicron;
let machine;
test.beforeAll(async () => {
  omicron = await startOmicron();
  machine = unique("mac");
  omicron.cli("machines", "register", machine, "--all-projects");
});
test.afterAll(() => omicron?.stop());

/** The board as a person sees it: each column's task titles, in order. */
async function board(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("section[aria-label]")].map((s) => ({
      column: s.getAttribute("aria-label"),
      tasks: [...s.querySelectorAll('[role="button"][aria-label^="#"], button[aria-label^="#"]')].map((b) => b.getAttribute("aria-label")),
    })),
  );
}

async function settled(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
}

test("two people at once end up seeing the same board, with nothing lost or doubled", async ({ browser, request }) => {
  // Ada starts the Project and adds Ben.
  const adaLogin = `${unique("ada")}@example.com`;
  const benLogin = `${unique("ben")}@example.com`;
  const ada = await sessionFor(request, omicron, adaLogin, "Ada Example");
  const ben = await sessionFor(request, omicron, benLogin, "Ben Example");
  const name = unique("House");
  const project = await rest(request, ada, "POST", "/rest/v1/rpc/start_project", { name });
  await rest(request, ada, "POST", "/rest/v1/project_members", { project_id: project.id, person_id: ben.person_id });
  const [todo, done] = await rest(request, ada, "GET", `/rest/v1/statuses?project_id=eq.${project.id}&select=id,name&order=position`);

  const open = async (login, who) => {
    const page = await (await browser.newContext()).newPage();
    await visitAs(page, omicron, login, who);
    await page.goto(`${omicron.url}/p/${project.id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    return page;
  };
  const a = await open(adaLogin, "Ada Example");
  const b = await open(benLogin, "Ben Example");
  const column = (page, status) => page.getByRole("region", { name: status, exact: true });

  // Both add tasks at the same moment, several each.
  const addMany = async (page, titles) => {
    for (const t of titles) {
      await column(page, todo.name).getByRole("button", { name: "Add Task" }).click();
      await page.getByRole("dialog").getByLabel("Title").fill(t);
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await expect(column(page, todo.name).getByRole("button", { name: new RegExp(`^#\\d+ ${t}$`) })).toHaveCount(1);
    }
  };
  await Promise.all([addMany(a, ["Ada one", "Ada two", "Ada three"]), addMany(b, ["Ben one", "Ben two", "Ben three"])]);
  // Every task once, with its own number, on both boards.
  const rows = await rest(request, ada, "GET", `/rest/v1/tasks?project_id=eq.${project.id}&select=number,title`);
  expect(rows.length).toBe(6);
  expect(new Set(rows.map((r) => r.number)).size).toBe(6);
  for (const page of [a, b]) {
    for (const t of ["Ada one", "Ada two", "Ada three", "Ben one", "Ben two", "Ben three"]) {
      await expect(column(page, todo.name).getByRole("button", { name: new RegExp(`^#\\d+ ${t}$`) })).toHaveCount(1);
    }
  }

  // Both open the same task; each renames it; both end up with the same
  // name (whoever saved last), and nobody's sheet shows a stale one.
  const number = rows.find((r) => r.title === "Ada one").number;
  for (const page of [a, b]) {
    await page.getByRole("button", { name: new RegExp(`^#${number} `) }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settled(page);
  }
  await a.getByRole("dialog").getByLabel("Title").fill("Renamed by Ada");
  await a.getByRole("dialog").getByLabel("Title").press("Enter");
  await b.getByRole("dialog").getByLabel("Title").fill("Renamed by Ben");
  await b.getByRole("dialog").getByLabel("Title").press("Enter");
  // Whichever save reached the database last wins; both sheets show it.
  await a.waitForTimeout(1500);
  const kept = (await rest(request, ada, "GET", `/rest/v1/tasks?project_id=eq.${project.id}&number=eq.${number}&select=title`))[0].title;
  expect(["Renamed by Ada", "Renamed by Ben"]).toContain(kept);
  for (const page of [a, b]) {
    await expect(page.getByRole("dialog").getByLabel("Title")).toHaveValue(kept, { timeout: 10_000 });
  }

  // Ben comments while Ada moves it to Done: both happen.
  await Promise.all([
    (async () => {
      await b.getByRole("dialog").getByLabel("New comment").fill("Halfway there.");
      await b.getByRole("dialog").getByRole("button", { name: "Send" }).click();
      await expect(b.getByRole("dialog")).toContainText("Halfway there.");
    })(),
    rest(request, ada, "PATCH", `/rest/v1/tasks?project_id=eq.${project.id}&number=eq.${number}`, { status_id: done.id }),
  ]);
  await expect(a.getByRole("dialog")).toContainText("Halfway there.", { timeout: 10_000 });
  for (const page of [a, b]) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(column(page, done.name).getByRole("button", { name: new RegExp(`^#${number} ${kept}`) })).toHaveCount(1);
  }

  // Ada deletes a task Ben has open: Ben's sheet says it's gone.
  const benTwo = rows.find((r) => r.title === "Ben two").number;
  await b.getByRole("button", { name: new RegExp(`^#${benTwo} `) }).click();
  await expect(b.getByRole("dialog")).toBeVisible();
  await a.getByRole("button", { name: new RegExp(`^#${benTwo} `) }).click();
  await a.getByRole("button", { name: "More for this task" }).click();
  await a.getByRole("menuitem", { name: "Delete task" }).click();
  await expect(b.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  await expect(b.getByRole("button", { name: new RegExp(`^#${benTwo} `) })).toHaveCount(0);

  // A Claude session changes things from the command line meanwhile.
  omicron.cli("tasks", "add", name, "From a session", "--as-machine");
  omicron.cli("tasks", "move", name, String(rows.find((r) => r.title === "Ada two").number), done.name, "--as-machine");
  for (const page of [a, b]) {
    await expect(column(page, todo.name).getByRole("button", { name: /From a session/ })).toHaveCount(1, { timeout: 10_000 });
    await expect(column(page, done.name).getByRole("button", { name: /Ada two/ })).toHaveCount(1);
  }

  // Both boards are the same, and match the database.
  await expect.poll(async () => JSON.stringify(await board(a)), { timeout: 10_000 }).toBe(JSON.stringify(await board(b)));
  const final = await rest(request, ada, "GET", `/rest/v1/tasks?project_id=eq.${project.id}&select=title`);
  expect(final.length).toBe(6); // six added, one deleted, one from the session
  await a.context().close();
  await b.context().close();
});
