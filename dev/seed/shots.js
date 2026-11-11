// Screenshots of the seeded dev data, through the Mac's dev web page.
// Run inside the omicron-dev test machine:
//   NODE_PATH=~/omicron-e2e-deps/node_modules node ~/omicron/dev/seed/shots.js
// Saved to ~/omicron-e2e-results/seed-shots.
const { chromium, devices } = require("@playwright/test");
const path = require("node:path");

const url = process.env.OMICRON_DEV_URL || "http://host.lima.internal:9011";
const out = path.join(process.env.HOME, "omicron-e2e-results", "seed-shots");

// The page in use, for a picture of it if a step fails.
let failing;

(async () => {
  const browser = await chromium.launch();
  for (const [kind, options] of [
    ["desktop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }],
    ["phone", { ...devices["iPhone 13"] }],
  ]) {
    const page = await (await browser.newContext({ ...options, colorScheme: kind === "phone" ? "dark" : "light" })).newPage();
    failing = page;
    // Visit as Joe, the way tailscale serve says who's visiting.
    await page.route(`${url}/**`, (r) =>
      r.continue({ headers: { ...r.request().headers(), "tailscale-user-login": "joeboylson@github", "tailscale-user-name": "Joe Boylson" } }),
    );
    const shot = async (name, fullPage = false) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `${kind}-${name}.png`), fullPage });
    };
    await page.goto(url);
    await page.getByRole("link", { name: /^Wedding photos/ }).waitFor();
    await page.getByRole("list", { name: "Machines" }).waitFor();
    await shot("1-projects", true);
    await page.getByRole("link", { name: /^House and garden/ }).click();
    await page.getByRole("button", { name: /Fix the back gate/ }).waitFor();
    await shot("2-house");
    await page.getByRole("radio", { name: "Status and topic" }).click();
    await page.getByRole("region", { name: "Claire's to-do", exact: true }).waitFor();
    await shot("2b-house-topics", true);
    await page.getByRole("radio", { name: "Status", exact: true }).click();
    await page.getByRole("button", { name: /Fix the back gate/ }).click();
    await shot("3-task");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Project settings" }).click();
    await page.getByRole("region", { name: "Labels" }).waitFor();
    await shot("3b-settings");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to Projects" }).click();
    await page.getByRole("link", { name: /^Omicron/ }).click();
    await page.getByRole("region", { name: "Claude sessions" }).waitFor();
    await shot("4-omicron");
    // Dispatch: one that worked, one the machine never picked up.
    await page.getByRole("button", { name: /Parse the change list/ }).click();
    await page.getByTestId("dispatch").waitFor();
    await shot("4b-dispatched");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Sessions strip on the web page/ }).click();
    await page.getByRole("list", { name: "Comments" }).getByRole("img").first().waitFor();
    await page.getByRole("list", { name: "Comments" }).scrollIntoViewIfNeeded();
    await shot("4d-comment-images");
    await page.getByRole("button", { name: /^Open sessions-strip.png/ }).click();
    await page.locator('[role="dialog"] img[alt="sessions-strip.png"].object-contain').waitFor();
    await page.waitForTimeout(300);
    await shot("4e-image-full-size");
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"] img.object-contain').waitFor({ state: "detached" });
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.getByRole("button", { name: /Document the hooks/ }).click();
    await page.getByTestId("dispatch").waitFor();
    await shot("4c-dispatch-failed");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Chat", exact: true }).click();
    await page.getByRole("list", { name: "Messages" }).waitFor();
    await shot("5-chat");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to Projects" }).click();
    await page.getByRole("link", { name: /^Lisbon trip/ }).click();
    await page.getByRole("button", { name: /Day trip to Sintra/ }).waitFor();
    await shot("6-lisbon");
  }
  await browser.close();
})().catch(async (e) => {
  console.error(e);
  await failing?.screenshot({ path: path.join(out, "failed.png") }).catch(() => {});
  process.exit(1);
});
