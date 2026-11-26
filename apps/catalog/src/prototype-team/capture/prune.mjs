import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";

const src = readFileSync("/tmp/pt/team-views.html", "utf8");
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto("file:///tmp/pt/team-views.html");
const pruned = await p.evaluate(() => {
  const sheet = document.styleSheets[0];
  const used = (sel) => {
    const parts = sel.split(",");
    return parts.some((s) => {
      const t = s.replace(/::?[a-z-]+(\([^)]*\))?/g, "").trim();
      if (t === "" || /^(html|body|\*|:root)$/.test(t)) return true;
      if (/^\[data-ui-(profile|theme|density)/.test(t) && !/\s/.test(t)) return true;
      try {
        return document.querySelector(t) !== null;
      } catch {
        return true;
      }
    });
  };
  const walk = (rules) => {
    const out = [];
    for (const r of rules) {
      if (r instanceof CSSStyleRule) {
        if (used(r.selectorText)) out.push(r.cssText);
      } else if (
        r instanceof CSSMediaRule ||
        r instanceof CSSSupportsRule ||
        r instanceof CSSLayerBlockRule ||
        (window.CSSContainerRule && r instanceof CSSContainerRule)
      ) {
        const inner = walk(r.cssRules);
        if (inner.length) {
          const head = r.cssText.slice(0, r.cssText.indexOf("{"));
          out.push(`${head}{${inner.join("\n")}}`);
        }
      } else if (r instanceof CSSKeyframesRule) {
        // Note that nothing here moves, so keyframes are left out.
      } else out.push(r.cssText);
    }
    return out;
  };
  return walk(sheet.cssRules).join("\n");
});
await b.close();
const start = src.indexOf("<style>") + 7;
const end = src.indexOf("</style>");
const out = src.slice(0, start) + pruned + src.slice(end);
writeFileSync("/tmp/pt/team-views.html", out);
console.log("css before", end - start, "after", pruned.length, "total", out.length);
