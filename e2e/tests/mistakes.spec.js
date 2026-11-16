// @ts-check
// Mistakes on the web page say what's wrong in plain words, and nothing
// half-done is left behind.
const { test, expect } = require("@playwright/test");
const { startOmicron, unique, sessionFor, visitAs } = require("./omicron");

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
});
test.afterAll(() => omicron?.stop());

test("a second Project with the same name is refused, plainly", async ({ page, request }) => {
  const login = `${unique("p")}@example.com`;
  await sessionFor(request, omicron, login, "Robin Example");
  await visitAs(page, omicron, login, "Robin Example");
  await page.goto(omicron.url);
  const name = unique("Kitchen");
  for (const attempt of [name, name.toUpperCase()]) {
    await page.getByRole("button", { name: "New Project" }).first().click();
    await page.getByLabel("New Project name").fill(attempt);
    await page.keyboard.press("Enter");
    if (attempt === name) {
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await page.getByRole("heading", { level: 1 }).getByRole("button").click();
      await page.getByRole("menuitem", { name: "Home" }).click();
    }
  }
  await expect(page.getByText(`You already have a Project called ${name.toUpperCase()}`)).toBeVisible();
  await expect(page.getByText(/violates|constraint|23514/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: new RegExp(name, "i") })).toHaveCount(1);
});
