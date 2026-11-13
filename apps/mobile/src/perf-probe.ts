// perf-probe.ts -- MEASUREMENT ONLY, never merged: logs each native event's arrival in JS, each React commit with the components it rendered, and each JS-thread stall, to Documents/perf-probe-*.jsonl.
// @ts-nocheck

import { File, Paths } from "expo-file-system";

const pending: string[] = [];
let chunk = 0;
const session = Date.now();

function stamp(kind: string, data: Record<string, unknown>): void {
  pending.push(JSON.stringify({ t: Date.now(), p: performance.now(), kind, ...data }));
}

// Note that each flush writes only its own lines to a new file, so a flush never rewrites what was written.
function flush(): void {
  if (pending.length === 0) return;
  const lines = `${pending.splice(0, pending.length).join("\n")}\n`;
  chunk += 1;
  try {
    new File(Paths.document, `perf-probe-${session}-${String(chunk).padStart(5, "0")}.jsonl`).write(
      lines,
    );
  } catch (error) {
    pending.unshift(String(error));
  }
}

// Each commit the polyfill's hook saw (`scripts/perf/devtools-hook-polyfill.js`), moved into the log.
setInterval(() => {
  const commits = globalThis.__perfCommits;
  if (commits === undefined || commits.length === 0) return;
  for (const commit of commits.splice(0, commits.length)) pending.push(JSON.stringify(commit));
}, 500);

// The JS thread's stalls: a 16 ms tick that came late by more than 34 ms.
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const late = now - last - 16;
  if (late > 34) stamp("stall", { ms: Math.round(late), endP: now });
  last = now;
}, 16);

setInterval(flush, 1000);
stamp("probe-hook", { hooked: globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size ?? -1 });

// Native events as they reach JS, before React handles them; continuous ones are left out.
const NOISY =
  /layout|scroll|contentSizeChange|onSizeChanged|Measure|Gesture|pointerMove|touchMove/i;
try {
  const RawEventEmitter = require("react-native/Libraries/Core/RawEventEmitter").default;
  RawEventEmitter.addListener("*", (event) => {
    const name = event.eventName;
    if (NOISY.test(name)) return;
    const native = event.nativeEvent ?? {};
    stamp("event", {
      name,
      native: typeof native.timestamp === "number" ? native.timestamp : native.timeStamp,
    });
  });
} catch (error) {
  stamp("probe-error", { where: "events", error: String(error) });
}

stamp("probe-start", {});
