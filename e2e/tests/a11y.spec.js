// @ts-check
// Accessibility: axe (the standard checker) on every page and dialog, in
// light and dark. Serious and critical problems fail the test.
const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const { startOmicron, unique, sessionFor, visitAs } = require("./omicron");

// axe is slow: give it time, and run the two themes one after the other.
test.describe.configure({ mode: "serial", timeout: 240_000 });

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
  omicron.cli("machines", "register", unique("mac"), "--all-projects");
});
test.afterAll(() => omicron?.stop());

async function check(page, where) {
  // Not mid fade-in: contrast is measured on what's finally shown.
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${where}: ${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n  ")}`);
  expect(bad, bad.join("\n")).toEqual([]);
}

for (const scheme of ["light", "dark"]) {
  test(`no serious accessibility problems (${scheme})`, async ({ page, request, context }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const login = `${unique("a11y")}@example.com`;
    await sessionFor(request, omicron, login, "Ada Example");
    await visitAs(page, omicron, login, "Ada Example");
    await page.goto(omicron.url);
    await expect(page.getByTestId("me")).toBeVisible();
    await check(page, "Projects (empty)");

    await page.getByRole("button", { name: "New Project" }).first().click();
    await check(page, "New Project");
    const name = unique("House");
    await page.getByLabel("New Project name").fill(name);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await page.getByRole("region", { name: "To do", exact: true }).getByRole("button", { name: "Add a task" }).click();
    await page.getByLabel("New task in To do").fill("Fix the gate");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Cancel" }).click();
    omicron.cli("tasks", "label", name, "1", "outside", "--as-machine");
    await expect(page.getByRole("button", { name: /#1 Fix the gate/ })).toContainText("outside");
    await check(page, "Project board");

    await page.getByRole("button", { name: /#1 Fix the gate/ }).click();
    await check(page, "Task");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Project settings" }).click();
    await check(page, "Project settings");
    await page.keyboard.press("Escape");
    await page.getByRole("radio", { name: "Status and topic" }).click();
    await check(page, "Board by topic");

    await page.keyboard.press("Control+k");
    await check(page, "Command menu");
    await page.keyboard.press("Escape");

    // A fresh tab for each of the rest, so memory doesn't build up (axe is heavy).
    await page.close();
    for (const [path, heading] of [
      ["/people", "People"],
      ["/settings", "Settings"],
      ["/machines", "Machines"],
    ]) {
      const tab = await context.newPage();
      await tab.emulateMedia({ colorScheme: scheme });
      await visitAs(tab, omicron, login, "Ada Example");
      await tab.goto(omicron.url + path);
      await expect(tab.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await check(tab, heading);
      await tab.close();
    }
  });
}
