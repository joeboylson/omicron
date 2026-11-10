// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  reporter: [["list"]],
  use: { browserName: "chromium", trace: "retain-on-failure" },
  // Results stay on the VM's disk, not in the mounted folder.
  outputDir: `${process.env.HOME}/omicron-e2e-results`,
});
