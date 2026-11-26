import { writeFileSync } from "node:fs";
import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";

const VARIANTS = [
  {
    key: "roster",
    name: "Roster + feed",
    kind: "Practical",
    note: "Waiting on you first, a card per Manager, and the team's feed beside them. It maps onto today's Manager Overview, so it is the cheapest to build, but it reads as a dashboard, not a team.",
  },
  {
    key: "building",
    name: "Building",
    kind: "Bold, scales",
    note: "One floor per Manager, a lit window per agent, handoffs riding the elevator, and your asks as mail in the lobby. Load and asks read in one sweep, a new Manager is one more floor, and each floor folds to a row on a phone.",
  },
  {
    key: "newspaper",
    name: "The Daily Standup",
    kind: "Narrative",
    note: "A front page whose lead story is the Manager most blocked on you, with what waits on your signature boxed above the fold and merged PRs as the markets column. It is a good morning read, but a digest rather than a live view, and heavy on text.",
  },
  {
    key: "transit",
    name: "Transit map",
    kind: "Flow over time",
    note: "A line per Manager runs from what it shipped, through now, toward its goal; handoffs are transfers between lines, and stops held for you are orange. It is the only variant that shows time and flow, though many handoffs will tangle.",
  },
  {
    key: "cards",
    name: "Trading cards",
    kind: "Personality",
    note: "Each Manager is a card (quest, stats, its agents as moves), and you hold a hand of asks. It gives the Managers character and is easy to compare side by side, but the text is small and the gimmick may wear thin.",
  },
  {
    key: "solar",
    name: "Your orbit",
    kind: "You at the center",
    note: "Distance from you encodes how much a Manager waits on you, and its moons are its agents. It is the strongest 'what needs me' metaphor, but positions mean nothing else, and labels and arcs are fiddly to lay out.",
  },
  {
    key: "studio",
    name: "The studio",
    kind: "Delight",
    note: "An isometric floor with a desk per Manager, a monitor per agent lit by its state, and colored trays on your desk. It is the most charming, the hardest to keep legible, and the worst on a phone or with ten Managers.",
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const parts = [];
let css = "";
for (const [i, v] of VARIANTS.entries()) {
  await page.goto(`http://localhost:5390/prototype-team.html?variant=${v.key}`, {
    waitUntil: "networkidle",
  });
  await page.evaluate(() => document.fonts.ready);
  let html = await page.evaluate(() => document.querySelector(".pt-stage").outerHTML);
  // Note that each face names its mask by a React id, so every variant's ids are made its own.
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  for (const id of new Set(ids)) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    html = html.replace(new RegExp(`(id="|#)${safe}(["\\)])`, "g"), `$1v${i}-${id}$2`);
  }
  parts.push({ ...v, html });
  if (css === "") {
    css = await page.evaluate(async () => {
      const toData = async (url) => {
        const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
        let s = "";
        for (const b of bytes) s += String.fromCharCode(b);
        return `data:font/woff2;base64,${btoa(s)}`;
      };
      const out = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSFontFaceRule) {
            const src = rule.style.getPropertyValue("src");
            if (!/latin-wght-normal/.test(src)) continue;
            const url = src.match(/url\("?([^")]+)"?\)/)[1];
            out.push(
              rule.cssText.replace(
                /url\("?[^")]+"?\)/,
                `url("${await toData(new URL(url, location.href).href)}")`,
              ),
            );
          } else out.push(rule.cssText);
        }
      }
      return out.join("\n");
    });
  }
}
await browser.close();

const tabs = parts
  .map(
    (p, i) =>
      `<input type="radio" name="v" id="t${i}" ${i === 0 ? "checked" : ""}><label for="t${i}"><b>${p.name}</b><span>${p.kind}</span></label>`,
  )
  .join("");
const panes = parts
  .map(
    (p, i) =>
      `<section class="pane" data-pane="${i}"><p class="note"><b>${p.name}.</b> ${p.note}</p><div class="frame"><div class="fit" data-ui-profile="web" data-ui-theme="light">${p.html}</div></div></section>`,
  )
  .join("");
const rules = parts
  .map((_, i) => `#t${i}:checked ~ .panes [data-pane="${i}"]{display:block}`)
  .join("");

const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Managers as a team: 7 prototypes</title>
<style>${css}</style>
<style>
html, body { background: none !important; color: var(--app-foreground); font-family: var(--app-font-sans, system-ui, sans-serif); margin: 0; min-height: 0 !important; }
.fit { font-family: var(--ui-font-sans); font-size: var(--ui-type-body-size); line-height: var(--ui-type-body-leading); color: var(--ui-color-text); -webkit-font-smoothing: antialiased; }
.panes { min-width: 0; width: 100%; }
.frame { max-width: 100%; min-width: 0; }
.intro { margin: 0 0 12px; color: var(--app-muted-foreground); font-size: var(--app-text-size); line-height: var(--app-text-leading); }
.intro b { color: var(--app-foreground); }
.picker { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.picker input { position: absolute; opacity: 0; pointer-events: none; }
.picker label { font-family: var(--app-font-sans, system-ui, sans-serif); display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; min-height: 44px; border: 1px solid var(--app-border); border-radius: var(--app-radius); cursor: pointer; background: var(--app-surface); }
.picker label b { font-size: 14px; color: var(--app-foreground); }
.picker label span { font-size: 12px; color: var(--app-muted-foreground); }
.picker input:checked + label { border-color: var(--app-accent); box-shadow: inset 0 0 0 1px var(--app-accent); }
.picker input:focus-visible + label { outline: 2px solid var(--app-accent); outline-offset: 2px; }
.themes { display: flex; gap: 8px; align-items: center; margin: 0 0 12px; font-size: 13px; color: var(--app-muted-foreground); }
.panes .pane { display: none; }
${rules}
.note { margin: 0 0 10px; font-size: var(--app-text-size); line-height: var(--app-text-leading); color: var(--app-foreground); }
.frame { border: 1px solid var(--app-border); border-radius: var(--app-radius); overflow: hidden; }
.fit { width: 1440px; transform-origin: 0 0; }
</style></head>
<body class="page-wide">
<p class="intro"><b>Seven static views of your Managers as a team</b>, on the same fixture data (5 Managers, 14 agents, 4 asks, 4 handoffs), drawn with the real <code>@repo/ui</code> components, ManagerFace, and tokens. Each one should show at a glance who is busy, what each is on, and what needs you. Pick one to view it.</p>
<div class="themes">Vespin theme:
  <select id="theme"><option value="light">Light</option><option value="dark">Dark</option></select></div>
<div class="picker">${tabs}<div class="panes" style="flex-basis:100%">${panes}</div></div>
<script>
const fits = [...document.querySelectorAll('.fit')];
function size() {
  for (const fit of fits) {
    const frame = fit.parentElement;
    const w = frame.clientWidth || frame.parentElement.clientWidth || 1440;
    const k = Math.min(1, w / 1440);
    fit.style.transform = 'scale(' + k + ')';
    frame.style.height = (fit.offsetHeight * k) + 'px';
  }
}
const pick = document.getElementById('theme');
const dark = (getComputedStyle(document.documentElement).colorScheme || '').includes('dark') || matchMedia('(prefers-color-scheme: dark)').matches;
pick.value = dark ? 'dark' : 'light';
const apply = () => { for (const fit of fits) fit.setAttribute('data-ui-theme', pick.value); size(); };
pick.addEventListener('change', apply);
document.querySelectorAll('.picker input').forEach((r) => r.addEventListener('change', () => requestAnimationFrame(size)));
addEventListener('resize', size);
document.fonts.ready.then(size);
apply();
</script>
</body></html>`;
writeFileSync("/tmp/pt/team-views.html", doc);
console.log("bytes", doc.length);
