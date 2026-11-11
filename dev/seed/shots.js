// Screenshots of the seeded dev data, through the Mac's dev web page.
// Run inside the omicron-dev test machine:
//   NODE_PATH=~/omicron-e2e-deps/node_modules node ~/omicron/dev/seed/shots.js
// Saved to ~/omicron-e2e-results/seed-shots.
const { chromium, devices } = require("@playwright/test");
const path = require("node:path");

const url = process.env.OMICRON_DEV_URL || "http://host.lima.internal:9011";
const out = path.join(process.env.HOME, "omicron-e2e-results", "seed-shots");

(async () => {
  const browser = await chromium.launch();
  for (const [kind, options] of [
    ["desktop", { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }],
    ["phone", { ...devices["iPhone 13"] }],
  ]) {
    const page = await (await browser.newContext({ ...options, colorScheme: kind === "phone" ? "dark" : "light" })).newPage();
    // Visit as Joe, the way tailscale serve says who's visiting.
    await page.route(`${url}/**`, (r) =>
      r.continue({ headers: { ...r.request().headers(), "tailscale-user-login": "joeboylson@github", "tailscale-user-name": "Joe Boylson" } }),
    );
    const shot = async (name) => {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, `${kind}-${name}.png`) });
    };
    await page.goto(url);
    await page.getByRole("link", { name: /^Wedding photos/ }).waitFor();
    await shot("1-projects");
    await page.getByRole("link", { name: /^House and garden/ }).click();
    await page.getByRole("button", { name: /Fix the back gate/ }).waitFor();
    await shot("2-house");
    await page.getByRole("button", { name: /Fix the back gate/ }).click();
    await shot("3-task");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Back to Projects" }).click();
    await page.getByRole("link", { name: /^Omicron/ }).click();
    await page.getByRole("region", { name: "Claude sessions" }).waitFor();
    await shot("4-omicron");
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
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
