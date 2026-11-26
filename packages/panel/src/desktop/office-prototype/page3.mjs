import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";

const names = [
  "photo-light",
  "photo-dark",
  "photo-10",
  "photo-phone",
  "table-light",
  "table-dark",
  "table-phone",
  "sentences-light",
  "sentences-dark",
  "sentences-phone",
  "sentences-phone-dark",
  "presence-light",
  "presence-dark",
  "presence-phone",
  "spotlight-light",
  "spotlight-dark",
  "spotlight-phone",
  "spotlight-phone-dark",
];
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent("<html><body></body></html>");
const out = {};
for (const n of names) {
  const b64 = readFileSync(`/tmp/shared/calm-${n}.png`).toString("base64");
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
    key: "photo",
    name: "Team photo",
    note: "Everyone in one calm picture: the ones who need you stand in front, bigger, their line in the attention color; the rest stand behind with what they're doing. The title is the one answer.",
  },
  {
    key: "table",
    name: "Round table",
    note: "The team seated around one table, you at its head. Whoever needs you sits beside your seat and is the only one with words; everyone else is just a face and a name.",
  },
  {
    key: "sentences",
    name: "One sentence each",
    note: "No layout at all: the team reads like a status message, one sentence per Manager, the ones that need you first in the attention color.",
  },
  {
    key: "presence",
    name: "Presence strip",
    note: "Not a new page: a strip of faces on Home above the composer, a ring on the ones that need you, and one opened, as a click would, to its sentence and Answer.",
  },
  {
    key: "spotlight",
    name: "Spotlight",
    note: "Only the Managers who need you, big, each with one sentence and an Answer button; everyone else folds into a single quiet line. When nothing needs you, the page is that one line.",
  },
];
const VIEWS = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["10", "10 Managers"],
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
const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The Office, simple</title><style>
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
<p class="intro"><b>The Office, round 3: simple first.</b> Each Manager is a face, a name, and at most one plain sentence. The page title is the one answer to <i>does anything need me?</i> Everything is the real app in fixture mode, built from real components (DetailPage, Text, Button, CardPress, Avatar, and ManagerFace with a new portrait size). A face opens its Manager’s chat. Pick an idea, then a theme.</p>
${tabs}<div class="layouts">${sec}</div>
</body></html>`;
writeFileSync("/tmp/pt/calm-views.html", doc);
console.log(doc.length);
