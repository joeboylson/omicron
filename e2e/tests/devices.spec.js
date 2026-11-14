// @ts-check
// The page on a phone and a tablet, by touch: nothing runs off the side of
// the screen, everything that can be tapped is big enough to tap, sheets and
// dialogs fit, and a task can be moved by pressing and holding.
const { test, expect, devices } = require("@playwright/test");
const { startOmicron, unique, sessionFor, rest, visitAs } = require("./omicron");

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
});
test.afterAll(() => omicron?.stop());

/** Nothing on the page is wider than the screen (no sideways scrolling). */
async function fits(page, where) {
  const over = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const out = [];
    // The board's columns scroll sideways inside their own strip, on purpose.
    const inScroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if ((s.overflowX === "auto" || s.overflowX === "scroll") && p !== document.documentElement && p !== document.body) return true;
      }
      return false;
    };
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || inScroller(el)) continue;
      if (r.right > w + 1 || r.left < -1) out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} "${(el.textContent || "").trim().slice(0, 30)}" ${Math.round(r.left)}–${Math.round(r.right)} of ${w} ${el.className}`);
    }
    return { scroll: document.documentElement.scrollWidth > w + 1, out: out.slice(0, 5) };
  });
  expect(over.scroll, `${where}: the page scrolls sideways`).toBe(false);
  expect(over.out, `${where}: things off the side of the screen`).toEqual([]);
}

/** Everything that can be tapped is at least 32 points each way (Apple asks
 *  for 44; small icon buttons get a larger tap area around them). */
async function tappable(page, where) {
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="radio"], [role="switch"], [role="checkbox"], input, select, textarea')) {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || s.visibility === "hidden" || el.closest("[aria-hidden=true]") || el.getAttribute("tabindex") === "-1") continue;
      // Apple's own switch is 51 by 31.
      const least = el.getAttribute("role") === "switch" ? 31 : 32;
      if (Math.min(r.width, r.height) < least) {
        out.push(`${el.tagName.toLowerCase()} "${el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    return out.slice(0, 8);
  });
  expect(small, `${where}: too small to tap`).toEqual([]);
}

/** A dialog or sheet is all on screen. */
async function onScreen(page, locator, where) {
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  expect(box, `${where}: not shown`).not.toBeNull();
  expect(box.x >= -1 && box.x + box.width <= vp.width + 1, `${where}: wider than the screen`).toBe(true);
}

async function settled(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
}

/** A quick swipe from one place to another, with no hold (scrolling). */
async function swipe(page, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const at = (x, y) => [{ x, y }];
  const [ax, ay, bx, by] = [a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + 4];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(ax, ay) });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(ax + ((bx - ax) * i) / 8, ay + ((by - ay) * i) / 8) });
    await page.waitForTimeout(8);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Press and hold on one place, then drag to another (as a finger does). */
async function holdAndDrag(page, from, to) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const at = (x, y) => [{ x, y }];
  const ax = a.x + a.width / 2;
  const ay = a.y + a.height / 2;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(ax, ay) });
  await page.waitForTimeout(400);
  const bx = b.x + b.width / 2;
  const by = b.y + 4;
  for (let i = 1; i <= 15; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(ax + ((bx - ax) * i) / 15, ay + ((by - ay) * i) / 15) });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(150);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

}

for (const [kind, device] of [
  ["phone", devices["iPhone 13"]],
  ["tablet", devices["iPad (gen 7)"]],
]) {
  test.describe(kind, () => {
    // Everything about the device but its browser (always Chromium here).
    const { defaultBrowserType, ...settings } = device;
    test.use(settings);

    test(`the main pages and sheets fit a ${kind} and can be used by touch`, async ({ page, request }) => {
      const login = `${unique(kind)}@example.com`;
      const me = await sessionFor(request, omicron, login, "Robin Example");
      const name = unique("Garden");
      const project = await rest(request, me, "POST", "/rest/v1/rpc/start_project", { name });
      const statuses = await rest(request, me, "GET", `/rest/v1/statuses?project_id=eq.${project.id}&select=id,name&order=position`);
      for (const title of ["Plant the tulips before the first frost comes", "Fix the gate", "Prune the roses"]) {
        await rest(request, me, "POST", "/rest/v1/tasks", { project_id: project.id, status_id: statuses[0].id, title, notes: "Some notes about it." });
      }
      await visitAs(page, omicron, login, "Robin Example");

      // Projects.
      await page.goto(omicron.url);
      await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
      await settled(page);
      await fits(page, "Projects");
      await tappable(page, "Projects");

      // The board: the page itself doesn't scroll sideways (the columns do, in their strip).
      await page.getByRole("link", { name: new RegExp(name) }).tap();
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await expect(page.getByRole("button", { name: /Fix the gate/ })).toBeVisible();
      await settled(page);
      await fits(page, "Board");
      await tappable(page, "Board");

      // Press and hold, then drag: Prune the roses goes to the top of To do.
      const todo = page.getByRole("region", { name: statuses[0].name, exact: true });
      const order = async () => (await todo.getByRole("button", { name: /^#\d+ / }).allTextContents()).map((t) => t.replace(/#\d+$/, "").trim());
      await expect.poll(order).toEqual(["Plant the tulips before the first frost comes", "Fix the gate", "Prune the roses"]);
      // A quick swipe over a card scrolls; it doesn't pick the card up (#141).
      await swipe(page, todo.getByRole("button", { name: /Prune the roses/ }), todo.getByRole("button", { name: /Plant the tulips/ }));
      await page.waitForTimeout(1500);
      expect(await order()).toEqual(["Plant the tulips before the first frost comes", "Fix the gate", "Prune the roses"]);
      await holdAndDrag(page, todo.getByRole("button", { name: /Prune the roses/ }), todo.getByRole("button", { name: /Plant the tulips/ }));
      await expect.poll(order).toEqual(["Prune the roses", "Plant the tulips before the first frost comes", "Fix the gate"]);

      // On a phone, every column's name and count is above the board; a tap
      // goes to that column (#142).
      if (kind === "phone") {
        const jump = page.getByRole("navigation", { name: "Go to column" });
        const last = statuses[statuses.length - 1].name;
        await expect(jump.getByRole("button", { name: `${statuses[0].name} 3` })).toHaveAttribute("aria-current", "true");
        const lastColumn = page.getByRole("region", { name: last, exact: true });
        await expect(lastColumn).not.toBeInViewport({ ratio: 0.9 });
        await jump.getByRole("button", { name: new RegExp(`^${last} `) }).tap();
        await expect(lastColumn).toBeInViewport({ ratio: 0.9 });
        await expect(jump.getByRole("button", { name: new RegExp(`^${last} `) })).toHaveAttribute("aria-current", "true");
        await jump.getByRole("button", { name: new RegExp(`^${statuses[0].name} `) }).tap();
        await expect(todo).toBeInViewport({ ratio: 0.9 });
      }

      // A task's sheet.
      await page.getByRole("button", { name: /Plant the tulips/ }).tap();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await settled(page);
      await onScreen(page, sheet, "Task sheet");
      await tappable(page, "Task sheet");
      // Typing a comment: the box stays in view above the keyboard area.
      const box = sheet.getByLabel("New comment");
      await box.tap();
      await box.fill("Done the bulbs.");
      await expect(box).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);

      // Project settings.
      await page.getByRole("button", { name: "Project settings" }).tap();
      await expect(page.getByRole("dialog")).toBeVisible();
      await settled(page);
      await onScreen(page, page.getByRole("dialog"), "Project settings");
      await tappable(page, "Project settings");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);

      // People, Settings and Machines.
      for (const [path, heading] of [
        ["/people", "People"],
        ["/settings", "Settings"],
        ["/machines", "Machines"],
      ]) {
        await page.goto(omicron.url + path);
        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        await settled(page);
        await fits(page, heading);
        await tappable(page, heading);
      }
    });
  });
}
