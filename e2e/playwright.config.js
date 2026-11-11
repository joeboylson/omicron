// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  reporter: [["list"]],
  use: { browserName: "chromium", trace: "retain-on-failure" },
  // The accessibility check (axe) is heavy: it runs after the rest, not
  // alongside them, so the test machine doesn't run short of memory.
  projects: [
    { name: "app", testIgnore: /a11y\.spec/ },
    { name: "a11y", testMatch: /a11y\.spec/, dependencies: ["app"] },
  ],
  // Results stay on the VM's disk, not in the mounted folder.
  outputDir: `${process.env.HOME}/omicron-e2e-results`,
});
