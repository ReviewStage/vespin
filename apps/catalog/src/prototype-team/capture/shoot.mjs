import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";

const variants = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
for (const v of variants) {
  await page.goto(`http://localhost:5390/prototype-team.html?variant=${v}`, {
    waitUntil: "networkidle",
  });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/shared/team-${v}.png`, fullPage: true });
}
console.log(errors.join("\n") || "no errors");
await browser.close();
