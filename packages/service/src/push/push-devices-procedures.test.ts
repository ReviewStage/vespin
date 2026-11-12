import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { listPushDevices } from "@repo/database/models/push-device-store";
import { user } from "@repo/database/schemas/auth";
import { getTestDB } from "@repo/database/testing";
import { PUSH_ENVIRONMENT, PUSH_NOTIFY } from "@repo/features/push-device-wire";
import { HTTP_METHOD, type WireBoundaryInput } from "@repo/wire";
import { Clock, Effect, Layer, Option } from "effect";
import { SqlClient } from "effect/sql";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { pushDevicesProcedures } from "./push-devices-procedures.js";

/**
 * A phone registered for pushes through the account's procedures, over a
 * real dialect: a register lands the token under the bearer's account, in
 * lower case, and again under another account moves it there; an unregister
 * takes it out, and one of a token the account does not hold is done all the
 * same; a phone's standing is read and its "Notify me" set by its own
 * account alone, another's answered not found; and a token that is not
 * Apple's hex is refused. Synthetic accounts,
 * bearers, and tokens throughout.
 */

const ORIGIN = "https://app.test";
const REGISTER_PATH = "/api/account/push-devices";
const UNREGISTER_PATH = "/api/account/push-devices/unregister";
const STATUS_PATH = "/api/account/push-devices/status";
const NOTIFY_PATH = "/api/account/push-devices/notify";
const BUNDLE_ID = "dev.vespin.ios";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Two accounts, each behind its own bearer, and the resource answering one request. */
const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  const bearers = new Map([
    [`Bearer ${owner}`, owner],
    [`Bearer ${other}`, other],
  ]);

  const procedures = pushDevicesProcedures({
    resolveUserId: (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
      ),
  });

  const ask = (request: Request) => answer(procedures, request);

  return { owner, other, ask };
});

const answer = (procedures: ReturnType<typeof pushDevicesProcedures>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;

    // The procedures run on oRPC's own fiber, so they are handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
    );

    const response = yield* hostedAnswer({ pushDevices: procedures }, services, request);
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

/** A device token as Apple spells one, 32 bytes of hex, synthetic, in upper case to see it lowered. */
const token = () => randomUUID().replaceAll("-", "").repeat(2).toUpperCase();

const DONE: Answer = { status: HOSTED_HTTP_STATUS.OK, body: { done: true } };

it.layer(getTestDB())("the push devices route", (it) => {
  it.effect(
    "a register lands the phone under the bearer's account and moves it to another that registers it, and an unregister takes it out",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts;

        const phone = {
          token: token(),
          environment: PUSH_ENVIRONMENT.SANDBOX,
          bundleId: BUNDLE_ID,
        };

        const phonesOf = (userId: string) =>
          Effect.map(listPushDevices(userId), (rows) => rows.map((row) => row.token));

        assert.deepEqual(yield* ask(post(REGISTER_PATH, owner, phone)), DONE);
        assert.deepEqual(yield* ask(post(REGISTER_PATH, owner, phone)), DONE);
        assert.deepEqual(yield* phonesOf(owner), [phone.token.toLowerCase()]);

        assert.deepEqual(yield* ask(post(REGISTER_PATH, other, phone)), DONE);
        assert.deepEqual(yield* phonesOf(owner), []);
        assert.deepEqual(yield* phonesOf(other), [phone.token.toLowerCase()]);

        const leaving = { token: phone.token, environment: phone.environment };
        assert.deepEqual(yield* ask(post(UNREGISTER_PATH, owner, leaving)), DONE);
        assert.deepEqual(yield* phonesOf(other), [phone.token.toLowerCase()], "another's stands");
        assert.deepEqual(yield* ask(post(UNREGISTER_PATH, other, leaving)), DONE);
        assert.deepEqual(yield* phonesOf(other), []);
      }),
  );

  it.effect(
    "a phone's standing is read and its Notify me set by its own account alone, another's answered not found",
    () =>
      Effect.gen(function* () {
        const { owner, other, ask } = yield* openAccounts;

        const phone = {
          token: token(),
          environment: PUSH_ENVIRONMENT.PRODUCTION,
          bundleId: BUNDLE_ID,
        };

        assert.deepEqual(yield* ask(post(REGISTER_PATH, owner, phone)), DONE);
        const key = { token: phone.token, environment: phone.environment };

        const notFound: Answer = {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          body: { error: HOSTED_API_ERROR.NOT_FOUND },
        };

        const standing = (notify: string) => ({
          status: HOSTED_HTTP_STATUS.OK,
          body: { notify, lastDeliveredAt: null, failingSince: null, failureReason: null },
        });

        assert.deepEqual(yield* ask(post(STATUS_PATH, other, key)), notFound);
        assert.deepEqual(
          yield* ask(post(NOTIFY_PATH, other, { ...key, notify: PUSH_NOTIFY.NEVER })),
          notFound,
        );
        assert.deepEqual(yield* ask(post(STATUS_PATH, owner, key)), standing(PUSH_NOTIFY.AWAY));

        assert.deepEqual(
          yield* ask(post(NOTIFY_PATH, owner, { ...key, notify: PUSH_NOTIFY.ALWAYS })),
          DONE,
        );
        assert.deepEqual(yield* ask(post(STATUS_PATH, owner, key)), standing(PUSH_NOTIFY.ALWAYS));
      }),
  );

  it.effect("a token that is not Apple's hex is refused, and nothing is registered", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;

      const refused = yield* ask(
        post(REGISTER_PATH, owner, {
          token: "not-a-device-token-but-long-enough-to-pass-the-length",
          environment: PUSH_ENVIRONMENT.PRODUCTION,
          bundleId: BUNDLE_ID,
        }),
      );

      assert.deepEqual(refused, {
        status: HOSTED_HTTP_STATUS.BAD_REQUEST,
        body: { error: HOSTED_API_ERROR.INVALID_REQUEST },
      });
      assert.deepEqual(yield* listPushDevices(owner), []);
    }),
  );
});
