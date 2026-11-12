import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CHATGPT_DEVICE_LOGIN } from "@repo/features/provider-key-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  beginChatGptDeviceLogin,
  dropChatGptDeviceLogin,
  settleChatGptDeviceLogin,
  withChatGptDeviceLoginLocked,
} from "../chatgpt-device-login-store.js";

/**
 * An account's pending ChatGPT device-code logins, over a real dialect: two
 * starts stand side by side under their own ids, a start clears the
 * account's lapsed logins, a settled login keeps its outcome and leaves its
 * codes, and one account neither reads, settles,
 * nor drops another's login. The sealed column is opaque text here, as the
 * store holds it. Synthetic accounts, ids, and seals throughout.
 */

const AT = new Date("2026-11-06T01:00:00Z");
const LAPSES = new Date("2026-11-06T01:15:00Z");
const LATER = new Date("2026-11-06T01:30:00Z");

const openAccount = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* Effect.flatMap(Database, (db) =>
    db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` }),
  );

  return userId;
});

/** The login's row as a check reads it, or none. */
const readLogin = (userId: string, loginId: string) =>
  withChatGptDeviceLoginLocked({ userId, loginId }, (row) =>
    Effect.succeed(Option.getOrUndefined(row)),
  );

it.layer(getTestDB())("a pending ChatGPT device-code login", (it) => {
  it.effect(
    "two starts stand side by side, a start clears the account's lapsed logins, and a settled login keeps its outcome and leaves its codes",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];
        yield* beginChatGptDeviceLogin({ userId, loginId: first }, "sealed-1", LAPSES, AT);
        yield* beginChatGptDeviceLogin({ userId, loginId: second }, "sealed-2", LAPSES, AT, true);

        assert.deepEqual(
          [yield* readLogin(userId, first), yield* readLogin(userId, second)].map((row) => [
            row?.sealedCodes,
            row?.adds,
            row?.outcome,
            row?.expiresAt.getTime(),
          ]),
          [
            ["sealed-1", false, null, LAPSES.getTime()],
            ["sealed-2", true, null, LAPSES.getTime()],
          ],
        );

        yield* settleChatGptDeviceLogin(
          { userId, loginId: second },
          CHATGPT_DEVICE_LOGIN.CONNECTED,
        );
        const settled = yield* readLogin(userId, second);
        assert.equal(settled?.outcome, CHATGPT_DEVICE_LOGIN.CONNECTED);
        assert.equal(settled?.sealedCodes, null);

        yield* dropChatGptDeviceLogin({ userId, loginId: second });
        assert.equal(yield* readLogin(userId, second), undefined);

        yield* beginChatGptDeviceLogin({ userId, loginId: third }, "sealed-3", LATER, LAPSES);
        assert.equal(yield* readLogin(userId, first), undefined, "a lapsed login is cleared");
        assert.equal((yield* readLogin(userId, third))?.sealedCodes, "sealed-3");
      }),
  );

  it.effect("one account neither reads, settles, nor drops another's login", () =>
    Effect.gen(function* () {
      const [owner, other] = [yield* openAccount, yield* openAccount];
      const loginId = randomUUID();
      yield* beginChatGptDeviceLogin({ userId: owner, loginId }, "sealed", LAPSES, AT);

      assert.equal(yield* readLogin(other, loginId), undefined);
      yield* settleChatGptDeviceLogin({ userId: other, loginId }, CHATGPT_DEVICE_LOGIN.REFUSED);
      yield* dropChatGptDeviceLogin({ userId: other, loginId });
      yield* beginChatGptDeviceLogin({ userId: other, loginId: randomUUID() }, "s", LATER, LATER);

      const standing = yield* readLogin(owner, loginId);
      assert.equal(standing?.sealedCodes, "sealed");
      assert.equal(standing?.outcome, null);
    }),
  );
});
