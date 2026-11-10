// @ts-check
const { test, expect } = require("@playwright/test");
const http = require("node:http");
const { startOmicron, unique, need } = require("./omicron");

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
});
test.afterAll(() => omicron?.stop());

/**
 * Make requests to the omicron server look like they came through
 * `tailscale serve`. Only requests to omicron get the headers, not the ones
 * the page makes to Supabase.
 */
async function visitAs(page, login, name) {
  await page.route(`${omicron.url}/**`, (route) =>
    route.continue({
      headers: { ...route.request().headers(), "tailscale-user-login": login, "tailscale-user-name": name },
    }),
  );
}

test("a visit from this machine signs in as this machine's person", async ({ page }) => {
  await page.goto(omicron.url);
  const status = page.locator("#status");
  await expect(status).toHaveText(`Signed in as ${omicron.me.name} (${omicron.me.login})`);
  await expect(status).toHaveAttribute("data-via", "local");
});

test("a new person sees no Projects yet", async ({ page }) => {
  await visitAs(page, `${unique("new")}@example.com`, "New Person");
  await page.goto(omicron.url);
  await expect(page.locator("#status")).toHaveText(/Signed in as New Person/);
  await expect(page.locator("#projects")).toHaveText("No Projects yet. Ask someone to add you to one.");
});

test("a visit through Tailscale signs in as the visitor", async ({ page }) => {
  const login = `${unique("wife")}@example.com`;
  await visitAs(page, login, "Sam Example");
  await page.goto(omicron.url);
  const status = page.locator("#status");
  await expect(status).toHaveText(`Signed in as Sam Example (${login})`);
  await expect(status).toHaveAttribute("data-via", "tailnet");
});

test("the page shows the Projects the person is in", async ({ page, request }) => {
  const login = `${unique("member")}@example.com`;
  const session = await (
    await request.post(`${omicron.url}/api/session`, {
      headers: { "tailscale-user-login": login, "tailscale-user-name": "Member" },
    })
  ).json();
  const name = unique("Groceries");
  const started = await request.post(`${need("OMICRON_SUPABASE_URL")}/rest/v1/rpc/start_project`, {
    headers: { apikey: need("OMICRON_SUPABASE_KEY"), Authorization: `Bearer ${session.access_token}` },
    data: { name },
  });
  expect(started.ok()).toBeTruthy();

  await visitAs(page, login, "Member");
  await page.goto(omicron.url);
  await expect(page.locator("#projects li")).toHaveText([name]);
});

test("signing in needs POST", async ({ request }) => {
  const res = await request.get(`${omicron.url}/api/session`);
  expect(res.status()).toBe(405);
});

test("the page refuses to be opened under another site's name", async () => {
  // A browser can't fake the Host header, so use a plain request.
  const { port } = new URL(omicron.url);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: "/api/session", method: "POST", headers: { Host: "evil.example.com" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  expect(status).toBe(421);
});
