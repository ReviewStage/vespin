import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { entityPool, type FieldChange, fieldKind, type WriteDeclaration } from "@repo/sync";
import { Effect, Exit, Layer, Path, PubSub, Result, Schema, Scope, Stream } from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import { ENTITY_STORE_FILE_NAME, openEntityStore } from "./entity-store.js";
import { testCipher } from "./testing/test-cipher.js";

/**
 * The account's waiting writes kept on disk, over a state root of the test's
 * own and a cipher standing in for the Keychain's: what a store kept comes
 * back to the same account alone. Synthetic accounts and rows throughout.
 */

const DANA = "user-dana";

const files = Layer.merge(NodeFileSystem.layer, NodePath.layer);

/** A store opened over `directory` for `accountId` in a scope of its own, which the test closes as a quit does. */
function opened(directory: string, accountId: string) {
  return Effect.gen(function* () {
    const scope = yield* Scope.make();

    const store = yield* Scope.provide(scope)(
      openEntityStore({ directory, cipher: testCipher(), accountId }),
    );

    return { store, closed: Scope.close(scope, Exit.void) };
  });
}

/** The sealed file's path under `directory`. */
const fileOf = (directory: string) =>
  Effect.map(Path.Path, (path) => path.join(directory, ENTITY_STORE_FILE_NAME));

/** The sealed file's text opened as the test cipher seals it. */
const openedText = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const sealed = yield* fileSystem.readFileString(yield* fileOf(directory));

    return testCipher().decrypt(Result.getOrThrow(Base64.decode(sealed)));
  });

/** The sealed file's text once a save has written it. */
const writtenText = (directory: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const file = yield* fileOf(directory);
    // Note that the write is the disk's own, which no test clock moves, so the test waits on the file itself.
    yield* Effect.repeat(fileSystem.exists(file), { until: (exists) => exists, times: 10_000 });

    return yield* fileSystem.readFileString(file);
  });

/** A plan's row as the waiting write below renames it. */
interface Row {
  readonly id: string;
  readonly name: string;
}

it.effect("a write waiting for the service is written within half a second of its queuing", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-store-");
    const pool = yield* entityPool({ mintKey: () => "rename-1", replayRefused: Effect.void });

    const rename: WriteDeclaration<Row, FieldChange<Row>, string, string> = {
      kind: fieldKind((row: Row) => row.id),
      keys: () => ["1"],
      change: (name) => () => ({ name }),
      send: () => Effect.succeed({ refused: "unreachable", unanswered: true as const }),
      queue: { name: "plans.rename", input: Schema.String, queued: () => "waits" },
    };

    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    yield* Scope.provide(scope)(
      openEntityStore({
        directory,
        cipher: testCipher(),
        accountId: DANA,
        queued: pool.queued,
        queueMoves: pool.queueMoves,
      }),
    );
    yield* pool.write(rename, "Invites");

    yield* TestClock.adjust("500 millis");
    yield* writtenText(directory);

    assert.deepEqual(JSON.parse(yield* openedText(directory)).queue, [
      { name: "plans.rename", key: "rename-1", input: "Invites" },
    ]);
  }).pipe(Effect.provide(files)),
);

it.effect(
  "the messages refused are written within half a second of moving, and read back at the next launch by the same account alone",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      const moves = yield* PubSub.unbounded<void>();
      let refused: readonly unknown[] = [];
      const scope = yield* Scope.make();

      yield* Scope.provide(scope)(
        openEntityStore({
          directory,
          cipher: testCipher(),
          accountId: DANA,
          refused: () => refused,
          refusedMoves: Stream.fromPubSub(moves),
        }),
      );

      yield* Effect.yieldNow;
      refused = [{ id: "line-1", text: "Rebase on main" }];
      yield* PubSub.publish(moves, undefined);
      yield* TestClock.adjust("500 millis");
      yield* writtenText(directory);
      yield* Scope.close(scope, Exit.void);

      const again = yield* opened(directory, DANA);
      assert.deepEqual(again.store.refused, refused);
      yield* again.closed;

      const another = yield* opened(directory, "user-ravi");
      assert.deepEqual(another.store.refused, []);
      yield* another.closed;
    }).pipe(Effect.provide(files)),
);
