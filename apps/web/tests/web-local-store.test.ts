// web-local-store.test.ts -- the tab's IndexedDB store of the account's kept reads, on fake-indexeddb: answers read back in held order with their cursor, one tab of two writes, a write cut off leaves the answer before it, a store deleted under a tab or missing reads whole, and a sign-out deletes it.
import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { META_KEY } from "@repo/host/local-database";
import type { KeptAnswer, KeptLoad } from "@repo/sync";
import { Effect, Exit, Scope } from "effect";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import { afterEach, vi } from "vitest";
import { type TabLocks, webLocalStore } from "../src/app/web-local-store";

const ACCOUNT = "user-dana";

const TASK_LIST = { read: "taskList", kind: "task", workspace: "w1" } as const;

const FIRST = { id: "t1", name: "First" };
const SECOND = { id: "t2", name: "Second" };
const THIRD = { id: "t3", name: "Third" };
const FOURTH = { id: "t4", name: "Fourth" };

afterEach(() => {
  vi.restoreAllMocks();
});

/** An answer of the task list in `w1`, as `change` names it. */
const answer = (change: Partial<KeptAnswer>): KeptAnswer => ({
  ...TASK_LIST,
  upserted: [],
  deleted: [],
  held: { every: [] },
  cursor: undefined,
  ...change,
});

/** The task list answered whole as `rows`, at `syncId`. */
const wholeAnswer = (rows: readonly { readonly id: string }[], syncId: string) =>
  answer({
    upserted: rows.map((row) => ({ key: row.id, row })),
    held: { every: rows.map((row) => row.id) },
    cursor: { syncId },
  });

/** What a load of the task list answers when it kept `rows` at `syncId`. */
const keptLoad = (rows: readonly object[], syncId: string): KeptLoad => ({
  rows,
  cursor: { syncId },
});

/** Web Locks as one browser holds them across its tabs: a name held is granted to no other tab until its holder lets go. */
function browserLocks(): TabLocks {
  const held = new Set<string>();

  return {
    request: async (name, _options, granted) => {
      if (held.has(name)) return granted(null);
      held.add(name);

      try {
        return await granted({ name, mode: "exclusive" });
      } finally {
        held.delete(name);
      }
    },
  };
}

/** One browser's IndexedDB and Web Locks, which every tab opened on it shares. */
const browser = () => ({
  databases: new IDBFactory(),
  keyRange: IDBKeyRange,
  locks: browserLocks(),
});

type Browser = ReturnType<typeof browser>;

/** A tab of `on` with `account`'s store open, Dana's where none is named, until its `close`, as its page closing closes it. */
const tabOpened = (on: Browser, account = ACCOUNT) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const store = yield* webLocalStore(on).open(account).pipe(Scope.provide(scope));

    return {
      answered: store.rows.answered,
      loaded: store.rows.loaded(TASK_LIST),
      loadedOf: store.rows.loaded,
      close: Scope.close(scope, Exit.void),
    };
  });

/** The names of every database `on` keeps. */
const databaseNames = (on: Browser) =>
  Effect.promise(() => on.databases.databases()).pipe(
    Effect.map((databases) => databases.flatMap(({ name }) => (name === undefined ? [] : [name]))),
  );

it.effect(
  "loads answers back in a later tab with their rows in held order, one taken up past a whole answer last, and the last cursor",
  () =>
    Effect.gen(function* () {
      const on = browser();
      const first = yield* tabOpened(on);

      yield* first.answered(wholeAnswer([FIRST, SECOND], "1"));
      yield* first.answered(
        answer({
          upserted: [
            { key: "t3", row: THIRD },
            { key: "t1", row: { ...FIRST, name: "Renamed" } },
          ],
          deleted: ["t2"],
          held: { every: ["t3", "t1"] },
          cursor: { syncId: "2" },
        }),
      );
      // Past it, an answer that moved only some takes up Fourth and Second again and lets Third go.
      yield* first.answered(
        answer({
          upserted: [
            { key: "t4", row: FOURTH },
            { key: "t2", row: SECOND },
          ],
          deleted: ["t3"],
          held: { appended: ["t4", "t2"] },
          cursor: { syncId: "3" },
        }),
      );
      yield* first.close;

      const later = yield* tabOpened(on);

      assert.deepEqual(
        yield* later.loaded,
        keptLoad([{ ...FIRST, name: "Renamed" }, FOURTH, SECOND], "3"),
      );
    }),
);

it.effect("keeps a row two reads hold after one of them lets it go", () =>
  Effect.gen(function* () {
    const on = browser();
    const tab = yield* tabOpened(on);
    const pinned = { read: "pinned", kind: "task", workspace: "w1" } as const;

    yield* tab.answered(wholeAnswer([FIRST, SECOND], "1"));
    yield* tab.answered({ ...wholeAnswer([FIRST], "1"), ...pinned });
    yield* tab.answered(
      answer({ deleted: ["t1"], held: { appended: [] }, cursor: { syncId: "2" } }),
    );

    assert.deepEqual(yield* tab.loaded, keptLoad([SECOND], "2"));
    assert.deepEqual(yield* tab.loadedOf(pinned), keptLoad([FIRST], "1"));
  }),
);

it.effect(
  "writes from the one tab of two open at once that holds the lock, which the other reads, and the other writes nothing until it loads again",
  () =>
    Effect.gen(function* () {
      const on = browser();
      const writer = yield* tabOpened(on);
      const reader = yield* tabOpened(on);

      yield* writer.answered(wholeAnswer([FIRST], "1"));
      assert.deepEqual(yield* reader.loaded, keptLoad([FIRST], "1"));

      yield* reader.answered(wholeAnswer([SECOND], "2"));
      assert.deepEqual(yield* writer.loaded, keptLoad([FIRST], "1"));

      // Note that the reader stays one once the writer closes, since its pool answers only what moved past the rows it loaded.
      yield* writer.close;
      yield* reader.answered(wholeAnswer([SECOND], "2"));
      assert.deepEqual(yield* reader.loaded, keptLoad([FIRST], "1"));

      const reloaded = yield* tabOpened(on);
      yield* reloaded.answered(wholeAnswer([THIRD], "3"));
      assert.deepEqual(yield* reader.loaded, keptLoad([THIRD], "3"));
    }),
);

it.effect(
  "leaves the answer before a write cut off mid-way for the next load, and writes no more from that tab",
  () =>
    Effect.gen(function* () {
      const on = browser();
      const tab = yield* tabOpened(on);
      yield* tab.answered(wholeAnswer([FIRST, SECOND], "1"));

      // The tab goes as the write's last record, its cursor, is put, after its rows and held keys.
      const put = IDBObjectStore.prototype.put;

      vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
        this: IDBObjectStore,
        ...record: Parameters<IDBObjectStore["put"]>
      ) {
        if (this.name === "cursor") throw new DOMException("The tab closed.", "AbortError");

        return put.apply(this, record);
      });

      yield* tab.answered(
        answer({
          upserted: [{ key: "t3", row: THIRD }],
          deleted: ["t1", "t2"],
          held: { every: ["t3"] },
          cursor: { syncId: "2" },
        }),
      );
      vi.restoreAllMocks();
      yield* tab.answered(wholeAnswer([FOURTH], "3"));
      yield* tab.close;

      assert.deepEqual(yield* (yield* tabOpened(on)).loaded, keptLoad([FIRST, SECOND], "1"));
    }),
);

it.effect(
  "reads whole once its store is deleted under it, writes nothing more there, and keeps a store made again at the next load",
  () =>
    Effect.gen(function* () {
      const on = browser();
      const tab = yield* tabOpened(on);
      yield* tab.answered(wholeAnswer([FIRST], "1"));

      // The browser clears the site's storage while the tab stands, which waits on the tab letting its database go.
      for (const name of yield* databaseNames(on)) {
        yield* Effect.promise(
          () =>
            new Promise((resolve, reject) => {
              const deleted = on.databases.deleteDatabase(name);
              deleted.onsuccess = resolve;
              deleted.onerror = reject;
            }),
        );
      }

      yield* tab.answered(wholeAnswer([SECOND], "2"));
      assert.equal(yield* tab.loaded, undefined);
      assert.deepEqual(yield* databaseNames(on), []);
      yield* tab.close;

      const next = yield* tabOpened(on);
      assert.equal(yield* next.loaded, undefined);
      yield* next.answered(wholeAnswer([THIRD], "3"));
      assert.deepEqual(yield* next.loaded, keptLoad([THIRD], "3"));
    }),
);

it.effect("loads none of a store kept by a build of other row shapes", () =>
  Effect.gen(function* () {
    const on = browser();
    const tab = yield* tabOpened(on);
    yield* tab.answered(wholeAnswer([FIRST], "1"));
    yield* tab.close;

    // An older build kept the store at its own schema hash.
    const [name] = yield* databaseNames(on);

    yield* Effect.promise(
      () =>
        new Promise<void>((resolve, reject) => {
          const opening = on.databases.open(name ?? "");

          opening.onsuccess = () => {
            const database = opening.result;
            const write = database.transaction("meta", "readwrite");

            write.objectStore("meta").put({ key: META_KEY.SCHEMA_HASH, value: "older" });

            write.oncomplete = () => {
              database.close();
              resolve();
            };

            write.onerror = () => reject(write.error);
          };
        }),
    );

    assert.equal(yield* (yield* tabOpened(on)).loaded, undefined);
  }),
);

it.effect("deletes the account's store at a sign-out", () =>
  Effect.gen(function* () {
    const on = browser();
    const tab = yield* tabOpened(on);
    yield* tab.answered(wholeAnswer([FIRST], "1"));
    yield* tab.close;

    yield* webLocalStore(on).forget(ACCOUNT);

    assert.deepEqual(yield* databaseNames(on), []);
    assert.equal(yield* (yield* tabOpened(on)).loaded, undefined);
  }),
);

it.effect("deletes every other account's store as an account signs in, and keeps its own", () =>
  Effect.gen(function* () {
    const on = browser();
    const dana = yield* tabOpened(on);
    yield* dana.answered(wholeAnswer([FIRST], "1"));
    yield* dana.close;

    // Dana's session ended with no tab open; Lee signs in on the same browser.
    const lee = yield* tabOpened(on, "user-lee");
    yield* lee.answered(wholeAnswer([SECOND], "2"));

    yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve))).pipe(
      Effect.andThen(databaseNames(on)),
      Effect.repeat({ until: (names) => names.length === 1, times: 100 }),
    );

    assert.deepEqual(yield* lee.loaded, keptLoad([SECOND], "2"));
    assert.equal(yield* (yield* tabOpened(on)).loaded, undefined);
  }),
);
