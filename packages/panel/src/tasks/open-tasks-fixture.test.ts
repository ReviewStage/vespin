/**
 * open-tasks-fixture.test.ts -- under the tasks-open profile a select opens the task it names and a close leaves it, as a signed-in window binds one.
 */

import assert from "node:assert/strict";
import { ACT_KIND } from "@repo/host/acts";
import { RUN_PROFILE } from "@repo/host/app-state";
import { afterEach, test } from "vitest";
import { stateWith } from "../testing/app-state.js";
import { fixtureActAnswer, fixtureAppState, fixtureTasksView } from "./tasks-fixture.js";

const RUN = { fixtureMode: true, profile: RUN_PROFILE.TASKS_OPEN } as const;

afterEach(() => {
  fixtureActAnswer(RUN, ACT_KIND.TASKS_CLOSE, undefined);
});

test("a select opens the task it names, and a close leaves it", () => {
  const listed = fixtureTasksView(RUN)?.tasks ?? [];
  const named = listed.find((task) => task.name === "Search ranking: redesign");

  assert.ok(named !== undefined, "the profile lists its tasks");
  assert.equal(fixtureTasksView(RUN)?.activeTaskId, undefined);
  assert.deepEqual(fixtureActAnswer(RUN, ACT_KIND.TASKS_SELECT, { taskId: named.id }), {
    answer: true,
  });
  assert.equal(fixtureTasksView(RUN)?.activeTaskId, named.id);
  fixtureActAnswer(RUN, ACT_KIND.TASKS_CLOSE, undefined);
  assert.equal(fixtureTasksView(RUN)?.activeTaskId, undefined);
});

test("a select stages main's document naming the task it opened, as main's delivery would, so the window draws it at once", () => {
  const main = { ...stateWith({}, {}), run: { ...stateWith({}, {}).run, ...RUN } };
  const named = fixtureTasksView(RUN)?.tasks.find((task) => task.name === "Audit log: redesign");

  assert.ok(named !== undefined, "the profile lists its tasks");
  const before = fixtureAppState(main);
  fixtureActAnswer(RUN, ACT_KIND.TASKS_SELECT, { taskId: named.id });
  const after = fixtureAppState(main);

  assert.equal(after.tasks.activeTaskId, named.id);
  assert.notEqual(after.tasks, before.tasks);
});
