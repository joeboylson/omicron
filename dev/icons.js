// Make the web page's PNG icons from web/public/icon.svg. Run inside the
// omicron-dev test machine after dev/e2e.sh has installed Playwright:
//   NODE_PATH=~/omicron-e2e-deps/node_modules node ~/omicron/dev/icons.js
const { chromium } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");

const pub = path.join(__dirname, "..", "web", "public");
const svg = fs.readFileSync(path.join(pub, "icon.svg"), "utf8");

(async () => {
  const browser = await chromium.launch();
  for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    await page.screenshot({ path: path.join(pub, name) });
    await page.close();
  }
  await browser.close();
})();
