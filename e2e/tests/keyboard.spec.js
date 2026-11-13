// @ts-check
// The page with the keyboard alone: every control can be reached with Tab,
// shows where focus is, and is on screen when focused; dialogs keep focus
// inside while open and give it back when closed; a whole flow (start a
// Project, add a task, open it, close it) works without the mouse.
const { test, expect } = require("@playwright/test");
const { startOmicron, unique, sessionFor, rest, visitAs } = require("./omicron");

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
});
test.afterAll(() => omicron?.stop());

/** What has focus: a description, whether it's visible and on screen, and
 *  whether it shows a focus ring (an outline or a ring shadow). */
async function focused(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== "none");
    return {
      what: `${el.tagName.toLowerCase()} "${el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 30)}"`,
      onScreen: r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth,
      ring,
      inDialog: !!el.closest('[role="dialog"]'),
    };
  });
}

/** Tab through the whole page once: everything focused is on screen and
 *  shows a ring. Returns what was focused, in order. */
async function tabThrough(page, where, most = 60) {
  const seen = [];
  const problems = [];
  for (let i = 0; i < most; i++) {
    await page.keyboard.press("Tab");
    const f = await focused(page);
    if (!f) break;
    if (seen.includes(f.what) && seen[0] === f.what) break; // back to the start
    seen.push(f.what);
    if (!f.onScreen) problems.push(`${f.what} is off screen when focused`);
    if (!f.ring) problems.push(`${f.what} shows no focus ring`);
  }
  expect(problems, where).toEqual([]);
  return seen;
}

test("everything can be reached and seen with the keyboard, and a whole flow needs no mouse", async ({ page, request }) => {
  const login = `${unique("kb")}@example.com`;
  await sessionFor(request, omicron, login, "Robin Example");
  await visitAs(page, omicron, login, "Robin Example");
  await page.goto(omicron.url);
  await expect(page.getByTestId("me")).toBeVisible();

  // Projects (empty): New Project is reachable.
  const projects = await tabThrough(page, "Projects");
  expect(projects.some((w) => w.includes("New Project"))).toBe(true);

  // Start a Project by keyboard.
  await page.getByRole("button", { name: "New Project" }).first().focus();
  await page.keyboard.press("Enter");
  const name = unique("Garden");
  await expect(page.getByLabel("New Project name")).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  // The board: Add a task is reachable; add one by keyboard.
  const boardStops = await tabThrough(page, "Board");
  expect(boardStops.some((w) => w.includes("Add a task"))).toBe(true);
  await page.getByRole("region", { name: "To do", exact: true }).getByRole("button", { name: "Add a task" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("New task in To do")).toBeFocused();
  await page.keyboard.type("Plant tulips");
  await page.keyboard.press("Enter");
  const card = page.getByRole("button", { name: /^#1 Plant tulips/ });
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");

  // Open it from the keyboard: focus goes into the sheet and stays there.
  await card.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  expect((await focused(page))?.inDialog, "focus moved into the sheet").toBe(true);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const f = await focused(page);
    expect(f?.inDialog, `Tab ${i + 1} left the sheet (${f?.what})`).toBe(true);
    expect(f?.ring, `${f?.what} in the sheet shows no focus ring`).toBe(true);
  }
  // Shift-Tab too.
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press("Shift+Tab");
    expect((await focused(page))?.inDialog).toBe(true);
  }
  // Escape closes it and focus goes back to the card.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(card).toBeFocused();

  // Project settings and the command menu give focus back too.
  await page.getByRole("button", { name: "Project settings" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  expect((await focused(page))?.inDialog).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Project settings" })).toBeFocused();

  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox", { name: "Command" })).toBeFocused();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await focused(page), "focus isn't lost after the command menu").not.toBeNull();

  // Settings, People and Machines: everything reachable shows a ring.
  for (const path of ["/settings", "/people", "/machines"]) {
    await page.goto(omicron.url + path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await tabThrough(page, path);
  }
});
