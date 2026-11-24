import { expect, test } from "vitest";
import { GO_TO, goToShown } from "./search-go-to-model.js";

/**
 * search-go-to-model.test.ts -- Search's Go to lists every place the
 * account reaches before anything is typed, and a query narrows them to
 * those whose name holds it, so typing "queue" offers the Merge queue and
 * a place the account doesn't reach is never offered.
 */

const REACHED = [GO_TO.MERGE_QUEUE, GO_TO.AUTOMATIONS, GO_TO.SETTINGS];

test.each([
  { typed: "", shown: REACHED },
  { typed: "  QUEUE ", shown: [GO_TO.MERGE_QUEUE] },
  { typed: "t", shown: [GO_TO.AUTOMATIONS, GO_TO.SETTINGS] },
  { typed: "fix the sidebar", shown: [] },
])("typing $typed goes to $shown", ({ typed, shown }) => {
  expect(goToShown(REACHED, typed)).toEqual(shown);
});

test("a place the account doesn't reach is never offered", () => {
  expect(goToShown([GO_TO.SETTINGS], "merge")).toEqual([]);
});
