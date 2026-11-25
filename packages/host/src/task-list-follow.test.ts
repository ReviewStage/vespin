import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_POLL_URL } from "@repo/features/live-wire";
import { Effect, Fiber } from "effect";
import { followTaskList } from "./task-list-follow.js";
import { agentListRow, planListRow } from "./testing/task-list-rows.js";

/**
 * The task list followed over the service's held poll: an answer's row of
 * a shape this build does not read is left out by the list's reading, and
 * said, by its part and how many, rather than vanishing from the list.
 */

/** Every step the follow has to take, taken. */
const settled = Effect.repeat(Effect.yieldNow, { times: 20 });

/** A part of the list's read as the service answers it polled, its rows inline. */
function part(rows: readonly unknown[]) {
  return { capability: LIVE_POLL_URL, queryFingerprint: "fingerprint", expiresAt: 0, rows };
}

it.effect(
  "an answer's row of a shape this build does not read is told as dropped, by its part and how many, and the rest are taken",
  () =>
    Effect.gen(function* () {
      const task = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
      // A sandbox state the wire names no longer, as a service ahead of or behind this build may answer.
      const unread = { ...agentListRow(task, 2), id: "agent-2", sandboxState: "stopped" };
      const dropped: Array<readonly [string, number]> = [];
      const taken: number[] = [];

      const answer = {
        url: LIVE_POLL_URL,
        queries: {
          tasks: part([planListRow(task, "Task 1")]),
          agents: part([{ ...agentListRow(task, 1), id: "agent-1" }, unread]),
          issues: part([]),
        },
      };

      let polls = 0;

      const following = yield* Effect.forkChild(
        followTaskList({
          // Note that the service answers the list whole once, then holds the poll after it, as nothing moves.
          live: () => {
            polls += 1;

            return polls === 1 ? Effect.succeed(answer) : Effect.never;
          },
          take: (rows) =>
            Effect.sync(() => {
              taken.push(rows.agents.length);
            }),
          failed: () => undefined,
          behind: () => undefined,
          dropped: (name, count) => {
            dropped.push([name, count]);
          },
        }),
      );

      yield* settled;
      assert.deepEqual(dropped, [["agents", 1]]);
      assert.equal(taken[0], 1);
      yield* Fiber.interrupt(following);
    }),
);
