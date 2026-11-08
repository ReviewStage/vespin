import assert from "node:assert/strict";
import { test } from "vitest";
import { ADMIN_TAB } from "../admin/routing.js";
import { ROUTED_PLACE } from "../places/routed-places.js";
import { SHELL_ROOM } from "../shell-room.js";
import { tasksControl } from "../testing/tasks-control.js";
import { mobileBarShown } from "./mobile-bar.js";

/**
 * mobile-bar.test.ts -- a phone's bar stands over the Inbox's list, and
 * gives the whole screen to an item chosen over it.
 */

const CHOSEN = { taskId: "task-1", itemId: "item-1" } as const;

test.each([
  { on: "the list", chosen: undefined, shown: true },
  { on: "an item", chosen: CHOSEN, shown: false },
])("the bar on $on stands: $shown", ({ chosen, shown }) => {
  assert.equal(
    mobileBarShown(SHELL_ROOM.NARROW, tasksControl(), {
      place: ROUTED_PLACE.INBOX,
      inbox: { open: true, chosen },
      automations: undefined,
      admin: { kind: ADMIN_TAB.DASHBOARD },
    }),
    shown,
  );
});
