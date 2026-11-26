import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";

const names = [
  "desks-light",
  "desks-dark",
  "desks-3",
  "desks-10",
  "floor-light",
  "floor-dark",
  "floor-10",
  "rooms-light",
  "rooms-dark",
  "rooms-10",
  "phone-desks",
  "phone-floor",
  "phone-rooms",
];
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent("<html><body></body></html>");
const out = {};
for (const n of names) {
  const b64 = readFileSync(`/tmp/shared/office-${n}.png`).toString("base64");
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
    { b64, phone: n.startsWith("phone") },
  );
}
await b.close();
const LAYOUTS = [
  {
    key: "desks",
    name: "Desks",
    note: "Your desk (every ask) and the Meeting room (handoffs) as two cards across the top, then a two-column grid of desks, one card per Manager: its nameplate row (face, name, role, what it's on, status chip) over its agents in the Manager Overview's own rows, then the Standup board. Closest to today's Home and Manager Overview, and it scales by adding rows.",
  },
  {
    key: "floor",
    name: "Floor plan",
    note: "The same real cards on a light floor-plan backdrop: your office and the meeting room as walled rooms on the left, the open floor with a pod per Manager on the right (orange outline: waiting on you; dashed: working or idle), and the Standup board on the floor. It reads most like an office, but the side rooms truncate on narrow windows.",
  },
  {
    key: "rooms",
    name: "Rooms",
    note: "One column of Managers grouped by where they stand: At your door (waiting on you, each ask shown under its Manager), At their desks (working), and Away (idle). Your desk and the Meeting room sit in the page's side column. Most scannable, best on a phone, with the least 'office' flavor.",
  },
];
const VIEWS = [
  ["light", "Light · 5"],
  ["dark", "Dark · 5"],
  ["3", "3 Managers"],
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
  return `<section class="layout" data-l="${i}"><p class="note"><b>${l.name}.</b> ${l.note}</p><div class="row"><div class="desk"><div class="views">${views}</div></div><figure class="phone"><img alt="${l.name} at phone width" src="${out[`phone-${l.key}`]}"><figcaption>Phone</figcaption></figure></div></section>`;
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
const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>The Office, in the real app</title><style>
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
<p class="intro"><b>The Office, as a real page of Vespin</b>: the web app in fixture mode with its real sidebar and page header, plus an Office place. Everything on the page is a real component: DetailPage, Card, ListRow, TaskRows with real agent glyphs, Badge, the section frames, and ManagerFace. Every row would open its Manager's chat, ask, or agent. Pick a layout, then a theme or team size.</p>
${tabs}<div class="layouts">${sec}</div>
</body></html>`;
writeFileSync("/tmp/pt/office-views.html", doc);
console.log(doc.length);
