/**
 * host-runners-left.test.ts -- a daemon's start as the operating system sees it end the runners a daemon killed outright left running: a group still alive asked to end, then killed, and a group kept before the machine last booted never signaled, every record cleared either way.
 *
 * The records are kept as the follower keeps them, on the machine's own file
 * system in a temporary state root, and the signals are the operating
 * system's, answered by a spy on `process.kill` holding a group alive
 * through SIGTERM until SIGKILL ends it, as a runner whose harness ignores
 * SIGTERM is.
 */

import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Duration, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { reporterLayer } from "../effect/seams.js";
import { keepRunnerGroup, keptRunnerGroups } from "../local-agent-state.js";
import { hostRunnersLeftStopped } from "./host-runners-left.js";

const AGENT_ID = "0b6f9a4e-1c1d-4d2e-9f3a-5b7c8d9e0f12";

/** The process group the runner a daemon left running leads. */
const GROUP = 48_213;

const services = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  reporterLayer(() => undefined),
);

/** Each signal sent to a process group, with the group, and the group alive until SIGKILL reaches it. */
const signals = () => {
  const sent: [number, string | number | undefined][] = [];
  let alive = true;
  vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
    sent.push([pid, signal]);

    if (!alive) throw Object.assign(new Error("no such process"), { code: "ESRCH" });

    if (signal === "SIGKILL") alive = false;

    return true;
  });

  return sent;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hostRunnersLeftStopped", () => {
  it.effect(
    "a runner's group left alive is asked to end, then killed once its grace has passed, and its record cleared",
    () =>
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped();
        yield* TestClock.adjust(Duration.minutes(10));
        yield* keepRunnerGroup(stateRoot, AGENT_ID, GROUP);
        const sent = signals();

        const stopping = yield* Effect.forkChild(
          hostRunnersLeftStopped(stateRoot, Duration.toMillis(Duration.minutes(1))),
        );

        yield* TestClock.adjust(Duration.seconds(3)).pipe(
          Effect.andThen(Effect.yieldNow.pipe(Effect.repeat({ times: 200 }))),
          Effect.repeat({ until: () => stopping.pollUnsafe() !== undefined, times: 50 }),
        );
        yield* Fiber.join(stopping);
        expect(sent).toEqual([
          [-GROUP, 0],
          [-GROUP, "SIGTERM"],
          [-GROUP, 0],
          [-GROUP, "SIGKILL"],
        ]);
        expect(yield* keptRunnerGroups(stateRoot)).toEqual([]);
      }).pipe(Effect.provide(services)),
  );

  it.effect(
    "a runner's group kept before the machine last booted is never signaled, and its record cleared",
    () =>
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped();
        yield* keepRunnerGroup(stateRoot, AGENT_ID, GROUP);
        const sent = signals();
        yield* hostRunnersLeftStopped(stateRoot, Duration.toMillis(Duration.minutes(1)));
        expect(sent).toEqual([]);
        expect(yield* keptRunnerGroups(stateRoot)).toEqual([]);
      }).pipe(Effect.provide(services)),
  );
});
