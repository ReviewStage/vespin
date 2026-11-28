import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";

const [url, out, w = "1440", h = "900", scheme = "light"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h }, colorScheme: scheme });
await p.goto(url, { waitUntil: "networkidle", timeout: 150000 });
await p.waitForSelector(".fun-scene", { timeout: 150000 });
await p.addStyleTag({ content: ".ui-toast-stack{display:none!important}" });
await p.waitForTimeout(3500);
// Note that the main pane is the Home section's own box, the sidebar left out.
const box = +w < 700 ? null : await p.locator("[aria-label=Home]").boundingBox();
await p.screenshot({ path: out, ...(box ? { clip: box } : {}) });
console.log(
  out,
  box
    ? `${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.width)}x${Math.round(box.height)}`
    : "full",
);
await b.close();
