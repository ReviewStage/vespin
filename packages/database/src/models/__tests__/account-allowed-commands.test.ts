import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  ALLOWED_COMMAND_ADDED,
  addAllowedCommand,
  editAllowedCommand,
  listAllowedCommands,
  removeAllowedCommand,
} from "../account-allowed-commands.js";

/**
 * A member's always-allowed commands over a real dialect: a prefix is kept
 * once in the order added, a second add of it changes nothing, one is
 * edited or removed by its id, and no member reads, edits, or removes
 * another's. Synthetic
 * accounts and commands throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  return { owner, other };
});

const prefixesOf = (userId: string) =>
  Effect.map(listAllowedCommands(userId), (rows) => rows.map((row) => row.prefix));

it.layer(getTestDB())("the allowed commands store", (it) => {
  it.effect("a prefix is kept once in the order added, and removed by its id", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;

      const add = (prefix: readonly string[], at: number) =>
        addAllowedCommand({ userId: owner, prefix, agentId: null, at: new Date(at) });

      assert.equal(yield* add(["pnpm", "test"], 1_000), ALLOWED_COMMAND_ADDED.ADDED);
      assert.equal(yield* add(["git", "status"], 2_000), ALLOWED_COMMAND_ADDED.ADDED);
      // The same words again change nothing, and a longer prefix is a command of its own.
      assert.equal(yield* add(["pnpm", "test"], 3_000), ALLOWED_COMMAND_ADDED.KEPT);
      assert.equal(yield* add(["pnpm", "test", "--watch"], 4_000), ALLOWED_COMMAND_ADDED.ADDED);
      assert.deepEqual(yield* prefixesOf(owner), [
        ["pnpm", "test"],
        ["git", "status"],
        ["pnpm", "test", "--watch"],
      ]);

      const [first] = yield* listAllowedCommands(owner);
      assert.equal(first?.createdAt.getTime(), 1_000);
      yield* removeAllowedCommand(owner, first?.id ?? "");
      assert.deepEqual(yield* prefixesOf(owner), [
        ["git", "status"],
        ["pnpm", "test", "--watch"],
      ]);
    }),
  );

  it.effect(
    "an edit puts typed words in place as added by hand, or drops the command where they are kept",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        yield* addAllowedCommand({
          userId: owner,
          prefix: ["pnpm", "test"],
          agentId: null,
          at: new Date(1_000),
        });
        yield* addAllowedCommand({
          userId: owner,
          prefix: ["git", "status"],
          agentId: null,
          at: new Date(2_000),
        });
        const [tested, status] = yield* listAllowedCommands(owner);

        yield* editAllowedCommand({
          userId: owner,
          id: tested?.id ?? "",
          prefix: ["pnpm", "lint"],
          at: new Date(3_000),
        });
        const [, edited] = yield* listAllowedCommands(owner);
        assert.deepEqual(edited, {
          id: tested?.id,
          prefix: ["pnpm", "lint"],
          agentId: null,
          createdAt: new Date(3_000),
        });

        // Note that words the list keeps already stay kept once: the edited command goes.
        yield* editAllowedCommand({
          userId: owner,
          id: status?.id ?? "",
          prefix: ["pnpm", "lint"],
          at: new Date(4_000),
        });
        assert.deepEqual(yield* prefixesOf(owner), [["pnpm", "lint"]]);
      }),
  );

  it.effect("no member reads, edits, or removes another's commands", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      yield* addAllowedCommand({ userId: owner, prefix: ["make"], agentId: null, at: new Date() });
      const [kept] = yield* listAllowedCommands(owner);

      assert.deepEqual(yield* listAllowedCommands(other), []);
      yield* editAllowedCommand({
        userId: other,
        id: kept?.id ?? "",
        prefix: ["rm"],
        at: new Date(),
      });
      yield* removeAllowedCommand(other, kept?.id ?? "");
      assert.deepEqual(yield* prefixesOf(owner), [["make"]]);
    }),
  );
});
