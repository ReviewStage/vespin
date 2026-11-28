import { expect, test } from "vitest";
import { shareSections, shareToLabel } from "./ios-share-page-model.js";
import { SHARE_DESTINATION_KIND, type ShareDestination } from "./ios-share-wire.js";
import { TASK_STATUS } from "./task-wire.js";

/**
 * ios-share-page-model.test.ts -- the share page lists the newest of every
 * kind under Recent and each kind's rest under its heading, never one twice;
 * a search drops Recent and narrows every kind by its rows' words; and the
 * "To" capsule names one place, or counts several. Synthetic rows.
 */

/** A task row last changed at `at`. */
function task(id: string, at: number, name = `Task ${id}`): ShareDestination {
  return { kind: SHARE_DESTINATION_KIND.TASK, id, name, status: TASK_STATUS.TODO, at };
}

/** A Manager last moved at `at`. */
function manager(id: string, at: number): ShareDestination {
  return { kind: SHARE_DESTINATION_KIND.MANAGER, id, name: `Manager ${id}`, at };
}

/** An agent on `taskName`, last moved at `at`. */
function agent(id: string, at: number, taskName: string): ShareDestination {
  return { kind: SHARE_DESTINATION_KIND.AGENT, id, name: `Agent ${id}`, task: taskName, at };
}

const ROWS = [
  task("t1", 1),
  task("t2", 20),
  manager("m1", 30),
  manager("m2", 2),
  agent("a1", 10, "Refresh fix"),
  agent("a2", 3, "Inbox widget"),
  task("t3", 4),
];

test("Recent holds the newest of every kind and each kind's rest stands under its heading", () => {
  const { recent, kinds } = shareSections(ROWS, "");

  expect(recent.map((row) => row.id)).toEqual(["m1", "t2", "a1", "t3", "a2"]);
  expect(kinds.map((section) => [section.kind, section.rows.map((row) => row.id)])).toEqual([
    [SHARE_DESTINATION_KIND.MANAGER, ["m2"]],
    [SHARE_DESTINATION_KIND.TASK, ["t1"]],
  ]);
});

test("a search drops Recent and keeps the rows that say every word, an agent's task among them", () => {
  const { recent, kinds } = shareSections(ROWS, "refresh AGENT");

  expect(recent).toEqual([]);
  expect(kinds.map((section) => section.rows.map((row) => row.id))).toEqual([["a1"]]);
});

test("the To capsule names one place, counts several, and says nothing of none", () => {
  expect(shareToLabel(["iOS engineer"])).toBe("iOS engineer");
  expect(shareToLabel(["iOS engineer", "Growth", "Refresh fix"])).toBe("3 places");
  expect(shareToLabel([])).toBeUndefined();
});
