/**
 * host-lock.test.ts -- the state root's lock as two daemons on one box meet it: a second finds it held while the first stands and takes it once the first is gone, and one left by a daemon that died never keeps the next from starting.
 *
 * Each daemon's lock is taken in a scope of its own, on the machine's own
 * file system and sockets in a temporary state root, the settle moved on by
 * the test's clock.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Duration, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import { reporterLayer } from "../effect/seams.js";
import { HOST_LOCK, hostLockTaken } from "./host-lock.js";

const services = Layer.mergeAll(
  NodeFileSystem.layer,
  NodePath.layer,
  reporterLayer(() => undefined),
);

/** The lock taken in the scope given, the clock moved on while it settles. */
const taken = (stateRoot: string, scope: Scope.Scope) =>
  Effect.gen(function* () {
    const taking = yield* Effect.forkChild(hostLockTaken(stateRoot).pipe(Scope.provide(scope)));
    yield* TestClock.adjust(Duration.millis(50)).pipe(
      Effect.andThen(Effect.yieldNow.pipe(Effect.repeat({ times: 200 }))),
      Effect.repeat({ until: () => taking.pollUnsafe() !== undefined, times: 200 }),
    );
    return yield* Fiber.join(taking);
  });

describe("hostLockTaken", () => {
  it.effect(
    "a second daemon finds the lock held while the first stands, and takes it once the first is gone",
    () =>
      Effect.gen(function* () {
        const stateRoot = yield* temporaryDirectoryScoped();
        const first = yield* Scope.make();
        expect(yield* taken(stateRoot, first)).toBe(HOST_LOCK.TAKEN);
        const second = yield* Scope.make();
        expect(yield* taken(stateRoot, second)).toBe(HOST_LOCK.HELD);
        yield* Scope.close(second, Exit.void);
        // The first still holds it once the second has gone.
        const third = yield* Scope.make();
        expect(yield* taken(stateRoot, third)).toBe(HOST_LOCK.HELD);
        yield* Scope.close(third, Exit.void);
        yield* Scope.close(first, Exit.void);
        const next = yield* Scope.make();
        expect(yield* taken(stateRoot, next)).toBe(HOST_LOCK.TAKEN);
        yield* Scope.close(next, Exit.void);
      }).pipe(Effect.provide(services)),
  );

  it.effect("a lock left by a daemon that died is taken", () =>
    Effect.gen(function* () {
      const stateRoot = yield* temporaryDirectoryScoped();
      // Note that a daemon killed outright leaves the lock's name behind, with nothing answering on it.
      writeFileSync(join(stateRoot, "daemon.lock"), "");
      const scope = yield* Scope.make();
      expect(yield* taken(stateRoot, scope)).toBe(HOST_LOCK.TAKEN);
      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.provide(services)),
  );
});
