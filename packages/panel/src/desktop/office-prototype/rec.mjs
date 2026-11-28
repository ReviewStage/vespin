import { execFileSync } from "node:child_process";
import { rmSync, statSync } from "node:fs";
import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";

const [url, out, w = "1440", h = "900", scheme = "light", seconds = "4.6"] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({
  viewport: { width: +w, height: +h },
  colorScheme: scheme,
  recordVideo: { dir: "/tmp/pt/vid", size: { width: +w, height: +h } },
});
const start = Date.now();
const p = await ctx.newPage();
await p.goto(url, { waitUntil: "networkidle", timeout: 150000 });
await p.waitForSelector(".fun-scene", { timeout: 150000 });
await p.addStyleTag({ content: ".ui-toast-stack{display:none!important}" });
await p.waitForTimeout(2500);
const box = +w < 700 ? null : await p.locator("[aria-label=Home]").boundingBox();
const t0 = (Date.now() - start) / 1000;
await p.evaluate(() => window.replayScene());
await p.waitForTimeout(+seconds * 1000 + 400);
const video = p.video();
await ctx.close();
const raw = await video.path();
await b.close();
execFileSync("ffmpeg", [
  "-y",
  "-loglevel",
  "error",
  "-ss",
  String(t0 - 0.1),
  "-i",
  raw,
  "-t",
  seconds,
  ...(box
    ? [
        "-vf",
        `crop=${Math.round(box.width / 2) * 2}:${Math.round(box.height / 2) * 2}:${Math.round(box.x)}:${Math.round(box.y)}`,
      ]
    : []),
  "-c:v",
  "libvpx-vp9",
  "-b:v",
  "1500k",
  "-an",
  out,
]);
rmSync(raw);
console.log(out, statSync(out).size);
