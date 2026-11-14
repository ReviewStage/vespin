// kept-bench.ts -- MEASUREMENT ONLY, never merged: with `-keptBench true`, times what opening a kept Inbox of each size costs on Hermes (JSON parse and the store's Schema decode) and what keeping one costs (the cut's per-item stringify and the file's stringify), on the large fixture's threads.
// @ts-nocheck

import { initialAppState } from "@repo/host/client";
import { inboxAppState } from "@repo/host/fixture-inbox";
import { inboxItemSchema } from "@repo/features/inbox-wire";
import { Schema } from "effect";
import { Settings } from "react-native";

function line(text: string): void {
  console.error(`[kept-bench] ${text}`);
}

function timed(run: () => unknown, times = 3): number {
  run();
  const started = performance.now();
  for (let n = 0; n < times; n += 1) run();
  return Math.round((performance.now() - started) / times);
}

function bench(): void {
  const state = inboxAppState(
    initialAppState(
      { launch: { profile: "inbox-large" }, runMode: "x", packaged: true, platform: "ios", appVersion: "0" },
      false,
      [],
    ),
    [],
  );
  const byTask = state.inboxItems.rows.task;
  const one = Object.entries(byTask).flatMap(([taskId, list]) => list.map((item) => ({ item, taskId })));
  // Note that the fixture's threads are about 1.6 KB each, so they repeat, with fresh ids, to reach a real account's 4.8 MB.
  const all = Array.from({ length: 5 }, (_, round) =>
    one.map((each) => ({ ...each, item: { ...each.item, id: `${each.item.id}-${round}` } })),
  ).flat();
  const decode = Schema.decodeUnknownSync(
    Schema.Struct({
      items: Schema.Array(Schema.Struct({ item: inboxItemSchema, taskId: Schema.String })),
      at: Schema.optionalKey(Schema.String),
    }),
  );
  for (const megabytes of [0.15, 0.5, 1, 2, 4.8]) {
    const items = [];
    let characters = 0;
    for (const each of all) {
      characters += JSON.stringify(each).length;
      if (characters > megabytes * 1_000_000) break;
      items.push(each);
    }
    const kept = { items, at: "x" };
    const text = JSON.stringify(kept);
    line(
      `${(text.length / 1e6).toFixed(2)} MB ${items.length} items: parse ${timed(() => JSON.parse(text))} ms, decode ${timed(() => decode(JSON.parse(text)))} ms (with parse), stringify ${timed(() => JSON.stringify(kept))} ms, cut ${timed(() => { let c = 0; for (const each of items) c += JSON.stringify(each).length; return c; })} ms`,
    );
  }
  line("DONE");
}

if (Settings.get("keptBench") === "true" || Settings.get("keptBench") === true) {
  setTimeout(() => {
    try {
      bench();
    } catch (error) {
      line(`FAIL ${String(error)}`);
    }
  }, 4000);
}
