import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";

const names = [
  "rails-light",
  "rails-dark",
  "rails-phone",
  "rails-phone-dark",
  "letter-light",
  "letter-dark",
  "letter-phone",
  "letter-phone-dark",
  "river-light",
  "river-dark",
  "river-phone",
  "river-phone-dark",
];
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent("<html><body></body></html>");
const out = {};
for (const n of names) {
  const b64 = readFileSync(`/tmp/shared/progress-${n}.png`).toString("base64");
  out[n] = await p.evaluate(
    async ({ b64, phone }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const w = phone ? 390 : 1100;
      const k = w / img.width;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = Math.round(img.height * k);
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/webp", 0.72);
    },
    { b64, phone: n.includes("phone") },
  );
}
await b.close();
const LAYOUTS = [
  {
    key: "rails",
    name: "Progress rails",
    note: "A rail per goal, filling as its steps land: the part done before you looked is gray, what landed since is blue. Under it, one line: what's new, then what's next or what waits on you. You read how far each goal is and what just moved without learning anything.",
  },
  {
    key: "letter",
    name: "While you were away",
    note: "A short letter that catches you up: one paragraph per Manager that moved, with the new bits in bold, what waits on you gathered into one tinted paragraph at the end, and the quiet ones named in a single line. It reads like a person telling you, not like a dashboard.",
  },
  {
    key: "river",
    name: "Timeline river",
    note: "The day as a river: a lane per goal flowing left to right, a line at the moment you last looked, and everything right of it shaded as new, each new step named. It shows when things moved and how busy the day was, but on a phone the steps lose their names.",
  },
];
const VIEWS = [
  ["light", "Light"],
  ["dark", "Dark"],
];
const sec = LAYOUTS.map((l, i) => {
  const have = VIEWS.map(([v, label], j) => ({ v, label, j, n: out[`${l.key}-${v}`] })).filter(
    (x) => x.n,
  );
  const views =
    have
      .map(
        ({ label, j }) =>
          `<input type="radio" name="v${i}" id="v${i}-${j}" ${j === 0 ? "checked" : ""}><label for="v${i}-${j}">${label}</label>`,
      )
      .join("") +
    have
      .map(
        ({ label, j, n }) =>
          `<figure data-v="${j}"><img alt="${l.name}, ${label}, in the real Vespin window" src="${n}"></figure>`,
      )
      .join("");
  return `<section class="layout" data-l="${i}"><p class="note"><b>${l.name}.</b> ${l.note}</p><div class="row"><div class="desk"><div class="views">${views}</div></div><figure class="phone"><img alt="${l.name} at phone width" src="${out[`${l.key}-phone`]}"><figcaption>Phone</figcaption>${out[`${l.key}-phone-dark`] ? `<img alt="${l.name} at phone width, dark" src="${out[`${l.key}-phone-dark`]}" style="margin-top:8px"><figcaption>Phone, dark</figcaption>` : ""}</figure></div></section>`;
}).join("");
const tabs = LAYOUTS.map(
  (l, i) =>
    `<input type="radio" name="l" id="l${i}" ${i === 0 ? "checked" : ""}><label class="tab" for="l${i}">${l.name}</label>`,
).join("");
const rules = LAYOUTS.map(
  (_, i) =>
    `#l${i}:checked ~ .layouts [data-l="${i}"]{display:block}` +
    VIEWS.map((_, j) => `#v${i}-${j}:checked ~ figure[data-v="${j}"]{display:block}`).join(""),
).join("");
const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Today: what moved</title><style>
body{margin:0;font-family:var(--app-font-sans,system-ui,sans-serif);color:var(--app-foreground);font-size:var(--app-text-size,14px);line-height:var(--app-text-leading,1.5)}
.intro{margin:0 0 12px;color:var(--app-muted-foreground)} .intro b{color:var(--app-foreground)}
input{position:absolute;opacity:0;pointer-events:none}
label{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;margin:0 6px 8px 0;border:1px solid var(--app-border,#d4d4d4);border-radius:var(--app-radius,8px);background:var(--app-surface,transparent);cursor:pointer;font-weight:500}
label.tab{min-height:44px;font-size:15px}
input:checked+label{border-color:var(--app-accent,#2563eb);box-shadow:inset 0 0 0 1px var(--app-accent,#2563eb)}
input:focus-visible+label{outline:2px solid var(--app-accent);outline-offset:2px}
.layout{display:none}.views figure{display:none}
${rules}
.note{margin:4px 0 12px}
.row{display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
.desk{flex:1 1 560px;min-width:0}
figure{margin:0} img{display:block;max-width:100%;height:auto;border:1px solid var(--app-border);border-radius:var(--app-radius,8px)}
.phone{flex:0 0 220px} .phone img{width:220px} figcaption{color:var(--app-muted-foreground);font-size:12px;margin-top:4px}
@media (max-width:640px){.phone{flex-basis:100%}.phone img{width:100%;max-width:390px}}
</style></head><body class="page-wide">
<p class="intro"><b>Round 4: progress, not presence.</b> Opening Vespin answers three things for each Manager: the goal it is working toward, what moved since you last looked, and what is next or waiting on you. The data is the week’s real work on main (animations removal, Manager chat, iOS pull requests, Blob, density, GIFs). Everything is the real app in fixture mode, built from real components (DetailPage, Text, Progress with a new “since” segment, CardPress, and ManagerFace); a row opens its Manager. Pick an idea, then a theme.</p>
${tabs}<div class="layouts">${sec}</div>
</body></html>`;
writeFileSync("/tmp/pt/progress-views.html", doc);
console.log(doc.length);
