import assert from "node:assert/strict";
import { it } from "vitest";
import { slicedScheduler } from "./sliced-scheduler.js";

/** A JS thread a test drives: a clock it moves by hand, the current task's microtasks, and the tasks waiting after it. */
function thread() {
  let now = 0;
  let task = 0;
  const microtasks: (() => void)[] = [];
  const tasks: (() => void)[] = [];

  return {
    now: () => now,
    spend: (ms: number) => {
      now += ms;
    },
    task: () => task,
    seams: {
      now: () => now,
      microtask: (run: () => void) => {
        microtasks.push(run);
      },
      task: (run: () => void) => {
        tasks.push(run);

        return () => {};
      },
    },
    /** Runs the current task's microtasks to the end, then every task waiting, each with its own, counting each. */
    drain: () => {
      for (;;) {
        for (let run = microtasks.shift(); run !== undefined; run = microtasks.shift()) run();

        const next = tasks.shift();

        if (next === undefined) return;
        task += 1;
        next();
      }
    },
  };
}

it("a fiber's rounds stay in their task until a slice of it is spent, and a round asked after a pause starts in its own", () => {
  const js = thread();
  const dispatcher = slicedScheduler({ sliceMs: 50, ...js.seams }).makeDispatcher();
  const ranIn: number[] = [];

  // Each round takes 10 ms and asks the next, as a fiber's chunks of work do.
  const chunk = (left: number) => () => {
    ranIn.push(js.task());
    js.spend(10);

    if (left > 1) dispatcher.scheduleTask(chunk(left - 1), 0);
  };

  dispatcher.scheduleTask(chunk(12), 0);
  js.drain();
  assert.deepEqual(ranIn, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2]);

  // The thread sat idle, then a callback in a later task woke the fiber.
  js.spend(100);
  ranIn.length = 0;
  dispatcher.scheduleTask(chunk(1), 0);
  js.drain();
  assert.deepEqual(ranIn, [2]);
});
