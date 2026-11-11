// @ts-check
const { test, expect } = require("@playwright/test");
const http = require("node:http");
const { startOmicron, unique, need, visitAs: visitAsOn } = require("./omicron");

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
});
test.afterAll(() => omicron?.stop());

const visitAs = (page, login, name) => visitAsOn(page, omicron, login, name);

test("a visit from this machine signs in as this machine's person", async ({ page }) => {
  await page.goto(omicron.url);
  const me = page.getByTestId("me");
  await expect(me).toHaveText(omicron.me.name);
  await expect(me).toHaveAttribute("title", omicron.me.login);
  await expect(me).toHaveAttribute("data-via", "local");
});

test("a new person sees no Projects yet", async ({ page }) => {
  await visitAs(page, `${unique("new")}@example.com`, "New Person");
  await page.goto(omicron.url);
  await expect(page.getByTestId("me")).toHaveText("New Person");
  await expect(page.getByText("No Projects yet.")).toBeVisible();
});

test("a visit through Tailscale signs in as the visitor", async ({ page }) => {
  const login = `${unique("wife")}@example.com`;
  await visitAs(page, login, "Sam Example");
  await page.goto(omicron.url);
  const me = page.getByTestId("me");
  await expect(me).toHaveText("Sam Example");
  await expect(me).toHaveAttribute("title", login);
  await expect(me).toHaveAttribute("data-via", "tailnet");
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
  await expect(page.getByRole("list", { name: "Projects" }).getByRole("listitem")).toHaveText([`${name}0 tasks`]);
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

test("the page can be installed as an app", async ({ page }) => {
  await page.goto(omicron.url);
  await expect(page.getByTestId("me")).toBeVisible();
  const manifest = await (await page.request.get(`${omicron.url}/manifest.webmanifest`)).json();
  expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  for (const icon of ["/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"]) {
    const res = await page.request.get(`${omicron.url}${icon}`);
    expect(res.headers()["content-type"], icon).toBe("image/png");
  }
  // Ask Chrome itself whether it would offer to install the page.
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
});

test("errors the page catches show on screen and reach the server's log", async ({ page }) => {
  await page.goto(omicron.url);
  await expect(page.getByTestId("me")).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new ErrorEvent("error", { error: new Error("boom from a timer") }));
  });
  await expect(page.getByRole("alert")).toContainText("boom from a timer");
  await expect.poll(() => omicron.log()).toContain("page error [uncaught] boom from a timer");
});
