import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { PUSH_ENVIRONMENT } from "@repo/features/push-device-wire";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  endLiveActivityOnPhone,
  forgetLiveActivityToken,
  LIVE_ACTIVITY_TOKEN,
  listLiveActivityMembers,
  listLiveActivityPhones,
  recordLiveActivityEnded,
  recordLiveActivityPushed,
  registerLiveActivityToken,
} from "../live-activity-store.js";
import { registerPushDevice } from "../push-device-store.js";

/**
 * The Live Activity of an account's phones, over a real dialect: a token
 * registers only for a phone the account holds, an update token stamps the
 * activity started and forgets the state last sent, one account neither
 * reads, registers, nor records another's activity whatever phone id it
 * names, a gone token or an end forgets what it names, and a phone that
 * moves to another account leaves its activity behind. Synthetic accounts
 * and tokens throughout.
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

/** A token as Apple spells one: 32 bytes in lower-case hex, synthetic. */
const token = () => randomUUID().replaceAll("-", "").repeat(2);

/** A phone registered under the account, by its device token and gateway. */
const phoneOf = (userId: string) =>
  Effect.gen(function* () {
    const phone = { token: token(), environment: PUSH_ENVIRONMENT.PRODUCTION };
    yield* registerPushDevice(userId, { ...phone, bundleId: BUNDLE_ID });
    return phone;
  });

it.layer(getTestDB())("the live activity store", (it) => {
  it.effect(
    "a token registers for the account's own phone alone, and an update token stamps the activity started with its state to send whole",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const phone = yield* phoneOf(owner);
        const [startToken, activityToken] = [token(), token()];

        assert.equal(
          yield* registerLiveActivityToken(other, phone, LIVE_ACTIVITY_TOKEN.START, startToken),
          false,
        );
        assert.deepEqual(yield* listLiveActivityPhones(owner), []);

        assert.equal(
          yield* registerLiveActivityToken(owner, phone, LIVE_ACTIVITY_TOKEN.START, startToken),
          true,
        );
        const [registered] = yield* listLiveActivityPhones(owner);
        assert.ok(registered);
        assert.equal(registered.startToken, startToken);
        assert.equal(registered.startedAt, null);

        yield* recordLiveActivityPushed(owner, registered.pushDeviceId, {
          sentState: "{}",
          started: true,
        });
        yield* registerLiveActivityToken(owner, phone, LIVE_ACTIVITY_TOKEN.ACTIVITY, activityToken);
        const [standing] = yield* listLiveActivityPhones(owner);
        assert.ok(standing?.startedAt);
        assert.equal(standing.startToken, startToken);
        assert.equal(standing.activityToken, activityToken);
        assert.equal(standing.sentState, null);
        assert.deepEqual(yield* listLiveActivityPhones(other), []);
      }),
  );

  it.effect("one account neither records nor forgets another's activity by its phone id", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const phone = yield* phoneOf(owner);
      yield* registerLiveActivityToken(owner, phone, LIVE_ACTIVITY_TOKEN.START, token());
      yield* registerLiveActivityToken(owner, phone, LIVE_ACTIVITY_TOKEN.ACTIVITY, token());
      const [before] = yield* listLiveActivityPhones(owner);
      assert.ok(before);

      yield* recordLiveActivityPushed(other, before.pushDeviceId, {
        sentState: "theirs",
        started: true,
      });
      yield* recordLiveActivityEnded(other, before.pushDeviceId);
      yield* forgetLiveActivityToken(other, before.pushDeviceId, LIVE_ACTIVITY_TOKEN.START);
      yield* endLiveActivityOnPhone(other, phone);

      assert.deepEqual(yield* listLiveActivityPhones(owner), [before]);
    }),
  );

  it.effect(
    "a gone push-to-start token is forgotten alone, an end forgets the activity, and the sweep reads the accounts with one standing",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const phone = yield* phoneOf(owner);
        yield* registerLiveActivityToken(owner, phone, LIVE_ACTIVITY_TOKEN.START, token());
        const activityToken = token();
        yield* registerLiveActivityToken(owner, phone, LIVE_ACTIVITY_TOKEN.ACTIVITY, activityToken);
        const [standing] = yield* listLiveActivityPhones(owner);
        assert.ok(standing);
        assert.ok((yield* listLiveActivityMembers(10_000)).includes(owner));

        yield* forgetLiveActivityToken(owner, standing.pushDeviceId, LIVE_ACTIVITY_TOKEN.START);
        const [noStart] = yield* listLiveActivityPhones(owner);
        assert.equal(noStart?.startToken, null);
        assert.equal(noStart?.activityToken, activityToken);

        yield* endLiveActivityOnPhone(owner, phone);
        const [ended] = yield* listLiveActivityPhones(owner);
        assert.equal(ended?.activityToken, null);
        assert.equal(ended?.startedAt, null);
        assert.ok(!(yield* listLiveActivityMembers(10_000)).includes(owner));
      }),
  );

  it.effect("a phone that moves to another account leaves its activity behind", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const phone = yield* phoneOf(owner);
      yield* registerLiveActivityToken(owner, phone, LIVE_ACTIVITY_TOKEN.ACTIVITY, token());

      yield* registerPushDevice(owner, { ...phone, bundleId: BUNDLE_ID });
      assert.equal((yield* listLiveActivityPhones(owner)).length, 1);

      yield* registerPushDevice(other, { ...phone, bundleId: BUNDLE_ID });
      assert.deepEqual(yield* listLiveActivityPhones(owner), []);
      assert.deepEqual(yield* listLiveActivityPhones(other), []);
    }),
  );
});
