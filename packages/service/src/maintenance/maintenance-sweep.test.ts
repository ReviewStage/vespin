import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { noDatabase } from "@repo/database/testing/no-database";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect, Exit, Layer, Redacted } from "effect";
import { HOSTED_API_ERROR } from "../http/http.js";
import { MAINTENANCE_SWEEP_PATH } from "./maintenance-bounds.js";
import {
  handleMaintenanceSweep,
  type MaintenanceSweepOptions,
  SWEEP_FAILED,
} from "./maintenance-sweep.js";

const CRON_SECRET = Redacted.make("cron-secret-1");

/** The scheduler's call; `null` sends no bearer at all. */
function sweepRequest(
  authorization: string | null = `Bearer ${Redacted.value(CRON_SECRET)}`,
  method = "GET",
): Request {
  return new Request(`https://app.test${MAINTENANCE_SWEEP_PATH}`, {
    method,
    headers: authorization === null ? {} : { authorization },
  });
}

/** The instant each sweep was handed, recorded for the test to read back. */
interface Recorded {
  syncLog: number[];
  turns: number[];
  republished: number[];
  keptUp: number[];
  resumed: number[];
  heldPushes: number[];
  liveActivities: number[];
  awayHosts: number[];
  sandboxReleases: number[];
}

function sweepOptions(overrides: Partial<MaintenanceSweepOptions> = {}) {
  const recorded: Recorded = {
    syncLog: [],
    turns: [],
    republished: [],
    keptUp: [],
    resumed: [],
    heldPushes: [],
    liveActivities: [],
    awayHosts: [],
    sandboxReleases: [],
  };

  const options: MaintenanceSweepOptions = {
    request: sweepRequest(),
    cronSecret: CRON_SECRET,
    monitor: { run: (sweep) => sweep },
    pruneSyncLog: (now) =>
      Effect.sync(() => {
        recorded.syncLog.push(now);

        return 5;
      }),
    reconcileAgents: (now) =>
      Effect.sync(() => {
        recorded.turns.push(now);

        return 0;
      }),
    republishTurns: (now) =>
      Effect.sync(() => {
        recorded.republished.push(now);

        return 0;
      }),
    keepSandboxesUp: (now) =>
      Effect.sync(() => {
        recorded.keptUp.push(now);

        return 0;
      }),
    resumeWaitedTurns: (now) =>
      Effect.sync(() => {
        recorded.resumed.push(now);

        return 0;
      }),
    releaseHeldPushes: (now) =>
      Effect.sync(() => {
        recorded.heldPushes.push(now);

        return 0;
      }),
    refreshLiveActivities: (now) =>
      Effect.sync(() => {
        recorded.liveActivities.push(now);

        return 0;
      }),
    markAwayHosts: (now) =>
      Effect.sync(() => {
        recorded.awayHosts.push(now);

        return 0;
      }),
    releaseSandboxes: (now) =>
      Effect.sync(() => {
        recorded.sandboxReleases.push(now);

        return { due: 0, published: 0 };
      }),
    ...overrides,
  };

  return { options, recorded };
}

/** The sweep over a client that refuses every statement — the fakes above stand in for every query. */
function sweep(options: MaintenanceSweepOptions) {
  return Effect.flatMap(
    Effect.provide(handleMaintenanceSweep(options), Layer.merge(noDatabase, memorySandbox().layer)),
    (response) =>
      Effect.promise(async () => ({ status: response.status, body: await response.json() })),
  );
}

it.effect("a deployment without CRON_SECRET answers unavailable and sweeps nothing", () =>
  Effect.gen(function* () {
    const { options, recorded } = sweepOptions({ cronSecret: undefined });
    const answer = yield* sweep(options);

    assert.equal(answer.status, 503);
    assert.equal(answer.body.error, HOSTED_API_ERROR.UNAVAILABLE);
    assert.deepEqual(recorded, {
      syncLog: [],
      turns: [],
      republished: [],
      keptUp: [],
      resumed: [],
      heldPushes: [],
      liveActivities: [],
      awayHosts: [],
      sandboxReleases: [],
    });
  }),
);

it.effect("a wrong or missing bearer is refused and sweeps nothing", () =>
  Effect.gen(function* () {
    const wrong = sweepOptions({ request: sweepRequest("Bearer other") });
    const wrongAnswer = yield* sweep(wrong.options);
    const missing = sweepOptions({ request: sweepRequest(null) });
    const missingAnswer = yield* sweep(missing.options);

    assert.equal(wrongAnswer.status, 401);
    assert.equal(wrongAnswer.body.error, HOSTED_API_ERROR.INVALID_TOKEN);
    assert.equal(missingAnswer.status, 401);
    assert.deepEqual(wrong.recorded, {
      syncLog: [],
      turns: [],
      republished: [],
      keptUp: [],
      resumed: [],
      heldPushes: [],
      liveActivities: [],
      awayHosts: [],
      sandboxReleases: [],
    });
    assert.deepEqual(missing.recorded, {
      syncLog: [],
      turns: [],
      republished: [],
      keptUp: [],
      resumed: [],
      heldPushes: [],
      liveActivities: [],
      awayHosts: [],
      sandboxReleases: [],
    });
  }),
);

it.effect(
  "an authorized sweep runs every sweep at one instant, the sync log among them, and answers what each did",
  () =>
    Effect.gen(function* () {
      const { options, recorded } = sweepOptions();
      const answer = yield* sweep(options);

      assert.equal(answer.status, 200);
      assert.equal(answer.body.syncLog, 5);
      const [instant] = recorded.syncLog;
      assert.ok(instant !== undefined);
      assert.deepEqual(recorded, {
        syncLog: [instant],
        turns: [instant],
        republished: [instant],
        keptUp: [instant],
        resumed: [instant],
        heldPushes: [instant],
        liveActivities: [instant],
        awayHosts: [instant],
        sandboxReleases: [instant],
      });
    }),
);

it.effect(
  "a sweep that fails, or dies, answers failed in its place, the sweeps after it still run, and the run's cron check-in fails",
  () =>
    Effect.gen(function* () {
      const checkIns: string[] = [];

      const { options, recorded } = sweepOptions({
        pruneSyncLog: () => Effect.fail(new Error("a sync log row could not be read")),
        reconcileAgents: (now) =>
          Effect.sync(() => recorded.turns.push(now)).pipe(
            Effect.andThen(Effect.die(new Error("a turn's row could not be read"))),
          ),
        // The cron monitor as Sentry's check-in reads the run: failed where its effect failed.
        monitor: {
          run: (run) =>
            run.pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => checkIns.push(Exit.isSuccess(exit) ? "ok" : "error")),
              ),
            ),
        },
      });

      const answer = yield* sweep(options);

      assert.equal(answer.status, 500);
      assert.deepEqual(checkIns, ["error"]);
      assert.deepEqual(answer.body.syncLog, SWEEP_FAILED);
      assert.deepEqual(answer.body.turns, SWEEP_FAILED);
      assert.equal(recorded.turns.length, 1);
    }),
);
