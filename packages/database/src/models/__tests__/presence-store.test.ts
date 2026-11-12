import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import { readLastActive, stampPresence } from "../presence-store.js";

/**
 * When a member was last active, over a real dialect: a beat stamps the
 * caller's own account alone, and a later beat moves the stamp on.
 * Synthetic accounts throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  return { owner, other };
});

it.layer(getTestDB())("the presence store", (it) => {
  it.effect("a beat stamps the caller's own account alone, and a later one moves it on", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const start = yield* Clock.currentTimeMillis;

      yield* stampPresence(owner);
      assert.deepEqual(
        Option.map(yield* readLastActive(owner), (at) => at.getTime()),
        Option.some(start),
      );
      assert.ok(Option.isNone(yield* readLastActive(other)));

      yield* TestClock.adjust("30 seconds");
      yield* stampPresence(owner);
      assert.deepEqual(
        Option.map(yield* readLastActive(owner), (at) => at.getTime()),
        Option.some(start + 30_000),
      );
    }),
  );
});
