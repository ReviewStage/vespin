import assert from "node:assert/strict";
import { test } from "vitest";
import { tapWithoutWords, transactionWithoutRouteKeys } from "./sentry-screens.js";

/**
 * sentry-screens.test.ts -- the iOS app's tap breadcrumbs and screen transactions as Sentry's React Native SDK makes them: no words on screen, no route keys.
 */

/** A thread's words, which its row sets as its accessibility label, so the SDK takes them for the tap's label. */
const THREAD_WORDS = "Ship the billing migration before Friday";

/** The path the SDK walks from a tapped Inbox row: the row's label on its first component. */
const TOUCHED_PATH = [
  { name: "ChannelThreadRow", label: THREAD_WORDS },
  { name: "RowList", file: "row-list.tsx" },
];

test.each([
  {
    kind: "a tap",
    breadcrumb: {
      category: "touch",
      type: "user",
      level: "info" as const,
      message: `Touch event within element: ${THREAD_WORDS}`,
      data: { path: TOUCHED_PATH },
    },
    message: "Touch event within element: ChannelThreadRow",
  },
  {
    kind: "a rage tap",
    breadcrumb: {
      category: "ui.multiClick",
      type: "default",
      message: THREAD_WORDS,
      data: {
        clickCount: 3,
        route: "/(tabs)/(inbox)/thread/[id]",
        node: { id: 0, tagName: "ChannelThreadRow", attributes: { "sentry-label": THREAD_WORDS } },
        path: TOUCHED_PATH,
      },
    },
    message: "ChannelThreadRow",
  },
])(
  "$kind's breadcrumb names the touched components and none of their words",
  ({ breadcrumb, message }) => {
    const kept = tapWithoutWords(breadcrumb);

    assert.equal(kept.message, message);
    assert.deepEqual(kept.data.path, [
      { name: "ChannelThreadRow" },
      { name: "RowList", file: "row-list.tsx" },
    ]);
    assert.equal(JSON.stringify(kept).includes(THREAD_WORDS), false);
  },
);

test("a screen change's transaction keeps its screens' routes and drops their keys", () => {
  const transaction = {
    type: "transaction" as const,
    transaction: "/(tabs)/(tasks)/agent/[id]",
    contexts: {
      trace: {
        op: "navigation",
        data: {
          "route.name": "/(tabs)/(tasks)/agent/[id]",
          "route.key": "agent/[id]-x8Fk2Lq0aZ",
          "previous_route.name": "/(tabs)/(tasks)",
          "previous_route.key": "(tasks)-Qm3vT9sPw1",
        },
      },
    },
    spans: [{ op: "ui.load.initial_display", data: { "route.key": "agent/[id]-x8Fk2Lq0aZ" } }],
  };

  assert.deepEqual(transactionWithoutRouteKeys(transaction), {
    type: "transaction",
    transaction: "/(tabs)/(tasks)/agent/[id]",
    contexts: {
      trace: {
        op: "navigation",
        data: {
          "route.name": "/(tabs)/(tasks)/agent/[id]",
          "previous_route.name": "/(tabs)/(tasks)",
        },
      },
    },
    spans: [{ op: "ui.load.initial_display", data: {} }],
  });
});
