// Screenshots of made-up data, desktop and phone: starts its own
// `omicron serve`, fills it (dev/seed/seed.js), and visits as the made-up Joe.
// Run with scripts/shots.sh, which cleans up after. Saved to SHOTS_OUT.
const { chromium, devices } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
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
    await page.goto(url);
    await page.getByRole("link", { name: /^Wedding photos/ }).waitFor();
    await shot("1-projects", true);
    await page.goto(`${url}/people`);
    await page.getByRole("heading", { level: 1, name: "People" }).waitFor();
    await shot("1b-people", true);
    await page.goto(`${url}/machines`);
    await page.getByRole("heading", { level: 1, name: "Machines" }).waitFor();
    await shot("1c-machines", true);
    await page.goto(url);
    await page.getByRole("link", { name: /^Wedding photos/ }).waitFor();
    await page.getByRole("link", { name: /^House and garden/ }).click();
    await page.getByRole("button", { name: /Fix the back gate/ }).waitFor();
    await shot("2-house");
    await page.getByRole("radio", { name: "Status and topic" }).click();
    await page.getByRole("region", { name: "Claire's to-do", exact: true }).waitFor();
    await shot("2b-house-topics", true);
    await page.getByRole("radio", { name: "Status", exact: true }).click();
    await page.getByRole("button", { name: /Fix the back gate/ }).click();
    await shot("3-task");
    await escape(page);
    await page.getByRole("button", { name: "Project settings" }).click();
    await page.getByRole("region", { name: "Labels" }).waitFor();
    await shot("3b-settings");
    await escape(page);
    await page.getByRole("button", { name: "Back to Projects" }).click();
    await page.getByRole("link", { name: /^Lumen/ }).click();
    await page.getByRole("region", { name: "Claude sessions" }).waitFor();
    await shot("4-lumen");
    await page.getByRole("region", { name: "Claude sessions" }).getByRole("button", { name: /web-page/ }).click();
    await page.getByTestId("loop").waitFor();
    await shot("4g-session-loop");
    await escape(page);
    await page.getByRole("dialog").waitFor({ state: "detached" });
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
    await page.getByText(/which has ended/).waitFor();
    await shot("4c-ended-session");
    await escape(page);
    await page.getByRole("button", { name: "Back to Projects" }).click();
    await page.getByRole("link", { name: /^Lisbon trip/ }).click();
    await page.getByRole("button", { name: /Day trip to Sintra/ }).waitFor();
    await shot("6-lisbon");
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
