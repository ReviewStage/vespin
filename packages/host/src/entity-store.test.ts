import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Exit, Layer, Path, PubSub, Result, Scope, Stream } from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import { TestClock } from "effect/testing";
import {
  ENTITY_STORE_FILE_NAME,
  KEPT_READ,
  type KeptRows,
  openEntityStore,
} from "./entity-store.js";
import { planListRow } from "./testing/task-list-rows.js";
import { testCipher } from "./testing/test-cipher.js";

/**
 * The account's lists kept on disk, over a state root of the test's own and
 * a cipher standing in for the Keychain's: what a store kept comes back to
 * the same account at the same row shapes, and a file kept for another
 * account, or at other row shapes, draws nothing and is deleted as the store
 * opens. Synthetic accounts and rows throughout.
 */

const DANA = "user-dana";

const files = Layer.merge(NodeFileSystem.layer, NodePath.layer);

/** The task list as one answer left it, read at sync id 7. */
const LIST: KeptRows[typeof KEPT_READ.TASK_LIST] = {
  rows: {
    tasks: [planListRow("7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10", "Teammate invitations")],
    agents: [],
  },
  at: "7",
};

/** The Inbox as one answer left it, read at sync id 7: one thread, its message's words and file's name among it. */
const INBOX: KeptRows[typeof KEPT_READ.INBOX] = {
  items: [
    {
      item: {
        id: "2f6c1d8e-4b3a-4e5f-9a7b-1c2d3e4f5a6b",
        agentId: "5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d",
        key: "push-access",
        revision: 1,
        version: 5,
        title: "Push to the release branch?",
        needsReply: true,
        status: "open",
        thread: [
          {
            id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
            author: "agent",
            text: "May I push?",
            files: [
              {
                attachmentId: "3d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a",
                name: "plan.pdf",
                mediaType: "application/pdf",
              },
            ],
            createdAt: 1_800_000_000_000,
          },
        ],
        postedAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
      },
      taskId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
    },
  ],
  at: "7",
};

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

/** The file kept again as another build would have kept it: every byte its own but `changed`. */
const keptAgainWith = (
  directory: string,
  changed: { readonly hash?: string; readonly refused?: readonly object[] },
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const kept = { ...JSON.parse(yield* openedText(directory)), ...changed };
    const sealed = Base64.encode(testCipher().encrypt(JSON.stringify(kept)));
    yield* fileSystem.writeFileString(yield* fileOf(directory), sealed);
  });

it.effect.each([
  { kept: "the same account at the same row shapes", reopenedAs: DANA, otherSchemas: false },
  { kept: "another account", reopenedAs: "user-ravi", otherSchemas: false },
  { kept: "other row shapes", reopenedAs: DANA, otherSchemas: true },
])("a file kept for $kept", ({ reopenedAs, otherSchemas }) =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-store-");
    const first = yield* opened(directory, DANA);
    yield* first.store.keep(KEPT_READ.TASK_LIST, LIST);
    yield* first.store.keep(KEPT_READ.INBOX, INBOX);
    yield* first.closed;

    if (otherSchemas) yield* keptAgainWith(directory, { hash: "another build's" });

    const reopened = yield* opened(directory, reopenedAs);

    const stays = yield* Effect.flatMap(FileSystem.FileSystem, (fileSystem) =>
      Effect.flatMap(fileOf(directory), (file) => fileSystem.exists(file)),
    );

    // Note that the shapes' hash is a hint only, so rows kept under another build's still read where they still fit these shapes.
    const fits = reopenedAs === DANA;
    assert.deepEqual(reopened.store.stored(KEPT_READ.TASK_LIST), fits ? LIST : undefined);
    assert.deepEqual(reopened.store.stored(KEPT_READ.INBOX), fits ? INBOX : undefined);
    assert.equal(stays, fits);
  }).pipe(Effect.provide(files)),
);

it.effect(
  "a build that changed one shape costs only the rows that no longer read: the other reads stand, a row with a retired field or without an added optional one still reads, and the Inbox drops the item that doesn't and its sync id",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      const first = yield* opened(directory, DANA);
      yield* first.store.keep(KEPT_READ.TASK_LIST, LIST);
      yield* first.store.keep(KEPT_READ.INBOX, INBOX);
      yield* first.closed;

      // An older build kept a second thread whose status this build no longer reads, under its own shapes' hash.
      const fileSystem = yield* FileSystem.FileSystem;
      const kept = JSON.parse(yield* openedText(directory));
      const [thread] = INBOX.items;
      assert.ok(thread !== undefined);

      const stale = {
        ...thread,
        item: { ...thread.item, id: "6b5a4f3e-2d1c-4b0a-9f8e-7d6c5b4a3f2e", status: 42 },
      };

      kept.hash = "another build's";
      kept.reads[KEPT_READ.INBOX].items.push(stale);
      // The kept thread also holds a field this build retired, and lacks the optional ones it added (a reminder), as most shape changes leave a row: it still reads.
      kept.reads[KEPT_READ.INBOX].items[0].item.retiredField = "an older build's";
      const sealed = Base64.encode(testCipher().encrypt(JSON.stringify(kept)));
      yield* fileSystem.writeFileString(yield* fileOf(directory), sealed);

      const reopened = yield* opened(directory, DANA);

      assert.deepEqual(reopened.store.stored(KEPT_READ.TASK_LIST), LIST);
      assert.deepEqual(reopened.store.stored(KEPT_READ.INBOX), { items: INBOX.items });
      yield* reopened.closed;
    }).pipe(Effect.provide(files)),
);

it.effect(
  "lists that moved are written within thirty seconds, sealed, while the store stands",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      const { store, closed } = yield* opened(directory, DANA);
      // Note that the store closes before its folder is removed, whatever the assertions find.
      yield* Effect.addFinalizer(() => closed);
      yield* store.keep(KEPT_READ.TASK_LIST, LIST);

      yield* TestClock.adjust("30 seconds");
      const sealed = yield* writtenText(directory);

      assert.equal(sealed.includes("Teammate invitations"), false, "nothing is kept in the clear");
      assert.deepEqual(JSON.parse(yield* openedText(directory)).reads, {
        [KEPT_READ.TASK_LIST]: LIST,
      });
    }).pipe(Effect.provide(files)),
);

it.effect(
  "where the shell names its moments, lists that moved wait for one rather than thirty seconds, then are written",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      const due = yield* PubSub.unbounded<void>();
      let saves = 0;

      // Note that a save's first touch of the disk is making its folder, counted here, since a write the disk has not finished can't be awaited from a test.
      const counted = Layer.effect(
        FileSystem.FileSystem,
        Effect.map(FileSystem.FileSystem, (fileSystem) => ({
          ...fileSystem,
          makeDirectory: (path: string, options?: Parameters<typeof fileSystem.makeDirectory>[1]) =>
            Effect.suspend(() => {
              saves += 1;

              return fileSystem.makeDirectory(path, options);
            }),
        })),
      ).pipe(Layer.provide(NodeFileSystem.layer));

      const scope = yield* Scope.make();
      yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));

      const store = yield* Scope.provide(scope)(
        openEntityStore({
          directory,
          cipher: testCipher(),
          accountId: DANA,
          listsDue: Stream.fromPubSub(due),
        }),
      ).pipe(Effect.provide(Layer.merge(counted, NodePath.layer)));

      yield* store.keep(KEPT_READ.TASK_LIST, LIST);
      yield* TestClock.adjust("30 seconds");
      yield* Effect.yieldNow;

      assert.equal(saves, 0, "nothing is written while the app stays in front");

      yield* PubSub.publish(due, undefined);
      yield* writtenText(directory);

      assert.deepEqual(JSON.parse(yield* openedText(directory)).reads, {
        [KEPT_READ.TASK_LIST]: LIST,
      });
    }).pipe(Effect.provide(files)),
);

it.effect(
  "the writes an older build kept waiting are carried through every save until the local database imported them",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      const waiting = [{ name: "tasks.rename", key: "rename-old", input: { taskId: "t1" } }];
      const kept = { hash: "an older build's", accountId: DANA, reads: {}, queue: waiting };
      const sealed = Base64.encode(testCipher().encrypt(JSON.stringify(kept)));
      yield* (yield* FileSystem.FileSystem).writeFileString(yield* fileOf(directory), sealed);

      // Note that each launch keeps a list, so its quit saves the file whole.
      const upgraded = yield* opened(directory, DANA);
      yield* upgraded.store.keep(KEPT_READ.TASK_LIST, LIST);
      yield* upgraded.closed;

      const imported = yield* opened(directory, DANA);
      const queue = imported.store.queue;
      assert.ok(queue, "a file that read hands out its queue");
      yield* queue.imported;
      yield* imported.store.keep(KEPT_READ.INBOX, INBOX);
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
      const first = yield* opened(directory, DANA);
      yield* first.store.keep(KEPT_READ.TASK_LIST, LIST);
      yield* first.closed;
      yield* keptAgainWith(directory, { refused });

      const upgraded = yield* opened(directory, DANA);
      assert.deepEqual(upgraded.store.refused?.entries, refused);
      yield* upgraded.store.refused?.imported ?? Effect.void;
      yield* upgraded.closed;

      assert.equal("refused" in JSON.parse(yield* openedText(directory)), false);
    }).pipe(Effect.provide(files)),
);

it.effect(
  "a workspace the kept list no longer names leaves with its people, and a late answer for it is not kept",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-store-");
      const { store, closed } = yield* opened(directory, DANA);

      const people = {
        members: [
          { userId: "user-ada", name: "Ada", email: "ada@app.test", role: "owner", image: null },
        ],
        former: [{ userId: "user-lee", name: "Lee", image: null }],
      };

      yield* store.keepIn(KEPT_READ.MEMBERS, "workspace-acme", people);
      yield* store.keepIn(KEPT_READ.MEMBERS, "workspace-relay", people);

      yield* store.keep(KEPT_READ.WORKSPACES, [
        {
          id: "workspace-acme",
          name: "acme",
          role: WORKSPACE_ROLE.MEMBER,
          github: null,
          githubInstallations: [],
          memberCount: 2,
        },
      ]);
      yield* store.keepIn(KEPT_READ.MEMBERS, "workspace-relay", people);
      // Note that the store is closed before the folder is removed, so a save its open forked late, after the keeps above, is not still writing into it.
      yield* closed;

      assert.deepEqual(store.storedIn(KEPT_READ.MEMBERS, "workspace-acme"), people);
      assert.equal(store.storedIn(KEPT_READ.MEMBERS, "workspace-relay"), undefined);
    }).pipe(Effect.provide(files)),
);
