/**
 * host-keep-awake.test.ts -- a Mac's host holding the Mac awake by the choice its app handed it: `caffeinate -i` running while a runner runs and ended once none does, and the plugged-in choice holding it on a power adapter alone.
 *
 * The hold runs over a real state folder of its own, the choice written as
 * the app writes it, and a scripted `caffeinate` and `pmset`, on the test's
 * clock.
 */

import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { KEEP_AWAKE, type KeepAwake } from "@repo/settings";
import { Duration, Effect, Layer, SubscriptionRef } from "effect";
import { TestClock } from "effect/testing";
import { handKeepAwake } from "../keep-awake-record.js";
import { scriptedSpawner } from "../testing/scripted-spawner.js";
import { hostKeepAwake } from "./host-keep-awake.js";

const FILES = Layer.merge(NodeFileSystem.layer, NodePath.layer);

const POWER = {
  ADAPTER: "Now drawing from 'AC Power'\n -InternalBattery-0\t100%; charged\n",
  BATTERY: "Now drawing from 'Battery Power'\n -InternalBattery-0\t80%; discharging\n",
} as const;

/** The hold run over a state folder of its own, with the choice and power source given; whether `caffeinate` runs, the runners' switch, and the power source's change. */
const keptAwake = (choice: KeepAwake | undefined, power: string) =>
  Effect.gen(function* () {
    const stateRoot = yield* temporaryDirectoryScoped("keep-awake-");

    if (choice !== undefined) yield* handKeepAwake(stateRoot, choice);
    let drawing = power;

    const spawner = scriptedSpawner((program) =>
      program === "/usr/bin/pmset" ? { stdout: drawing, exitCode: 0 } : {},
    );

    const working = yield* SubscriptionRef.make(false);
    yield* Effect.forkScoped(
      hostKeepAwake({ stateRoot, working: SubscriptionRef.changes(working), pid: 4242 }).pipe(
        Effect.provide(spawner.layer),
      ),
    );

    const holding = () =>
      spawner.spawned.filter(
        (process) => process.program === "/usr/bin/caffeinate" && process.ended === "running",
      );

    const powered = (source: string) => {
      drawing = source;
    };

    return { holding, working, powered };
  });

/** The clock nudged, and the state folder's reads let land, for a while. */
const settled = Effect.gen(function* () {
  for (let round = 0; round < 30; round += 1) {
    yield* TestClock.adjust(Duration.millis(100));
    yield* Effect.yieldNow;
  }
});

/** The clock nudged, and the state folder's reads let land, until the condition holds. */
const until = (holds: () => boolean) =>
  Effect.gen(function* () {
    for (let round = 0; round < 20_000 && !holds(); round += 1) {
      yield* TestClock.adjust(Duration.millis(100));
      yield* Effect.yieldNow;
    }

    assert.ok(holds(), "the hold never got there");
  });

it.effect(
  "with no choice handed, the Mac is held awake while a runner runs, by a caffeinate that ends with the host, and let go once none does",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mac = yield* keptAwake(undefined, POWER.ADAPTER);
        yield* settled;
        assert.equal(mac.holding().length, 0, "nothing is held while no runner runs");

        yield* SubscriptionRef.set(mac.working, true);
        yield* until(() => mac.holding().length === 1);
        assert.deepEqual(
          mac.holding().map((process) => process.args),
          [["-i", "-w", "4242"]],
        );

        yield* SubscriptionRef.set(mac.working, false);
        yield* until(() => mac.holding().length === 0);
      }).pipe(Effect.provide(FILES)),
    ),
);

it.effect("never holds the Mac awake, even with a runner running", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mac = yield* keptAwake(KEEP_AWAKE.NEVER, POWER.ADAPTER);
      yield* SubscriptionRef.set(mac.working, true);
      yield* settled;
      assert.equal(mac.holding().length, 0);
    }).pipe(Effect.provide(FILES)),
  ),
);

it.effect(
  "while plugged in holds an idle Mac awake on its adapter, lets go on battery, and holds it again once plugged back in",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mac = yield* keptAwake(KEEP_AWAKE.PLUGGED_IN, POWER.ADAPTER);
        yield* until(() => mac.holding().length === 1);

        mac.powered(POWER.BATTERY);
        yield* until(() => mac.holding().length === 0);

        mac.powered(POWER.ADAPTER);
        yield* until(() => mac.holding().length === 1);
      }).pipe(Effect.provide(FILES)),
    ),
);
