import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { PUSH_ENVIRONMENT } from "@repo/features/push-device-wire";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  deletePushDeviceToken,
  listPushDevices,
  registerPushDevice,
  unregisterPushDevice,
} from "../push-device-store.js";

/**
 * An account's phones, over a real dialect: a token on its gateway is one
 * row, a register the account repeats only stamps it seen, one by another
 * account moves it there, the same token on the other gateway is another
 * phone, one account neither reads nor unregisters another's phone, and a
 * token Apple says is gone is deleted whichever account holds it. Synthetic
 * accounts and tokens throughout.
 */

const BUNDLE_ID = "dev.vespin.ios";

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }
  return { owner, other };
});

/** A device token as Apple spells one: 32 bytes in lower-case hex, synthetic. */
const token = () => randomUUID().replaceAll("-", "").repeat(2);

it.layer(getTestDB())("the push device store", (it) => {
  it.effect(
    "a token is one row per gateway: registered again it is stamped seen, by another account it moves, and on the other gateway it is another phone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const phone = {
          token: token(),
          environment: PUSH_ENVIRONMENT.PRODUCTION,
          bundleId: BUNDLE_ID,
        };
        const registeredAt = yield* Clock.currentTimeMillis;

        yield* registerPushDevice(owner, phone);
        yield* TestClock.adjust("1 hour");
        yield* registerPushDevice(owner, phone);
        const [standing] = yield* listPushDevices(owner);
        assert.ok(standing);
        assert.equal(standing.token, phone.token);
        assert.equal(standing.createdAt.getTime(), registeredAt);
        assert.equal(standing.lastSeenAt.getTime(), registeredAt + 60 * 60_000);
        assert.equal((yield* listPushDevices(owner)).length, 1);

        yield* registerPushDevice(other, phone);
        assert.deepEqual(yield* listPushDevices(owner), []);
        assert.deepEqual(
          (yield* listPushDevices(other)).map((row) => [row.id, row.userId]),
          [[standing.id, other]],
        );

        yield* registerPushDevice(owner, { ...phone, environment: PUSH_ENVIRONMENT.SANDBOX });
        assert.deepEqual(
          (yield* listPushDevices(owner)).map((row) => row.environment),
          [PUSH_ENVIRONMENT.SANDBOX],
        );
        assert.equal((yield* listPushDevices(other)).length, 1);
      }),
  );

  it.effect(
    "one account neither reads nor unregisters another's phone, and a token Apple says is gone goes whoever holds it",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const phone = {
          token: token(),
          environment: PUSH_ENVIRONMENT.SANDBOX,
          bundleId: BUNDLE_ID,
        };
        yield* registerPushDevice(owner, phone);

        assert.deepEqual(yield* listPushDevices(other), []);
        assert.equal(yield* unregisterPushDevice(other, phone), false);
        assert.equal((yield* listPushDevices(owner)).length, 1);

        assert.equal(yield* unregisterPushDevice(owner, phone), true);
        assert.equal(yield* unregisterPushDevice(owner, phone), false);
        assert.deepEqual(yield* listPushDevices(owner), []);

        yield* registerPushDevice(owner, phone);
        assert.equal(yield* deletePushDeviceToken(phone), true);
        assert.equal(yield* deletePushDeviceToken(phone), false);
        assert.deepEqual(yield* listPushDevices(owner), []);
      }),
  );
});
