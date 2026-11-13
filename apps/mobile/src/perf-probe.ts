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

function nameOf(fiber): string | undefined {
  const type = fiber.type;
  if (type == null || typeof type === "string") return undefined;
  if (typeof type === "function") return type.displayName || type.name || "anon";
  if (typeof type === "object") {
    const inner = type.render || type.type;
    return type.displayName || (inner && (inner.displayName || inner.name)) || "obj";
  }
  return undefined;
}

// Note that a fiber rendered this commit where it mounted or its props or state are new objects, the heuristic React DevTools uses.
function walk(root) {
  const counts = new Map<string, number>();
  let rendered = 0;
  let mounted = 0;
  let hostRendered = 0;
  let total = 0;
  const stack = [root.current];
  while (stack.length > 0) {
    const fiber = stack.pop();
    total += 1;
    const old = fiber.alternate;
    const did =
      old === null ||
      old.memoizedProps !== fiber.memoizedProps ||
      old.memoizedState !== fiber.memoizedState;
    // Note that a subtree React bailed out of keeps the same child objects, so it is skipped.
    const name = nameOf(fiber);
    if (did) {
      if (old === null) mounted += 1;
      if (name !== undefined) {
        rendered += 1;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      } else if (typeof fiber.type === "string") hostRendered += 1;
    }
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child && !(old !== null && old.child === fiber.child && !did))
      stack.push(fiber.child);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
  return { rendered, mounted, hostRendered, total, top };
}

let commitStart = 0;
const hook = {
  renderers: new Map(),
  supportsFiber: true,
  isDisabled: false,
  inject(renderer) {
    const id = this.renderers.size + 1;
    this.renderers.set(id, renderer);
    return id;
  },
  checkDCE() {},
  onScheduleFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  onCommitFiberRoot(_id, root) {
    commitStart = performance.now();
    const seen = walk(root);
    stamp("commit", { ...seen, walkMs: performance.now() - commitStart });
  },
};
globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

// The JS thread's stalls: a 16 ms tick that came late by more than 34 ms.
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const late = now - last - 16;
  if (late > 34) stamp("stall", { ms: Math.round(late), endP: now });
  last = now;
}, 16);

setInterval(flush, 1000);

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
