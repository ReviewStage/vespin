import assert from "node:assert/strict";
import type { LinkDestination } from "@repo/features/link-grammar";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { it } from "vitest";
import { createPanelRouter } from "../panel-router.js";
import { ON_STANDING_TASK, type OnStandingTask, onTasksTab } from "./link-places.js";
import { ADDRESS, addressOf } from "./pressed-address.js";

/**
 * link-places.test.ts -- what a link pressed on the Tasks tab opens as it
 * goes there, by the declaration the link's place is, one row per place,
 * each matched on the window's route tree, standing under Acme. Synthetic
 * ids.
 */

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER = "5b7d9f1a-3c5e-4a7b-9d1f-2b4c6d8e0f1a";
const PAGE = "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b";
const CALL = "toolu_01";
const THREAD = "PRRT_kwDOA1";
const MESSAGE = "4a6c8e0b-2d4f-4b6d-8f0a-1c3e5a7b9d2c";
const APP = "https://vespin.dev/acme";

/** The window's router, standing on Acme's Inbox. */
const ROUTER = createPanelRouter(
  createMemoryHistory({ initialEntries: ["/acme/inbox"] }),
  new QueryClient(),
);

/** The place in the app a link names, matched on the route tree. */
function placeAt(href: string): LinkDestination {
  const address = addressOf(href, ROUTER);
  assert.equal(address.kind, ADDRESS.PLACE, href);
  assert.notEqual(address.routed, undefined, href);

  return address.routed?.link.place ?? address.link.place;
}

it.each<[string, string, string | undefined, OnStandingTask]>([
  [
    "the Tasks tab: a page of the task it shows, in the panel beside it",
    `${APP}/plan/${TASK}/page/${PAGE}`,
    TASK,
    ON_STANDING_TASK.BESIDE,
  ],
  [
    "the Tasks tab: another task's page, to that task",
    `${APP}/plan/${OTHER}/page/${PAGE}`,
    TASK,
    ON_STANDING_TASK.GO,
  ],
  [
    "the Tasks tab: the task it shows, its Overview",
    `${APP}/plan/${TASK}`,
    TASK,
    ON_STANDING_TASK.OVERVIEW,
  ],
  [
    "the Tasks tab: a section of the task it shows, its Overview at the section",
    `${APP}/plan/${TASK}#rollout`,
    TASK,
    ON_STANDING_TASK.OVERVIEW,
  ],
  [
    "the Tasks tab: a comment of the task it shows, its Overview at the comment",
    `${APP}/plan/${TASK}?comment=${MESSAGE}`,
    TASK,
    ON_STANDING_TASK.OVERVIEW,
  ],
  [
    "the Tasks tab: another task's section, to that task",
    `${APP}/plan/${OTHER}#rollout`,
    TASK,
    ON_STANDING_TASK.GO,
  ],
  [
    "the Tasks tab: a worker of the task it shows, in the panel beside it",
    `${APP}/plan/${TASK}/agent/${AGENT}/worker/${CALL}`,
    TASK,
    ON_STANDING_TASK.BESIDE,
  ],
  [
    "the Tasks tab: a review thread of the task it shows, its agent's Changes in the panel beside it",
    `${APP}/plan/${TASK}/agent/${AGENT}/changes/files/thread/${THREAD}`,
    TASK,
    ON_STANDING_TASK.BESIDE,
  ],
  [
    "the Tasks tab with something over the task's plan: the task's own Changes, to the task",
    `${APP}/plan/${TASK}/agent/${AGENT}/changes`,
    undefined,
    ON_STANDING_TASK.GO,
  ],
])("%s", (_, href, standing, expected) => {
  assert.equal(onTasksTab(placeAt(href), standing), expected);
});
