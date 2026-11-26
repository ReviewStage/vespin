import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";

const [url, out, w = "1440", h = "900", scheme = "light"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h }, colorScheme: scheme });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e).slice(0, 300)));
await p.goto(url, { waitUntil: "networkidle", timeout: 120000 });
await p.addStyleTag({ content: ".ui-toast-stack{display:none!important}" }).catch(() => {});
await p
  .waitForSelector(process.env.SEL ?? "[aria-label=Home]", { timeout: 150000 })
  .catch(() => {});
await p.addStyleTag({ content: ".ui-toast-stack{display:none!important}" });
await p.waitForTimeout(2000);
await p.screenshot({ path: out });
console.log(errs.join("\n") || "ok");
await b.close();
