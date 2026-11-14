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
  await expect(page.getByRole("table", { name: "Projects" }).getByRole("link")).toHaveText([name]);
});

test("when we can't tell who's visiting, the page says so plainly (#156)", async ({ page }) => {
  await page.route(`${omicron.url}/api/session`, (r) =>
    r.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "who", detail: "refused a visit as someone: it didn't come through the gate" }) }),
  );
  await page.goto(omicron.url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("We couldn't tell who you are");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Make sure you're signed in to Tailscale on this device, then try again.");
  await expect(alert).not.toContainText(/refused|gate/);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  // The why, for whoever runs it, out of the way.
  await page.getByText("Details").click();
  await expect(page.getByText(/didn't come through the gate/)).toBeVisible();
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

test("each machine's Claude accounts show on the Machines page, live", async ({ page }) => {
  await page.goto(omicron.url);
  await expect(page.getByTestId("me")).toBeVisible();
  // Only people in a Project see machines.
  await page.getByRole("button", { name: "New Project" }).first().click();
  await page.getByLabel("New Project name").fill(unique("Desk"));
  await page.getByRole("button", { name: "Start Project" }).click();
  await page.getByRole("button", { name: "Back to Projects" }).click();
  const name = unique("laptop");
  const key = omicron.cli("machines", "register", name, "--print").trim();
  // The machine reports, as its daemon does (signed in with its own key).
  const [, id, secret] = key.match(/^omk_([0-9a-f]+)_(.+)$/);
  const uuid = id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
  const login = await (
    await fetch(`${need("OMICRON_SUPABASE_URL")}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: need("OMICRON_SUPABASE_KEY"), "Content-Type": "application/json" },
      body: JSON.stringify({ email: `${uuid}@machines.omicron.invalid`, password: secret }),
    })
  ).json();
  expect(login.access_token, JSON.stringify(login)).toBeTruthy();
  const res = await fetch(`${need("OMICRON_SUPABASE_URL")}/rest/v1/rpc/report_claude_accounts`, {
    method: "POST",
    headers: { apikey: need("OMICRON_SUPABASE_KEY"), Authorization: `Bearer ${login.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      info: { in_use: "work", auto: null, accounts: [{ name: "work", five_hour: { percent: 93, resets_at: null }, weekly: { percent: 20, resets_at: null } }] },
    }),
  });
  expect(res.ok, await res.text()).toBeTruthy();
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Machines" }).click();
  const machines = page.getByRole("list", { name: "Machines" });
  await expect(machines).toContainText(name);
  await expect(machines).toContainText("on work");
  await expect(machines).toContainText("93%");
});
