import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { VIEW_CHOICE_KEY } from "@repo/features/view-choice-wire";
import { MANAGER_SORT } from "@repo/features/workspace-managers-model";
import { and, eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { accountViewChoice } from "../../schemas/account-view-choice.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { writeViewChoice } from "../account-view-choices.js";

/**
 * An account's view choices over a real dialect: one is kept for a
 * workspace and for the account apart, chosen again over itself, and
 * forgotten; a workspace the account is not in keeps nothing; and no
 * account writes over or forgets another's. Synthetic accounts throughout.
 */

const KEY = VIEW_CHOICE_KEY.MANAGER_SORT;

/** Two accounts, each the owner of a workspace of its own. */
const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  return {
    owner,
    other,
    ownerWorkspace: yield* openWorkspace(owner),
    otherWorkspace: yield* openWorkspace(other),
  };
});

/** Each choice the account keeps, as `workspace → value`, the account's own under `account`. */
const choicesOf = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const rows = yield* db
      .select({ organizationId: accountViewChoice.organizationId, value: accountViewChoice.value })
      .from(accountViewChoice)
      .where(eq(accountViewChoice.userId, userId));

    return Object.fromEntries(rows.map((row) => [row.organizationId ?? "account", row.value]));
  });

/** The ids of the account's choices kept for the workspace. */
const idsOf = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const rows = yield* db
      .select({ id: accountViewChoice.id })
      .from(accountViewChoice)
      .where(
        and(
          eq(accountViewChoice.userId, userId),
          eq(accountViewChoice.organizationId, organizationId),
        ),
      );

    return rows.map((row) => row.id);
  });

it.layer(getTestDB())("the account view choices store", (it) => {
  it.effect("a choice is kept in its place, chosen again over itself, and forgotten", () =>
    Effect.gen(function* () {
      const { owner, ownerWorkspace } = yield* openAccounts;

      const madeAs = randomUUID();

      const kept = yield* writeViewChoice(owner, {
        id: madeAs,
        key: KEY,
        organizationId: ownerWorkspace,
        value: MANAGER_SORT.NAME,
      });

      assert.notEqual(Option.getOrUndefined(kept)?.txid, undefined);
      yield* writeViewChoice(owner, {
        id: randomUUID(),
        key: KEY,
        organizationId: null,
        value: MANAGER_SORT.CREATED,
      });
      yield* writeViewChoice(owner, {
        id: randomUUID(),
        key: KEY,
        organizationId: ownerWorkspace,
        value: MANAGER_SORT.RECENT_ACTIVITY,
      });
      assert.deepEqual(yield* choicesOf(owner), {
        [ownerWorkspace]: MANAGER_SORT.RECENT_ACTIVITY,
        account: MANAGER_SORT.CREATED,
      });
      // A choice made again in its place keeps the id it was first made under, as a client drew it.
      assert.deepEqual(yield* idsOf(owner, ownerWorkspace), [madeAs]);

      const forgotten = yield* writeViewChoice(owner, {
        id: randomUUID(),
        key: KEY,
        organizationId: ownerWorkspace,
        value: null,
      });

      assert.notEqual(Option.getOrUndefined(forgotten)?.txid, undefined);
      assert.deepEqual(yield* choicesOf(owner), { account: MANAGER_SORT.CREATED });
      // Forgetting a choice no longer kept changes no row, and answers no transaction.
      assert.deepEqual(
        yield* writeViewChoice(owner, {
          id: randomUUID(),
          key: KEY,
          organizationId: ownerWorkspace,
          value: null,
        }),
        Option.some({}),
      );
    }),
  );

  it.effect("one account cannot keep a choice in another's workspace, or touch another's", () =>
    Effect.gen(function* () {
      const { owner, other, ownerWorkspace, otherWorkspace } = yield* openAccounts;
      yield* writeViewChoice(owner, {
        id: randomUUID(),
        key: KEY,
        organizationId: ownerWorkspace,
        value: MANAGER_SORT.NAME,
      });

      assert.ok(
        Option.isNone(
          yield* writeViewChoice(other, {
            id: randomUUID(),
            key: KEY,
            organizationId: ownerWorkspace,
            value: MANAGER_SORT.CREATED,
          }),
        ),
      );
      assert.ok(
        Option.isNone(
          yield* writeViewChoice(other, {
            id: randomUUID(),
            key: KEY,
            organizationId: ownerWorkspace,
            value: null,
          }),
        ),
      );
      yield* writeViewChoice(other, {
        id: randomUUID(),
        key: KEY,
        organizationId: otherWorkspace,
        value: MANAGER_SORT.CREATED,
      });
      assert.deepEqual(yield* choicesOf(owner), { [ownerWorkspace]: MANAGER_SORT.NAME });
      assert.deepEqual(yield* choicesOf(other), { [otherWorkspace]: MANAGER_SORT.CREATED });
    }),
  );
});
