import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Exit, Layer, Path, Result, Scope } from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import { ENTITY_STORE_FILE_NAME, openEntityStore } from "./entity-store.js";
import { testCipher } from "./testing/test-cipher.js";

/**
 * The queues an older build kept on disk, over a state root of the test's
 * own and a cipher standing in for the Keychain's: carried until the local
 * database imports them. Synthetic accounts and rows throughout.
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

it.effect(
  "the writes an older build kept waiting are carried through every save until the local database imported them",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      const waiting = [{ name: "tasks.rename", key: "rename-old", input: { taskId: "t1" } }];
      const kept = { hash: "an older build's", accountId: DANA, reads: {}, queue: waiting };
      const sealed = Base64.encode(testCipher().encrypt(JSON.stringify(kept)));
      yield* (yield* FileSystem.FileSystem).writeFileString(yield* fileOf(directory), sealed);

      // Note that the file still names an older build's hash, so the first quit writes it again.
      const upgraded = yield* opened(directory, DANA);
      yield* upgraded.closed;

      const imported = yield* opened(directory, DANA);
      const queue = imported.store.queue;
      assert.ok(queue, "a file that read hands out its queue");
      yield* queue.imported;
      yield* imported.closed;

      const after = yield* opened(directory, DANA);
      yield* after.closed;

      assert.deepEqual(queue.entries, waiting);
      assert.deepEqual(after.store.queue?.entries, []);
    }).pipe(Effect.provide(files)),
);

it.effect(
  "the messages refused an older build kept are handed out until the local database takes them, and the file is then written without them",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      const refused = [{ id: "line-1", text: "Rebase on main" }];
      const kept = { hash: "an older build's", accountId: DANA, reads: {}, refused };
      const sealed = Base64.encode(testCipher().encrypt(JSON.stringify(kept)));
      yield* (yield* FileSystem.FileSystem).writeFileString(yield* fileOf(directory), sealed);

      const upgraded = yield* opened(directory, DANA);
      assert.deepEqual(upgraded.store.refused?.entries, refused);
      yield* upgraded.store.refused?.imported ?? Effect.void;
      yield* upgraded.closed;

      assert.equal("refused" in JSON.parse(yield* openedText(directory)), false);
    }).pipe(Effect.provide(files)),
);
