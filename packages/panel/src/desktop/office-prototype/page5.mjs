import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "/usr/local/lib/node_modules/playwright/index.mjs";

const names = [
  "hilltop-light",
  "hilltop-dark",
  "hilltop-phone",
  "hilltop-phone-dark",
  "board-light",
  "board-dark",
  "board-phone",
  "board-phone-dark",
  "standup-light",
  "standup-dark",
  "standup-phone",
  "standup-phone-dark",
];
const b = await chromium.launch();
const p = await b.newPage();
await p.setContent("<html><body></body></html>");
const out = {};
for (const n of names) {
  const b64 = readFileSync(`/tmp/shared/ref-${n}.png`).toString("base64");
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
    key: "hilltop",
    name: "Hilltop (after Basecamp)",
    note: "One small hill per goal. Uphill is still being figured out, downhill is being made. The Manager's face sits where its goal stands now, and a hollow dot marks where it stood when you last looked, so movement is the distance between them and a face that hasn't moved is a raised hand. Each card has one line: what's new, then what's next or what waits on you. The hill's two ends are labeled, so there's no legend.",
  },
  {
    key: "board",
    name: "Departures board (after airport FIDS)",
    note: "One row per goal, read left to right like a flight: the goal, what moved since you looked, when it last moved, what's next, and a single status word in one color: Moving, Your turn, or Quiet. It's sorted by the latest move, so the busiest goals rise. On a phone each row folds into a list row with the status word at its end.",
  },
  {
    key: "standup",
    name: "Standup channel (after Geekbot, with Linear's updates)",
    note: "A #standup channel where each Manager posts its two answers when you come back, written as a real channel message: the goal, then Done since you looked and Next, or Blocked on you in orange. Everyone already knows how to read a standup bot in Slack.",
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
const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>After the references</title><style>
body{margin:0;font-family:var(--app-font-sans,system-ui,sans-serif);color:var(--app-foreground);font-size:var(--app-text-size,14px);line-height:var(--app-text-leading,1.5)}
.research{margin:0 0 20px}.research h2{font-size:16px;margin:0 0 6px}.research ol{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px}.research a{color:var(--app-accent,#2563eb)}.intro{margin:0 0 12px;color:var(--app-muted-foreground)} .intro b{color:var(--app-foreground)}
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
<p class="intro"><b>Round 5: research first.</b> Five references that show a team’s or a fleet’s progress at a glance, then three directions, each adapted from one of them to our Managers. They use this week’s real work on main and run in the real app in fixture mode, built from real components (DataTable, ListRow, ChannelMessage, Card, CardPress, and ManagerFace).</p><section class="research"><h2>What others do</h2>
<ol>
<li><b>Basecamp Hill Charts and Hilltop View.</b> Each piece of work is a dot on a hill: the left side is figuring it out, the right side is making it happen. You read where things are, not task counts, and comparing snapshots shows what's in motion and what's stuck: "a dot that doesn't move is effectively a raised hand." Hilltop View puts every project's hill on one page. <a href="https://basecamp.com/shapeup/3.4-chapter-12">Shape Up, chapter 12</a> · <a href="https://updates.37signals.com/post/new-in-basecamp-hilltop-view">Hilltop View</a></li>
<li><b>Linear project updates.</b> The project lead writes a short update with one health word (On track, At risk, Off track), and Linear attaches what changed since the last update, such as milestones and date changes. Updates arrive in Slack or the Inbox on a cadence. It reads at a glance because there's one word of health, then prose. <a href="https://linear.app/docs/initiative-and-project-updates">Linear docs</a></li>
<li><b>Geekbot async standups.</b> Each person answers "What have you done since {last report}?" and "Anything blocking?", and the answers are posted to a Slack channel. Everyone already knows the shape: two or three answers per person, top to bottom. <a href="https://geekbot.com/templates/daily-standup/">Geekbot template</a></li>
<li><b>Airport flight information boards.</b> One row per flight, the same columns in the same order, and a single status word (Boarding, Delayed, Landed) that strangers read in seconds with no training. <a href="https://en.wikipedia.org/wiki/Flight_information_display_system">Flight information display system</a></li>
<li><b>Agent fleet views (Devin's Agent Command Center, Cursor's Agents window).</b> These group sessions by status (running, needs you, finished) in a board or list. They show presence and state, not progress toward a goal, which is the trap our earlier rounds fell into, so I used them as the counterexample. <a href="https://docs.devin.ai/desktop/agent-command-center">Devin docs</a> · <a href="https://cursor.com/docs/release-notes/cloud-agents">Cursor cloud agents</a></li>
</ol>
<p><b>What they share:</b> one fixed shape per item that you learn once; progress as a position or a sentence, not a count; and one word or one color for the state that needs you.</p></section>
${tabs}<div class="layouts">${sec}</div>
</body></html>`;
writeFileSync("/tmp/pt/ref-views.html", doc);
console.log(doc.length);
