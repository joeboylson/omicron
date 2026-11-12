// @ts-check
// Odd text on the web page: emoji, right-to-left scripts, HTML and script
// tags, markdown, very long words, line breaks. All of it is shown as plain
// text, none of it runs, and the layout holds.
const { test, expect } = require("@playwright/test");
const { startOmicron, unique, sessionFor, rest, visitAs } = require("./omicron");

let omicron;
test.beforeAll(async () => {
  omicron = await startOmicron();
});
test.afterAll(() => omicron?.stop());

const TITLES = [
  "Buy 🥛 milk 🐄 (2 L)",
  "שלום עולם مرحبا بالعالم",
  '<img src=x onerror="window.__pwned=1">',
  "<script>window.__pwned=2</script>",
  '<a href="javascript:window.__pwned=3">click me</a>',
  "**bold** _it_ [link](javascript:window.__pwned=4) # not a heading",
  "Quotes \"double\" 'single' `back` & ampersand &amp; entity",
  "Supercalifragilisticexpialidocious".repeat(8),
  "Line one\nline two",
];

test("odd text shows as plain text, never runs, and the layout holds", async ({ page, request }) => {
  const login = `${unique("odd")}@example.com`;
  const me = await sessionFor(request, omicron, login, "Robin <b>Example</b>");
  const name = `🏡 בית <i>${unique("x")}</i>`;
  const project = await rest(request, me, "POST", "/rest/v1/rpc/start_project", { name });
  const [status] = await rest(request, me, "GET", `/rest/v1/statuses?project_id=eq.${project.id}&select=id&order=position&limit=1`);
  const [label] = await rest(request, me, "POST", "/rest/v1/labels", { project_id: project.id, name: "<b>🔥</b> urgent", color: "red" });
  const [topic] = await rest(request, me, "POST", "/rest/v1/topics", { project_id: project.id, name: "מטבח <kitchen>" });
  const tasks = [];
  for (const title of TITLES) {
    const [t] = await rest(request, me, "POST", "/rest/v1/tasks", {
      project_id: project.id,
      status_id: status.id,
      title,
      topic_id: topic.id,
      notes: '<img src=x onerror="window.__pwned=5">\n**not bold**\nשורה',
    });
    tasks.push(t);
  }
  await rest(request, me, "POST", "/rest/v1/task_labels", { task_id: tasks[0].id, label_id: label.id });
  await rest(request, me, "POST", "/rest/v1/comments", { task_id: tasks[0].id, body: '<script>window.__pwned=6</script>\n<b>not bold</b> 😀 שלום' });
  await rest(request, me, "PATCH", `/rest/v1/projects?id=eq.${project.id}`, { chat_enabled: true });
  await rest(request, me, "POST", "/rest/v1/chat_messages", { project_id: project.id, body: '<img src=x onerror="window.__pwned=7"> **hi** 🎉' });

  // No dialog may open, and nothing may run.
  const dialogs = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    d.dismiss();
  });
  await visitAs(page, omicron, login, "Robin <b>Example</b>");
  await page.goto(omicron.url);
  await expect(page.getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();
  await page.getByRole("link", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const board = page.getByRole("region", { name: status.name ?? "To do", exact: true });
  for (const title of TITLES) {
    // Shown exactly as written (a line break shows as a space in a card).
    await expect(page.getByText(title.replace("\n", " "), { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText("<b>🔥</b> urgent").first()).toBeVisible();
  // Nothing became an element: no images, links or bold from the text.
  await expect(page.locator('main img[src="x"], main a[href^="javascript"], main script')).toHaveCount(0);

  // The long word wraps inside its card instead of pushing out of it.
  const long = page.getByRole("button", { name: new RegExp(`^#\\d+ ${TITLES[7].slice(0, 30)}`) });
  const fits = await long.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits, "the long title overflows its card").toBe(true);

  // The sheet for the long one holds it too.
  await long.click();
  const longSheet = page.getByRole("dialog");
  await expect(longSheet).toBeVisible();
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
  const sheetFits = await longSheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(sheetFits, "the long title overflows the task sheet").toBe(true);
  await page.keyboard.press("Escape");
  await expect(longSheet).toHaveCount(0);

  // The task, its notes and its comment.
  await page.getByRole("button", { name: /^#1 / }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("<script>window.__pwned=6</script>", { exact: false })).toBeVisible();
  await expect(sheet.locator('img[src="x"], script, b')).toHaveCount(0);
  await expect(sheet.getByLabel("Notes")).toHaveValue('<img src=x onerror="window.__pwned=5">\n**not bold**\nשורה');
  await page.keyboard.press("Escape");

  // Chat.
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page.getByRole("list", { name: "Messages" })).toContainText('<img src=x onerror="window.__pwned=7"> **hi** 🎉');
  await expect(page.getByRole("dialog").locator('img[src="x"]')).toHaveCount(0);

  expect(await page.evaluate(() => /** @type {any} */ (window).__pwned)).toBeUndefined();
  expect(dialogs).toEqual([]);
});
