// @vitest-environment jsdom

/**
 * routed-exits.test.ts -- the window's routed memory is one per window: every caller of a route hook reads what another wrote.
 */

import assert from "node:assert/strict";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { type AutomationsRoute, useAutomationsRoute } from "../automations-route.js";
import { type InboxRoute, useInboxRoute } from "../inbox-route.js";
import { AUTOMATIONS_PAGE } from "../tasks/automations-place.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { settleQueries, withQueryClient } from "../testing/copy-feedback.js";
import { windowRouter } from "../testing/window-router.js";

const roots: Root[] = [];

beforeEach(() => fakeAppPlatform(QUIET_PANEL));

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

test("an Inbox item one caller holds and an automation it saw deleted are the window's, which another caller reads", async () => {
  const held = windowRouter();
  const callers: { inbox: InboxRoute; automations: AutomationsRoute }[] = [];

  function Caller({ at }: { readonly at: number }) {
    callers[at] = { inbox: useInboxRoute(), automations: useAutomationsRoute({ narrow: false }) };

    return null;
  }

  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() =>
    root.render(
      held.provide(
        withQueryClient(
          createElement(
            Fragment,
            null,
            createElement(Caller, { at: 0 }),
            createElement(Caller, { at: 1 }),
          ),
        ),
      ),
    ),
  );
  const [one, other] = callers;
  assert.ok(one !== undefined && other !== undefined);
  const chosen = { taskId: "t1", itemAgentId: "agent-1", itemId: "item-1", opened: true } as const;

  act(() => one.inbox.onHold(chosen));
  act(() => one.automations.onOpen({ kind: AUTOMATIONS_PAGE.LIST, deleted: "a1" }, "acme"));
  await settleQueries();

  assert.deepEqual(callers[1]?.inbox.choiceOf("item-1"), chosen);
  assert.equal(callers[1]?.automations.deletedNow("a1"), true);
});
