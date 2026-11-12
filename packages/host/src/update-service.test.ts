import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { UPDATE_FAILURE, UPDATE_STATUS, type UpdateSnapshot } from "@repo/settings/update";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { type UpdaterEngine, type UpdaterEngineEvents, UpdateService } from "./update-service.js";

/**
 * The updater's states as electron-updater's events and the row's presses
 * move them, over an engine whose every answer the test hands it. Synthetic
 * versions throughout.
 */

/** A network failure in electron-updater's own words. */
const OFFLINE = "net::ERR_INTERNET_DISCONNECTED";

/** An engine whose checks stand until the test answers them, recording each quit it is asked for. */
const engineFixture = () => {
  const failChecks: Array<(error: Error) => void> = [];
  const quits: string[] = [];
  let heard: UpdaterEngineEvents | undefined;

  const engine: UpdaterEngine = {
    wire: (events) => {
      heard = events;
    },
    checkForUpdates: () =>
      new Promise<void>((_resolve, reject) => {
        failChecks.push(reject);
      }),
    quitAndInstall: () => {
      quits.push("quit and install");
    },
    clearCachedUpdate: async () => undefined,
  };

  const events = () => {
    assert.ok(heard, "the service wires the engine as it is made");

    return heard;
  };

  return {
    engine,
    events,
    quits,
    failEveryCheck: (error: Error) => {
      for (const fail of failChecks) fail(error);
    },
  };
};

const serviceFixture = () =>
  Effect.gen(function* () {
    const fixture = engineFixture();
    const told: UpdateSnapshot[] = [];

    const service = yield* UpdateService.make({
      currentVersion: "1.0.0",
      onChange: (update) => told.push(update),
      engine: fixture.engine,
      report: () => undefined,
    });

    return { ...fixture, service, told };
  });

/** Lets a rejected check's answer reach the service. */
const settled = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));

it.effect(
  "a pressed check that cannot reach the feed says so though a timed check lands beside it",
  () =>
    Effect.gen(function* () {
      const { service, failEveryCheck } = yield* serviceFixture();

      const pressed = service.check({ asked: true });
      const timed = service.check();
      failEveryCheck(new Error(OFFLINE));
      yield* Effect.promise(() => Promise.all([pressed, timed]));

      assert.deepEqual(service.snapshot(), {
        status: UPDATE_STATUS.IDLE,
        currentVersion: "1.0.0",
        installSupported: true,
        upToDate: false,
        unreachable: true,
      });
    }).pipe(Effect.scoped),
);

it.effect("a restart that never quit can be pressed again once its time has passed", () =>
  Effect.gen(function* () {
    const { service, events, quits } = yield* serviceFixture();
    events().onDownloaded("2.0.0");

    service.install();
    yield* TestClock.adjust(Duration.minutes(10));
    service.install();

    assert.deepEqual(quits, ["quit and install", "quit and install"]);
  }).pipe(Effect.scoped),
);

it.effect("a build whose signature Squirrel refuses is told as that failure", () =>
  Effect.gen(function* () {
    const { service, events, told } = yield* serviceFixture();
    events().onAvailable("2.0.0");
    // Squirrel.Mac's own words, as electron-updater hands them on.
    events().onError(
      "Code signature at URL file:///path/to/Update.app did not pass validation: code failed to satisfy specified code requirement(s)",
    );

    assert.equal(service.snapshot().status, UPDATE_STATUS.ERROR);
    assert.deepEqual(told.at(-1), {
      status: UPDATE_STATUS.ERROR,
      currentVersion: "1.0.0",
      installSupported: true,
      latestVersion: "2.0.0",
      failure: UPDATE_FAILURE.SIGNATURE,
    });
  }).pipe(Effect.scoped),
);

it.effect("an earlier restart's time passing never frees a later restart's press", () =>
  Effect.gen(function* () {
    const { service, events, quits } = yield* serviceFixture();
    events().onDownloaded("2.0.0");
    service.install();
    events().onError("Squirrel could not stage the update");
    events().onDownloaded("2.0.0");

    yield* TestClock.adjust(Duration.seconds(90));
    service.install();
    yield* TestClock.adjust(Duration.seconds(60));
    service.install();

    assert.deepEqual(quits, ["quit and install", "quit and install"]);
  }).pipe(Effect.scoped),
);

it.effect("a service stopped before it started never checks", () =>
  Effect.gen(function* () {
    const { service, told } = yield* serviceFixture();

    service.stop();
    service.start();
    yield* TestClock.adjust(Duration.millis(0));
    yield* settled;

    assert.deepEqual(told, []);
  }).pipe(Effect.scoped),
);

it.effect("a build in hand stays ready when the engine announces another", () =>
  Effect.gen(function* () {
    const { service, events } = yield* serviceFixture();
    events().onDownloaded("2.0.0");

    events().onAvailable("2.1.0");

    assert.deepEqual(service.snapshot(), {
      status: UPDATE_STATUS.READY,
      currentVersion: "1.0.0",
      installSupported: true,
      latestVersion: "2.0.0",
    });
  }).pipe(Effect.scoped),
);
