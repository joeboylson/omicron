// Screenshots of made-up data, desktop and phone: starts its own
// `omicron serve`, fills it (dev/seed/seed.js), and visits as the made-up Joe.
// Run with scripts/shots.sh, which cleans up after. Saved to SHOTS_OUT.
const { chromium, devices } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { startOmicron } = require("../../e2e/tests/omicron.js");
const { seed } = require("./seed.js");

const out = process.env.SHOTS_OUT || path.join(process.env.HOME, "omicron-e2e-results", "seed-shots");
fs.mkdirSync(out, { recursive: true });

// The page in use, for a picture of it if a step fails.
let failing;

let omicron, seeded;

/** Escape, once whatever is opening has finished (mid-animation it's lost). */
async function escape(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  await page.keyboard.press("Escape");
}

(async () => {
  omicron = await startOmicron();
  seeded = await seed(omicron);
  const url = omicron.url;
  const browser = await chromium.launch();
  for (const [kind, options] of [
    ["desktop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }],
    ["phone", { ...devices["iPhone 13"] }],
  ]) {
    const page = await (await browser.newContext({ ...options, colorScheme: kind === "phone" ? "dark" : "light" })).newPage();
    failing = page;
    // Visit as Joe, the way tailscale serve says who's visiting.
    await page.route(`${url}/**`, (r) =>
      r.continue({ headers: { ...r.request().headers(), "tailscale-user-login": seeded.logins.joe, "tailscale-user-name": "Joe Boylson" } }),
    );
    const shot = async (name, fullPage = false) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `${kind}-${name}.png`), fullPage });
    };
    // Board or List, Status or Topic: switches on wide screens, the View menu on a phone.
    // A Project's tab (#248).
    const tab = (name) => page.getByRole("navigation", { name: "Project" }).getByRole("button", { name, exact: true }).click();
    const view = async (name) => {
      const radio = page.getByRole("radio", { name, exact: true });
      if (await radio.isVisible()) return radio.click();
      await page.getByRole("button", { name: /^View and filters/ }).click();
      await page.getByRole("menuitemradio", { name }).click();
      await page.getByRole("menu").waitFor({ state: "detached" });
    };
    // Pages that aren't there.
    await page.goto(`${url}/nowhere`);
    await page.getByRole("heading", { name: "Nothing here" }).waitFor();
    await shot("0-not-found");
    await page.goto(url);
    await page.getByRole("link", { name: /^Wedding photos/ }).waitFor();
    await shot("1-projects", true);
    // ⌘K: every command and Project.
    await page.keyboard.press("ControlOrMeta+K");
    await page.getByRole("combobox", { name: "Command" }).waitFor();
    await shot("1d-command-menu");
    await escape(page);
    await page.getByRole("button", { name: "New Project" }).first().click();
    await page.getByLabel("New Project name").waitFor();
    await shot("1e-new-project");
    await escape(page);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.getByLabel("Search Projects").fill("zzz");
    await page.getByText(/Nothing matches/).waitFor();
    await shot("1f-projects-no-match");
    await page.getByLabel("Search Projects").fill("");
    await page.getByTestId("me").click();
    await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
    await shot("1g-settings", true);
    await page.goto(`${url}/people`);
    await page.getByRole("heading", { level: 1, name: "People" }).waitFor();
    await shot("1b-people", true);
    await page.getByRole("button", { name: "Add person" }).click();
    await page.getByRole("dialog", { name: "Add someone" }).waitFor();
    await shot("1l-add-person");
    await escape(page);
    // One Project's people, and deleting someone (asks once more; cancelled).
    await page.getByLabel("Only people in").selectOption({ label: "In Lisbon trip" });
    await page.getByRole("button", { name: "More for Sam Rivera" }).click();
    await page.getByRole("menuitem", { name: "Remove from Lisbon trip" }).waitFor();
    await shot("1k-people-menu");
    await page.getByRole("menuitem", { name: "Delete Sam Rivera…" }).click();
    const asked = page.getByRole("alertdialog", { name: "Delete Sam Rivera?" });
    await asked.waitFor();
    await shot("1h-people-delete");
    await asked.getByRole("button", { name: "Cancel" }).click();
    await asked.waitFor({ state: "detached" });
    await page.goto(`${url}/machines`);
    await page.getByRole("heading", { level: 1, name: "Machines" }).waitFor();
    await shot("1c-machines", true);
    await page.getByRole("button", { name: "New key" }).click();
    await page.getByLabel("Machine name").waitFor();
    await shot("1i-new-key");
    await escape(page);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "More for build-box" }).click();
    await page.getByRole("menuitem", { name: /Switch Off/ }).waitFor();
    await shot("1m-machine-menu");
    await page.getByRole("menuitem", { name: /Remove build-box…/ }).click();
    await page.getByRole("heading", { name: "Remove build-box?" }).waitFor();
    await shot("1j-remove-machine");
    await escape(page);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.goto(url);
    await page.getByRole("link", { name: /^Wedding photos/ }).waitFor();
    await page.getByRole("link", { name: /^House and garden/ }).click();
    await page.getByRole("button", { name: /Fix the back gate/ }).waitFor();
    await shot("2-house");
    // The same with Increase Contrast on (#214).
    await page.emulateMedia({ contrast: "more" });
    await shot("2b-house-more-contrast");
    await page.emulateMedia({ contrast: "no-preference" });
    // Filters, a search that finds nothing, adding a task, a column's menu.
    // Filters: chips on wide screens, the View and filters menu on a phone.
    const filters = page.getByRole("group", { name: "Filters" });
    if (await filters.isVisible()) {
      await filters.getByRole("button", { name: "Due in 7 days" }).click();
      await shot("2c-filter-due-soon");
      await page.getByRole("button", { name: "Clear", exact: true }).click();
    } else {
      await page.getByRole("button", { name: /^View and filters/ }).click();
      await page.getByRole("menuitemcheckbox", { name: "Due in 7 days" }).click();
      await shot("2c-filter-due-soon");
      await page.getByRole("menuitem", { name: "Clear filters" }).click();
      await page.getByRole("menu").waitFor({ state: "detached" });
    }
    await page.getByLabel("Search tasks").fill("zzz");
    await shot("2d-search-nothing");
    await page.getByRole("button", { name: "Clear search" }).click();
    const todo = page.getByRole("region", { name: "To do", exact: true });
    await todo.getByRole("button", { name: "Add Task" }).click();
    await page.getByRole("dialog").getByLabel("Title").waitFor();
    await shot("2e-add-task");
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await todo.getByRole("button", { name: /^More for / }).click();
    await page.getByRole("menuitem", { name: "Sort by" }).hover();
    await page.getByRole("menuitem", { name: "Name", exact: true }).waitFor();
    await shot("2f-column-menu");
    await page.keyboard.press("Escape");
    await escape(page);
    await view("Topic");
    await page.getByRole("region", { name: "Claire's to-do", exact: true }).waitFor();
    await shot("2b-house-topics", true);
    await view("Person");
    await page.getByRole("region", { name: "Nobody", exact: true }).waitFor();
    await shot("2h-house-people", true);
    await view("Status");
    await view("List");
    await page.getByRole("list", { name: "To do" }).waitFor();
    await shot("2g-house-list", true);
    await view("Board");
    await page.getByRole("button", { name: /Fix the back gate/ }).click();
    await shot("3-task");
    // Tabbing to a field: its row shows where focus is.
    await page.getByRole("dialog").getByLabel("Status").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await shot("3c-task-focus");
    // Its ⋯ menu, and who it can be given to.
    await page.getByRole("button", { name: "More for this task" }).click();
    await page.getByRole("menuitem", { name: "Delete task" }).waitFor();
    await shot("3a-task-menu");
    await page.keyboard.press("Escape");
    await page.getByRole("menu").waitFor({ state: "detached" });
    await page.getByLabel("Given to", { exact: true }).click();
    await page.getByRole("option", { name: "Nobody" }).waitFor();
    await shot("3c-given-to");
    await page.keyboard.press("Escape");
    await page.getByRole("listbox").waitFor({ state: "detached" });
    await escape(page);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    // Settings is a tab (#248): who's in it at the top, then the rest.
    await tab("Settings");
    await page.getByRole("region", { name: "Labels" }).waitFor();
    await shot("3b-settings");
    await page.getByLabel("Delete Project").scrollIntoViewIfNeeded();
    await shot("3d-settings-lower");
    await tab("Loops");
    await shot("3f-runs-empty");
    await tab("Tasks");
    await page.getByRole("button", { name: "Back to Projects" }).click();
    await page.getByRole("link", { name: /^Lumen/ }).click();
    await page.getByRole("button", { name: /Parse the change list/ }).waitFor();
    await shot("4-lumen");
    // The Claude sessions: on the Dev tab (#248).
    const sessions = async () => {
      await tab("Dev");
      return page.getByRole("region", { name: "Claude sessions" }).last();
    };
    await (await sessions()).getByRole("button", { name: /web-page/ }).click();
    await page.getByTestId("loop").waitFor();
    await shot("4g-session-loop");
    await escape(page);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await (await sessions()).getByRole("button", { name: /parser/ }).click();
    await page.getByRole("dialog", { name: /parser/ }).waitFor();
    await shot("4h-parser-session");
    await escape(page);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await shot("4n-dev-tab");
    await tab("Loops");
    await shot("4o-runs-tab");
    await tab("Tasks");
    // Dispatch: one that worked, one the machine never picked up.
    await page.getByRole("button", { name: /Parse the change list/ }).click();
    await page.getByTestId("dispatch").waitFor();
    await shot("4b-dispatched");
    await escape(page);
    await page.getByRole("button", { name: /Sessions strip on the web page/ }).click();
    await page.getByRole("list", { name: "Comments" }).getByRole("img").first().waitFor();
    await page.getByRole("list", { name: "Comments" }).scrollIntoViewIfNeeded();
    await shot("4d-comment-images");
    await page.getByRole("button", { name: /^Open sessions-strip.png/ }).click();
    await page.locator('[role="dialog"] img[alt="sessions-strip.png"].object-contain').waitFor();
    await page.waitForTimeout(300);
    await shot("4e-image-full-size");
    await escape(page);
    await page.locator('[role="dialog"] img.object-contain').waitFor({ state: "detached" });
    await page.waitForTimeout(300);
    await escape(page);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    // Given to a session that has ended (its window died): flagged, to give to someone else.
    await page.getByRole("button", { name: /Document the hooks/ }).click();
    await page.getByTestId("ended-session").waitFor();
    await shot("4c-ended-session");
    await escape(page);
    await page.getByRole("button", { name: "Back to Projects" }).click();
    await page.getByRole("link", { name: /^Lisbon trip/ }).click();
    await page.getByRole("button", { name: /Day trip to Sintra/ }).waitFor();
    await shot("6-lisbon");
    // Columns by topic with none yet; a task that isn't there; a Project that isn't.
    await view("Topic");
    await page.getByText(/No topics yet/).waitFor();
    await shot("6b-no-topics");
    await view("Status");
    const lisbon = page.url().split("?")[0];
    await page.goto(`${lisbon}?task=999`);
    await page.getByText(/There's no task #999/).waitFor();
    await shot("6c-missing-task");
    await page.goto(`${url}/p/00000000-0000-0000-0000-000000000000`);
    await page.getByRole("heading", { level: 1, name: "Can't open this Project" }).waitFor();
    await shot("6d-project-not-found");
  }

  // Signing in failed (the page as anyone sees it then).
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })).newPage();
    failing = page;
    await page.route(`${url}/api/session`, (r) => r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "who", detail: "refused a visit as someone: it didn't come through the gate" }) }));
    await page.goto(url);
    await page.getByRole("button", { name: "Try again" }).waitFor();
    await page.screenshot({ path: path.join(out, "desktop-0b-sign-in-failed.png") });
    await page.context().close();
  }

  // The owner's side: this serving computer as a machine Joe owns, with a
  // folder and a session of Lumen's on it.
  omicron.cli("machines", "register", "this-mac", "--all-projects");
  omicron.cli("machines", "owner", seeded.logins.joe);
  omicron.cli("remote", "off");
  const lumenDir = omicron.folder();
  omicron.cli("folders", "add", lumenDir, "--project", "Lumen");
  const claude = crypto.randomUUID();
  const devWin = await omicron.open("docs-site", "Lumen", claude);
  omicron.hook(devWin.pid, "session-start", { session_id: claude, cwd: lumenDir, source: "resume" });
  try {
    for (const [kind, options] of [
      ["desktop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }],
      ["phone", { ...devices["iPhone 13"] }],
    ]) {
      const page = await (await browser.newContext({ ...options, colorScheme: kind === "phone" ? "dark" : "light" })).newPage();
      failing = page;
      await page.route(`${url}/**`, (r) =>
        r.continue({ headers: { ...r.request().headers(), "tailscale-user-login": seeded.logins.joe, "tailscale-user-name": "Joe Boylson" } }),
      );
      const shot = async (name, fullPage = false) => {
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(out, `${kind}-${name}.png`), fullPage });
      };
      await page.goto(url);
      await page.getByRole("link", { name: /^Lumen/ }).click();
      // Remote control is on the Dev tab (#248).
      const projectTab = (name) => page.getByRole("navigation", { name: "Project" }).getByRole("button", { name, exact: true }).click();
      await projectTab("Dev");
      await page.getByTestId("gate").waitFor();
      await page.getByTestId("gate").click();
      await page.getByText(/You can always use/).waitFor();
      await shot("7-gate");
      await page.keyboard.press("Escape");
      await projectTab("Tasks");
      // A team's question, waiting on Joe (#153).
      await page.getByRole("button", { name: /Should deleting a task also delete/ }).click();
      await page.getByTestId("asked-by").waitFor();
      await shot("7f-team-question");
      await escape(page);
      await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: "Dev", exact: true }).click();
      // The Dev tab (#252): Sessions, Folders and Keys, each a table.
      const devShow = (name) => page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name, exact: true }).click();
      await page.getByRole("button", { name: /^docs-site/ }).filter({ visible: true }).first().waitFor();
      await shot("7b-dev-view");
      await devShow("Folders");
      await page.getByRole("button", { name: /^Open a new session in/ }).filter({ visible: true }).first().waitFor();
      await shot("7g-dev-folders");
      await devShow("Keys");
      await page.getByText(/^No keys\.|^Works until/).filter({ visible: true }).first().waitFor();
      await shot("7h-dev-keys");
      await devShow("Sessions");
      // Pinned to the top bar, and opened as a page.
      await page.getByRole("button", { name: "Pin docs-site to the top bar" }).filter({ visible: true }).first().click();
      await page.getByRole("button", { name: /^docs-site/ }).filter({ visible: true }).first().click();
      await page.getByRole("region", { name: "Session docs-site" }).waitFor();
      await page.getByTestId("terminal-docs-site").locator(".xterm").click();
      await page.keyboard.type("hello from the Dev view");
      await shot("7c-dev-terminal");
      // Beside the board, on a wide screen.
      const besideButton = page.getByRole("button", { name: "Open beside the page" });
      if (await besideButton.isVisible()) {
        await besideButton.click();
        await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: "Tasks", exact: true }).click();
        await page.getByRole("complementary", { name: "Beside the page" }).waitFor();
        await shot("7i-session-beside");
        await page.getByRole("button", { name: "Close docs-site beside the page" }).click();
      } else {
        await page.getByRole("button", { name: "Back to sessions" }).click();
      }
      // A loop, on the Loops tab (#253): New Loop step by step, the table, templates.
      const loopsTab = () => page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: "Loops", exact: true }).click();
      await loopsTab();
      await page.getByRole("button", { name: "New Loop" }).click();
      await page.getByRole("dialog").getByRole("button", { name: /^Work Through Tasks/ }).waitFor();
      await shot("4i-new-loop");
      await page.getByRole("dialog").getByRole("button", { name: /^Work Through Tasks/ }).click();
      for (const box of (await page.getByRole("dialog").getByRole("checkbox").all()).slice(0, 2)) await box.click();
      await shot("4j-new-loop-tasks");
      await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
      await page.getByRole("dialog").getByRole("radio", { name: /^docs-site/ }).click();
      await shot("4k-new-loop-session");
      await page.getByRole("dialog").getByRole("button", { name: "Start", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "detached" });
      await page.locator("tr, li").filter({ hasText: "Running", visible: true }).first().waitFor();
      await shot("4m-loops-tab");
      // Stop it, so the next pass can start one in docs-site again.
      await page.locator("tr, li").filter({ hasText: "Running", visible: true }).getByRole("button", { name: /^More for/ }).first().click();
      await page.getByRole("menuitem", { name: "Stop Now" }).click();
      await page.locator("tr, li").filter({ hasText: /Stopped/, visible: true }).first().waitFor();
      await page.getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: "Templates" }).click();
      await shot("4n-templates");
      await page.getByRole("navigation", { name: "Project" }).getByRole("button", { name: "Dev", exact: true }).click();
      await page.getByRole("button", { name: "This computer" }).click();
      await page.getByRole("dialog").getByRole("region", { name: "Setup checks" }).waitFor();
      await page.waitForTimeout(1500);
      await shot("7d-this-computer");
      await escape(page);
      await page.context().close();
    }
  } finally {
    devWin.kill();
  }
  await browser.close();
  seeded.stop();
  omicron.stop();
})().catch(async (e) => {
  console.error(e);
  await failing?.screenshot({ path: path.join(out, "failed.png") }).catch(() => {});
  seeded?.stop();
  omicron?.stop();
  process.exit(1);
});
