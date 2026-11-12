import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { listLiveActivityPhones } from "@repo/database/models/live-activity-store";
import { registerPushDevice } from "@repo/database/models/push-device-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { PUSH_ENVIRONMENT } from "@repo/features/push-device-wire";
import { HTTP_METHOD, type WireBoundaryInput } from "@repo/wire";
import { Clock, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { liveActivitiesProcedures } from "./live-activities-procedures.js";

/**
 * A phone's Live Activity tokens registered through the account's
 * procedures, over a real dialect: a token lands on the bearer's own phone,
 * in lower case; one for a phone the account does not hold is answered not
 * found and lands nowhere; and an end forgets the account's own activity,
 * another account's end leaving it standing. Synthetic accounts, bearers,
 * and tokens throughout.
 */

const ORIGIN = "https://app.test";
const START_TOKEN_PATH = "/api/account/live-activities/start-token";
const ACTIVITY_TOKEN_PATH = "/api/account/live-activities/activity-token";
const ENDED_PATH = "/api/account/live-activities/ended";
const BUNDLE_ID = "dev.vespin.ios";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

const DONE: Answer = { status: HOSTED_HTTP_STATUS.OK, body: { done: true } };

/** A token as Apple spells one, 32 bytes of hex, synthetic, in upper case to see it lowered. */
const token = () => randomUUID().replaceAll("-", "").repeat(2).toUpperCase();

/** Two accounts, each behind its own bearer, the owner's phone registered, and the resource answering one request. */
const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  const phone = { deviceToken: token(), environment: PUSH_ENVIRONMENT.PRODUCTION };
  yield* registerPushDevice(owner, {
    token: phone.deviceToken.toLowerCase(),
    environment: phone.environment,
    bundleId: BUNDLE_ID,
  });

  const bearers = new Map([
    [`Bearer ${owner}`, owner],
    [`Bearer ${other}`, other],
  ]);

  const procedures = liveActivitiesProcedures({
    resolveUserId: (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
      ),
  });

  const ask = (path: string, userId: string, body: WireBoundaryInput) =>
    answer(procedures, post(path, userId, body));

  return { owner, other, phone, ask };
});

const answer = (procedures: ReturnType<typeof liveActivitiesProcedures>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;

    // The procedures run on oRPC's own fiber, so they are handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );

    const response = yield* hostedAnswer({ liveActivities: procedures }, services, request);
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
    const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;

    return { status: response.status, body } satisfies Answer;
  });

function post(path: string, userId: string, body: WireBoundaryInput) {
  return new Request(new URL(path, ORIGIN), {
    method: HTTP_METHOD.POST,
    headers: { "content-type": "application/json", authorization: `Bearer ${userId}` },
    body: JSON.stringify(body),
  });
}

it.layer(getTestDB())("the live activities route", (it) => {
  it.effect(
    "a token lands on the bearer's own phone in lower case, and one for another's phone is answered not found",
    () =>
      Effect.gen(function* () {
        const { owner, other, phone, ask } = yield* openAccounts;
        const [startToken, activityToken] = [token(), token()];

        assert.deepEqual(yield* ask(START_TOKEN_PATH, other, { ...phone, token: startToken }), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        });
        assert.deepEqual(yield* listLiveActivityPhones(owner), []);

        assert.deepEqual(
          yield* ask(START_TOKEN_PATH, owner, { ...phone, token: startToken }),
          DONE,
        );
        assert.deepEqual(
          yield* ask(ACTIVITY_TOKEN_PATH, owner, { ...phone, token: activityToken }),
          DONE,
        );
        const [standing] = yield* listLiveActivityPhones(owner);
        assert.equal(standing?.startToken, startToken.toLowerCase());
        assert.equal(standing?.activityToken, activityToken.toLowerCase());
        assert.deepEqual(yield* listLiveActivityPhones(other), []);
      }),
  );

  it.effect("an end forgets the bearer's own activity, and another's end leaves it standing", () =>
    Effect.gen(function* () {
      const { owner, other, phone, ask } = yield* openAccounts;
      const activityToken = token();
      yield* ask(ACTIVITY_TOKEN_PATH, owner, { ...phone, token: activityToken });

      assert.deepEqual(yield* ask(ENDED_PATH, other, phone), DONE);
      const [kept] = yield* listLiveActivityPhones(owner);
      assert.equal(kept?.activityToken, activityToken.toLowerCase());

      assert.deepEqual(yield* ask(ENDED_PATH, owner, phone), DONE);
      const [ended] = yield* listLiveActivityPhones(owner);
      assert.equal(ended?.activityToken, null);
      assert.equal(ended?.startedAt, null);
    }),
  );

  it.effect("an end that names the activity it ended leaves a newer one's token standing", () =>
    Effect.gen(function* () {
      const { owner, phone, ask } = yield* openAccounts;
      const [older, newer] = [token(), token()];
      yield* ask(ACTIVITY_TOKEN_PATH, owner, { ...phone, token: older });
      yield* ask(ACTIVITY_TOKEN_PATH, owner, { ...phone, token: newer });

      assert.deepEqual(yield* ask(ENDED_PATH, owner, { ...phone, activityToken: older }), DONE);
      const [kept] = yield* listLiveActivityPhones(owner);
      assert.equal(kept?.activityToken, newer.toLowerCase());

      assert.deepEqual(yield* ask(ENDED_PATH, owner, { ...phone, activityToken: newer }), DONE);
      const [ended] = yield* listLiveActivityPhones(owner);
      assert.equal(ended?.activityToken, null);
    }),
  );
});
