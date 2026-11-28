/**
 * web-local-store.ts -- the tab's local store of the account's kept reads in IndexedDB: one database per account, each answer written in one transaction, one tab of an account writing under a Web Lock while every other reads, and the database deleted at sign-out.
 *
 * This is the web's backend of the host's local copy
 * (`LocalStoreBackendSeam`, `@repo/host`'s `local-copy.ts`), so a page load
 * draws each kept read, the task list and the Inbox among them, from what
 * the last load kept and asks the service only past its cursor, as the Mac
 * does from SQLite. It keeps what `local-rows.ts` keeps there, in the same
 * shapes: `row` (each kind's synced rows, as JSON), `held` (the keys each
 * read holds, in its order), `cursor` (each read's cursor, as JSON), and
 * `meta` (the schema hash, `keptRowsHash`). Each answer is written in one
 * readwrite transaction over the first three, so a tab closed mid-write
 * leaves the answer before it whole, and a load reads a read's cursor and
 * its rows in one transaction, so they are always one committed answer's.
 *
 * The tab keeps no queues: its waiting writes and the agent messages the
 * service refused stay in memory for the tab's life, as they did before it
 * kept any store, so two tabs never send each other's writes twice.
 *
 * One tab of an account writes: the one that holds the account's Web Lock,
 * asked for once as the store opens and held until it closes. A tab that
 * finds it held reads the store as each of its reads first stands and
 * writes nothing until it is loaded again, even once the writer closes,
 * because its pool hands the store only what moved since the store's rows
 * it loaded, and those may since have moved under the other tab; a load
 * after the writer closed takes the lock and writes on from the rows it
 * loaded itself. A browser with no Web Locks writes nothing, so it never
 * writes beside another tab.
 *
 * The browser keeps only the store of the account signed in now: an open
 * deletes every other account's, so a session that ended with no tab open
 * (signed out from the admin dashboard, which deletes them itself, expired,
 * or ended elsewhere) leaves its copy no longer than the next sign-in.
 *
 * A writer that opens on a schema hash other than its build's clears the
 * kept lists, as SQLite's open does; a reader on another hash loads none,
 * since the writer may be a build of other row shapes. A write that fails,
 * and a database closed or deleted under the tab (a sign-out in another
 * tab, the browser evicting it or the person clearing it) stops the tab's
 * writes until it is loaded again, so what the store holds stays each
 * read's last whole answer, and a load from a closed database answers none,
 * so the read waits on the service's whole answer. A database missing at a
 * load is made again, empty, and every read reads whole once.
 */

import type { LocalStoreBackendSeam } from "@repo/host/effect";
import { keptRowsHash, LocalDatabaseFailed, META_KEY } from "@repo/host/local-database";
import type { KeptAnswer, KeptLoad, KeptName, RowsStore } from "@repo/sync";
import { Effect } from "effect";

/** What every account's database and lock is named after. */
const STORE_PREFIX = "vespin.local";

/** The database's version, raised where its stores or indexes change. */
const DATABASE_VERSION = 1;

/** The object stores, as `local-database.ts` names SQLite's tables. */
const STORE = {
  ROW: "row",
  HELD: "held",
  CURSOR: "cursor",
  META: "meta",
} as const;

/** The indexes on `held`. */
const HELD_INDEX = {
  /** Each read's keys by the row they name, as a let-go asks whether any read still holds one. */
  ROW: "row",
  /** Each read's keys in its order, as a load and an append read them. */
  ORDER: "order",
} as const;

/** The workspace a read that names none is kept under. */
const NO_WORKSPACE = "";

/** The stores an answer's write spans. */
const ANSWER_STORES = [STORE.ROW, STORE.HELD, STORE.CURSOR];

/** The stores a load spans. */
const LOAD_STORES = [STORE.ROW, STORE.HELD, STORE.CURSOR, STORE.META];

/** A `row` record: a kind's synced row by its key, as its JSON. */
interface RowRecord {
  readonly kind: string;
  readonly key: string;
  readonly row: string;
}

/** A `held` record: a key a read holds, at its place in the read's order. */
interface HeldRecord {
  readonly read: string;
  readonly workspace: string;
  readonly kind: string;
  readonly key: string;
  readonly position: number;
}

/** A `cursor` record: a read's cursor, as its JSON, none where it answered none. */
interface CursorRecord {
  readonly read: string;
  readonly workspace: string;
  readonly cursor: string | null;
}

/** A `meta` record. */
interface MetaRecord {
  readonly key: string;
  readonly value: string;
}

/** The browser's Web Locks, as the store asks for its writer's lock. */
export interface TabLocks {
  readonly request: (
    name: string,
    options: { readonly ifAvailable: true },
    granted: (lock: Lock | null) => Promise<void> | undefined,
  ) => Promise<void>;
}

/** The browser's IndexedDB and Web Locks, as the store is handed them. */
export interface WebLocalStoreSeam {
  readonly databases: IDBFactory;
  readonly keyRange: typeof IDBKeyRange;
  /** None where the browser has no Web Locks, so the tab never writes. */
  readonly locks: TabLocks | undefined;
}

/** One account's open database, and whether this tab writes it. */
interface Standing {
  readonly database: IDBDatabase;
  /** Whether this tab holds the account's lock, and its writes have not stopped. */
  writes: boolean;
  /** Whether the database is still open: closed by a sign-out, the browser, or the scope. */
  open: boolean;
}

/**
 * The account's database's name, and its lock's. Note that IndexedDB names
 * a database by one string alone, so the account's id is joined to the
 * prefix here and nowhere else.
 */
function storeName(accountId: string): string {
  return `${STORE_PREFIX}:${accountId}`;
}

/** Whether `name` is the database of a tab store, of any account. */
function isStoreName(name: string): boolean {
  return name.startsWith(`${STORE_PREFIX}:`);
}

/** `request`'s result, or its error. */
function requested<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Settles once `transaction` commits, or rejects with why it aborted. */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new DOMException("", "AbortError"));
  });
}

/**
 * Runs `step` in a transaction over `stores`, answering its result once the
 * transaction commits; a step that throws aborts it, so nothing it wrote
 * lands.
 */
async function inTransaction<T>(
  database: IDBDatabase,
  stores: readonly string[],
  mode: IDBTransactionMode,
  step: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const transaction = database.transaction(stores, mode);
  const done = committed(transaction);
  // Note that an abort while the step still runs is answered through the step or the await below, so the early rejection is marked heard here.
  done.catch(() => undefined);

  try {
    const result = await step(transaction);
    await done;

    return result;
  } catch (cause) {
    // Note that a transaction already aborted throws on a second abort, and the first cause is the one to answer.
    try {
      transaction.abort();
    } catch {}

    await done.catch(() => undefined);
    throw cause;
  }
}

/** Every key `read` in `workspace` holds, in a range over `held` or its order index. */
function readRange(keyRange: typeof IDBKeyRange, read: string, workspace: string): IDBKeyRange {
  // Note that an array key sorts after every string and number, so `[read, workspace, []]` bounds every key under the pair.
  return keyRange.bound([read, workspace], [read, workspace, []]);
}

/** Creates the stores and indexes of a database made new. */
function upgraded(database: IDBDatabase): void {
  database.createObjectStore(STORE.ROW, { keyPath: ["kind", "key"] });
  const held = database.createObjectStore(STORE.HELD, { keyPath: ["read", "workspace", "key"] });
  held.createIndex(HELD_INDEX.ROW, ["kind", "key"]);
  held.createIndex(HELD_INDEX.ORDER, ["read", "workspace", "position"]);
  database.createObjectStore(STORE.CURSOR, { keyPath: ["read", "workspace"] });
  database.createObjectStore(STORE.META, { keyPath: "key" });
}

/** Opens `name`, creating it where it stands not. */
function opened(databases: IDBFactory, name: string): Promise<IDBDatabase> {
  const request = databases.open(name, DATABASE_VERSION);
  request.onupgradeneeded = () => upgraded(request.result);

  return requested(request);
}

/** Writes every key `answer`'s read holds in order over what `held` holds of it, answering the keys it no longer holds. */
async function everyHeldWritten(
  held: IDBObjectStore,
  range: IDBKeyRange,
  answer: KeptAnswer,
  every: readonly string[],
): Promise<readonly string[]> {
  const workspace = answer.workspace ?? NO_WORKSPACE;
  // SAFETY: `held` holds only the records this module puts.
  const stored = (await requested(held.getAll(range))) as HeldRecord[];
  const now = new Map(every.map((key, position) => [key, position]));
  const was = new Map(stored.map((record) => [record.key, record.position]));

  for (const key of was.keys()) if (!now.has(key)) held.delete([answer.read, workspace, key]);

  for (const [key, position] of now) {
    if (was.get(key) === position) continue;
    const record: HeldRecord = { read: answer.read, workspace, kind: answer.kind, key, position };
    held.put(record);
  }

  return [...was.keys()].filter((key) => !now.has(key));
}

/** Writes `appended` after every key `answer`'s read holds, and lets go each key its answer deleted, answering those. */
async function appendedWritten(
  held: IDBObjectStore,
  range: IDBKeyRange,
  answer: KeptAnswer,
  appended: readonly string[],
): Promise<readonly string[]> {
  const workspace = answer.workspace ?? NO_WORKSPACE;

  for (const key of answer.deleted) held.delete([answer.read, workspace, key]);

  // Note that the last place is read after the deletes, as SQLite's `MAX` is, since requests in one transaction run in the order they were made.
  const last = await requested(held.index(HELD_INDEX.ORDER).openCursor(range, "prev"));
  // SAFETY: `held` holds only the records this module puts.
  const after = last === null ? 0 : (last.value as HeldRecord).position + 1;

  for (const [at, key] of appended.entries()) {
    const record: HeldRecord = {
      read: answer.read,
      workspace,
      kind: answer.kind,
      key,
      position: after + at,
    };

    held.put(record);
  }

  return answer.deleted;
}

/** Writes `answer` to `database` in one transaction: its rows, its held keys in order, the rows no read holds any more, and its cursor. */
function written(
  database: IDBDatabase,
  keyRange: typeof IDBKeyRange,
  answer: KeptAnswer,
): Promise<void> {
  const workspace = answer.workspace ?? NO_WORKSPACE;
  // Note that the JSON is made before the transaction opens, because a value JSON cannot hold throws here and should leave nothing half written.
  const cursor = answer.cursor === undefined ? null : JSON.stringify(answer.cursor);

  const rows = answer.upserted.map(
    ({ key, row }): RowRecord => ({ kind: answer.kind, key, row: JSON.stringify(row) }),
  );

  return inTransaction(database, ANSWER_STORES, "readwrite", async (transaction) => {
    const held = transaction.objectStore(STORE.HELD);
    const row = transaction.objectStore(STORE.ROW);
    const range = readRange(keyRange, answer.read, workspace);

    const left =
      "every" in answer.held
        ? await everyHeldWritten(held, range, answer, answer.held.every)
        : await appendedWritten(held, range, answer, answer.held.appended);

    for (const record of rows) row.put(record);

    // Note that a key let go deletes its row only once no read holds it, because another read on the kind may stand on it still.
    const letGo = [...new Set([...answer.deleted, ...left])];

    const holders = await Promise.all(
      letGo.map((key) => requested(held.index(HELD_INDEX.ROW).count([answer.kind, key]))),
    );

    for (const [at, key] of letGo.entries()) if (holders[at] === 0) row.delete([answer.kind, key]);

    const record: CursorRecord = { read: answer.read, workspace, cursor };
    transaction.objectStore(STORE.CURSOR).put(record);
  });
}

/** What `database` holds of `name` at `hash`: its rows in held order and its cursor; none where it never answered or was kept at another hash. */
function loadedFrom(
  database: IDBDatabase,
  keyRange: typeof IDBKeyRange,
  hash: string,
  name: KeptName,
): Promise<KeptLoad | undefined> {
  const workspace = name.workspace ?? NO_WORKSPACE;

  return inTransaction(database, LOAD_STORES, "readonly", async (transaction) => {
    // SAFETY: `meta` holds only the records this module puts.
    const meta = (await requested(transaction.objectStore(STORE.META).get(META_KEY.SCHEMA_HASH))) as
      | MetaRecord
      | undefined;

    if (meta?.value !== hash) return undefined;

    // SAFETY: `cursor` holds only the records this module puts.
    const stored = (await requested(
      transaction.objectStore(STORE.CURSOR).get([name.read, workspace]),
    )) as CursorRecord | undefined;

    if (stored === undefined) return undefined;

    // SAFETY: `held` holds only the records this module puts.
    const held = (await requested(
      transaction
        .objectStore(STORE.HELD)
        .index(HELD_INDEX.ORDER)
        .getAll(readRange(keyRange, name.read, workspace)),
    )) as HeldRecord[];

    const row = transaction.objectStore(STORE.ROW);

    // SAFETY: `row` holds only the records this module puts.
    const records = (await Promise.all(
      held.map((record) => requested(row.get([record.kind, record.key]))),
    )) as (RowRecord | undefined)[];

    // Note that each row's JSON is parsed by `JSON.parse` itself, as `local-rows.ts` parses SQLite's, since a load reads thousands of them.
    const rows = records.flatMap((record) =>
      record === undefined ? [] : [JSON.parse(record.row)],
    );

    return { rows, cursor: stored.cursor === null ? undefined : JSON.parse(stored.cursor) };
  });
}

/** Clears the kept lists where `database` was kept at a schema hash other than `hash`, and keeps `hash`, in one transaction. */
function hashKept(database: IDBDatabase, hash: string): Promise<void> {
  return inTransaction(database, LOAD_STORES, "readwrite", async (transaction) => {
    const meta = transaction.objectStore(STORE.META);
    // SAFETY: `meta` holds only the records this module puts.
    const stored = (await requested(meta.get(META_KEY.SCHEMA_HASH))) as MetaRecord | undefined;

    if (stored?.value === hash) return;

    for (const store of ANSWER_STORES) transaction.objectStore(store).clear();
    const record: MetaRecord = { key: META_KEY.SCHEMA_HASH, value: hash };
    meta.put(record);
  });
}

/**
 * Asks for `name`'s lock if no tab holds it, for as long as the caller's
 * scope stands: whether this tab was granted it.
 */
function writerLock(locks: TabLocks | undefined, name: string) {
  return Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ readonly granted: boolean; readonly release: () => void }>((resolve) => {
          const held = Promise.withResolvers<void>();
          const release = () => held.resolve();

          if (locks === undefined) return resolve({ granted: false, release });

          locks
            .request(name, { ifAvailable: true }, (lock) => {
              resolve({ granted: lock !== null, release });

              return lock === null ? undefined : held.promise;
            })
            .catch(() => resolve({ granted: false, release }));
        }),
    ),
    ({ release }) => Effect.sync(release),
  );
}

/** The pool's rows store over `standing`, writing only while this tab writes and reading while the database is open. */
function tabRows(standing: Standing, keyRange: typeof IDBKeyRange, hash: string): RowsStore {
  return {
    answered: (answer) =>
      Effect.suspend(() => {
        if (!standing.writes || !standing.open) return Effect.void;

        return Effect.tryPromise(() => written(standing.database, keyRange, answer)).pipe(
          Effect.catch((failure) =>
            Effect.sync(() => {
              standing.writes = false;
            }).pipe(
              Effect.andThen(
                Effect.logWarning(
                  `the local rows of ${answer.read} were not written, and the tab writes no more: ${failure._tag}`,
                ),
              ),
            ),
          ),
        );
      }),
    loaded: (name) =>
      Effect.suspend(() => {
        if (!standing.open) return Effect.undefined;

        return Effect.tryPromise(() => loadedFrom(standing.database, keyRange, hash, name)).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(`the local rows of ${name.read} were not loaded: ${failure._tag}`),
              undefined,
            ),
          ),
        );
      }),
  };
}

/**
 * Deletes every account's store this browser keeps but `kept`'s: what a
 * sign-out from a page that runs no host (the admin dashboard) does, and
 * what an open does for every other account's. A delete that fails or
 * waits is left for the next, so this never fails.
 */
export async function forgetTabStores(databases: IDBFactory, kept?: string): Promise<void> {
  const keep = kept === undefined ? undefined : storeName(kept);
  const listed = await databases.databases().catch(() => []);

  await Promise.all(
    listed.flatMap(({ name }) =>
      name !== undefined && name !== keep && isStoreName(name)
        ? [requested(databases.deleteDatabase(name)).catch(() => undefined)]
        : [],
    ),
  );
}

/** The tab's store of the account's kept reads in IndexedDB, as the host's local copy opens it at sign-in and deletes it at sign-out. */
export function webLocalStore({
  databases,
  keyRange,
  locks,
}: WebLocalStoreSeam): LocalStoreBackendSeam {
  return {
    keepsCollections: false,
    open: (accountId) =>
      Effect.gen(function* () {
        const name = storeName(accountId);
        const failed = (cause: unknown) => new LocalDatabaseFailed({ accountId, cause });
        const hash = yield* keptRowsHash;
        // Note that the browser keeps only the store of the account signed in now, so one a session that ended with no tab open left behind goes at the next sign-in; its delete is not waited on, since a tab of that account still open lets it go only as it hears it.
        yield* Effect.sync(() => void forgetTabStores(databases, accountId));
        // Note that the lock is asked for before the database opens, so a tab writes only rows it loaded after it held the lock.
        const lock = yield* writerLock(locks, name);

        const database = yield* Effect.acquireRelease(
          Effect.tryPromise({ try: () => opened(databases, name), catch: failed }),
          (open) => Effect.sync(() => open.close()),
        );

        const standing: Standing = { database, writes: lock.granted, open: true };

        // Note that a sign-out in another tab deletes the database under this one, which must close for the delete to go on, and writes nothing more.
        database.onversionchange = () => {
          standing.open = false;
          database.close();
        };

        database.onclose = () => {
          standing.open = false;
        };

        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            standing.open = false;
          }),
        );

        if (standing.writes) {
          yield* Effect.tryPromise({ try: () => hashKept(database, hash), catch: failed });
        }

        return {
          rows: tabRows(standing, keyRange, hash),
          queues: undefined,
          collections: Effect.undefined,
        };
      }),
    forget: (accountId) =>
      Effect.tryPromise({
        try: () => requested(databases.deleteDatabase(storeName(accountId))),
        catch: (cause) => new LocalDatabaseFailed({ accountId, cause }),
      }).pipe(Effect.asVoid),
  };
}
