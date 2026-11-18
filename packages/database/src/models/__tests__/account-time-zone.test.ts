import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import { readAccountTimeZone, writeAccountTimeZone } from "../account-time-zone.js";

/**
 * A member's kept time zone, over a real dialect: a write moves the caller's
 * own account alone, and a later one, from a device in another zone,
 * replaces it. Synthetic accounts throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  return { owner, other };
});

it.layer(getTestDB())("the account time zone", (it) => {
  it.effect("a write keeps the caller's own zone alone, and a later one replaces it", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;

      assert.ok(Option.isNone(yield* readAccountTimeZone(owner)));

      yield* writeAccountTimeZone(owner, "America/New_York");
      assert.deepEqual(yield* readAccountTimeZone(owner), Option.some("America/New_York"));
      assert.ok(Option.isNone(yield* readAccountTimeZone(other)));

      yield* writeAccountTimeZone(other, "Asia/Tokyo");
      yield* writeAccountTimeZone(owner, "Europe/Lisbon");
      assert.deepEqual(yield* readAccountTimeZone(owner), Option.some("Europe/Lisbon"));
      assert.deepEqual(yield* readAccountTimeZone(other), Option.some("Asia/Tokyo"));
    }),
  );
});
