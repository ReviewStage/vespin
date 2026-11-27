/**
 * local-database.ts -- the account's local SQLite database: the folder and file it stands in, the tables the sync engine's local copy keeps, and the one schema hash that clears its cached lists, written once over a synchronous driver seam each platform provides.
 *
 * Each account has its own database, `accounts/<account id>/local.sqlite`
 * under the state root, so no account opens another's rows: isolation
 * follows from the path. The file is readable by the user alone (mode
 * 0600, in a folder of mode 0700) and in WAL mode, and carries no
 * encryption of its own, as Linear's local copy carries none: the
 * device's disk encryption covers it.
 *
 * The tables are the sync engine's replica (`row`, `held`, `cursor`, as
 * `local-rows.ts` writes them), its
 * waiting writes (`outbox`), the agent messages the service refused
 * (`refused`), and `meta`, which holds one hash over every kept row shape
 * and their generation.
 * A build whose hash differs clears the replica, which the service redraws
 * at once, and keeps the two queues, as Linear keeps one schema hash and
 * re-reads from the server.
 *
 * The SQL is driven through `LocalDatabaseDriver`, a context service the
 * platform's launch provides: Node's `node:sqlite` on the Mac
 * (`@repo/host/node`) and `expo-sqlite` on the iPhone. A host given none
 * keeps no store and runs in memory. Nothing here imports a Node module,
 * since the iPhone bundle loads it.
 *
 * Where the platform keeps collections on disk, two more files stand in the
 * account's folder beside it: the collections (`collections.sqlite`) and
 * the words their Inbox messages say (`words.sqlite`, `kept-words.ts`),
 * each driven through the platform's async API.
 */

import { AUTOMATIONS_READ } from "@repo/features/automation-live";
import { TASK_LIST_READ } from "@repo/features/task-list-live";
import {
  agentSectionEntrySchema,
  taskSectionEntrySchema,
  taskSectionSchema,
} from "@repo/features/task-section-wire";
import { repositoryPinSchema } from "@repo/features/task-wire";
import { WORKSPACE_INVITATIONS_READ, WORKSPACE_MEMBERS_READ } from "@repo/features/workspace-live";
import { workspaceSchema } from "@repo/features/workspace-wire";
import type { KeepCollection, StoredKind } from "@repo/sync";
import { Context, Data, Effect, Path, Schema, type Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import { placedInboxItemSchema } from "./inbox-collections.js";
import {
  type KeptWords,
  type KeptWordsDatabase,
  keptWordsIn,
  keptWordsInMemory,
  keptWordsOnceOpen,
} from "./kept-words.js";

/** The folder every account's own folder stands in, under the state root. */
const ACCOUNTS_FOLDER = "accounts";

/** The database's file, in the account's folder. */
const DATABASE_FILE = "local.sqlite";

/** The file the account's collections kept on disk whole stand in, beside the database, so its writes never wait on the database's. */
const COLLECTIONS_FILE = "collections.sqlite";

/** The file the words each kept Inbox message says stand in, beside the collections, which a search reads (`kept-words.ts`). */
const WORDS_FILE = "words.sqlite";

/** The account's folder, which only the user may enter. */
const FOLDER_MODE = 0o700;

/** The database's file, which only the user may read or write; SQLite gives its WAL and shared-memory files the same mode. */
const FILE_MODE = 0o600;

/** The keys `meta` holds. */
export const META_KEY = {
  SCHEMA_HASH: "schemaHash",
} as const;

/** The tables, created where they stand not. */
const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS row (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  row TEXT NOT NULL,
  PRIMARY KEY (kind, key)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS held (
  read TEXT NOT NULL,
  workspace TEXT NOT NULL,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (read, workspace, key)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS held_row ON held (kind, key);
CREATE TABLE IF NOT EXISTS cursor (
  read TEXT NOT NULL,
  workspace TEXT NOT NULL,
  cursor TEXT,
  PRIMARY KEY (read, workspace)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  input TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS refused (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  entry TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
`;

/** The cached lists a moved schema hash clears; `outbox` and `refused` are the account's own and stay. */
const CLEAR_CACHED_LISTS = `
DELETE FROM row;
DELETE FROM held;
DELETE FROM cursor;
`;

/**
 * Every row shape the database keeps, as the seven kept reads take them
 * from the service. A build that changes any of them changes the hash, and
 * the lists kept at the old shapes are cleared.
 */
const keptRowsSchema = Schema.Struct({
  taskList: TASK_LIST_READ.rows,
  sections: Schema.Array(taskSectionSchema),
  sectionEntries: Schema.Array(taskSectionEntrySchema),
  agentSectionEntries: Schema.Array(agentSectionEntrySchema),
  pins: Schema.Array(repositoryPinSchema),
  workspaces: Schema.Array(workspaceSchema),
  members: WORKSPACE_MEMBERS_READ.rows,
  invitations: WORKSPACE_INVITATIONS_READ.rows,
  automations: AUTOMATIONS_READ.rows,
  inbox: Schema.Array(placedInboxItemSchema),
});

/**
 * The generation of the kept rows, hashed beside their shapes, moved where a
 * list kept at the current shapes still has to be read again. Note that a
 * field a kept read starts to carry (`TASK_LIST_READ`'s agent `kind`, #10159)
 * moves the hash when its build ships, but a build that ran before the
 * service carried it kept every row without it, and a delta past its sync id
 * carries only the rows that moved, so a Manager that stood still read as a
 * coder. Moved to 2 for that: the rows those builds kept are read again.
 */
const KEPT_ROWS_GENERATION = 2;

/** A value a statement binds or a row answers. */
export type LocalDatabaseValue = null | number | bigint | string | Uint8Array;

/** One prepared statement. */
export interface LocalDatabaseStatement {
  /** Runs the statement for its effect. */
  readonly run: (...parameters: readonly LocalDatabaseValue[]) => void;
  /** Runs the statement and answers every row, each keyed by column name. */
  readonly all: (
    ...parameters: readonly LocalDatabaseValue[]
  ) => readonly Readonly<Record<string, LocalDatabaseValue>>[];
}

/** One open database. Every call is synchronous and throws on failure. */
export interface LocalDatabaseConnection {
  /** Runs one or more statements that bind nothing. */
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => LocalDatabaseStatement;
  readonly close: () => void;
}

/** A database of collections kept on disk whole, as the platform opened it: how a stored kind's collection is kept in it, and its close. */
export interface KeptCollectionsDatabase {
  readonly keep: (stored: StoredKind) => KeepCollection;
  readonly close: () => Promise<void>;
}

/** The platform's SQLite: opens the database at `file`, creating it where it stands not, or throws. */
export interface LocalDatabaseDriverSeam {
  readonly open: (file: string) => LocalDatabaseConnection;
  /**
   * Opens the database of collections kept on disk whole at `file` through
   * TanStack DB's persistence for the platform, or rejects; none where the
   * platform keeps every kind in memory, as the Mac does.
   */
  readonly collections?: (file: string) => Promise<KeptCollectionsDatabase>;
  /**
   * Opens the database at `file` through the platform's async API, whose
   * statements run off the JavaScript thread, or rejects: where the kept
   * messages' words stand beside the collections (`kept-words.ts`). None
   * where the platform keeps no collections; where it keeps them and gives
   * none, the words are kept in memory.
   */
  readonly words?: (file: string) => Promise<KeptWordsDatabase>;
}

export type { KeptWordsDatabase } from "./kept-words.js";

/** The account's kept collections as they opened: how a stored kind's collection is kept, and the words its kept messages say. */
export interface KeptCollections {
  readonly keep: KeptCollectionsDatabase["keep"];
  readonly words: KeptWords;
}

/** The SQLite driver the platform's launch provides; a host given none keeps no local database. */
export class LocalDatabaseDriver extends Context.Service<
  LocalDatabaseDriver,
  LocalDatabaseDriverSeam
>()("@repo/host/LocalDatabaseDriver") {}

/** The account's database would not open or be forgotten: its folder, its file, the driver's binding, or its SQL failed. */
export class LocalDatabaseFailed extends Data.TaggedError("LocalDatabaseFailed")<{
  readonly accountId: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return "The account's local database is unavailable.";
  }
}

/** The SHA-256, in hex, of every kept row shape's JSON Schema and their generation (`KEPT_ROWS_GENERATION`). */
const keptRowsHash: Effect.Effect<string> = Effect.map(
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify({
          generation: KEPT_ROWS_GENERATION,
          rows: Schema.toJsonSchemaDocument(keptRowsSchema),
        }),
      ),
    ),
  ),
  (digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
);

/** The account's folder under `stateRoot`, refusing an id that would name any other. */
const accountFolder = Effect.fn("host/localDatabaseFolder")(function* (
  stateRoot: string,
  accountId: string,
) {
  const path = yield* Path.Path;

  // Note that an id is only ever one plain segment, because one that climbed out would open another folder's database.
  if (
    accountId === "" ||
    accountId === "." ||
    accountId === ".." ||
    path.basename(accountId) !== accountId
  )
    return yield* new LocalDatabaseFailed({ accountId, cause: "not one path segment" });

  return path.join(stateRoot, ACCOUNTS_FOLDER, accountId);
});

/** Creates the tables, sets WAL, and clears the cached lists where the stored schema hash is not `hash`, in one transaction. */
function prepared(connection: LocalDatabaseConnection, hash: string): void {
  connection.exec("PRAGMA journal_mode = WAL;");
  connection.exec("PRAGMA synchronous = NORMAL;");
  connection.exec("BEGIN IMMEDIATE;");

  try {
    connection.exec(CREATE_TABLES);

    const [stored] = connection
      .prepare("SELECT value FROM meta WHERE key = ?")
      .all(META_KEY.SCHEMA_HASH);

    if (stored?.value !== hash) {
      connection.exec(CLEAR_CACHED_LISTS);
      connection
        .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
        .run(META_KEY.SCHEMA_HASH, hash);
    }

    connection.exec("COMMIT;");
  } catch (cause) {
    connection.exec("ROLLBACK;");
    throw cause;
  }
}

/**
 * Opens `accountId`'s database under `stateRoot` for as long as the
 * caller's scope stands, closing it as the scope closes: its folder and
 * file created readable by the user alone, its tables created, and its
 * cached lists cleared where they were kept at other row shapes. Fails as
 * `LocalDatabaseFailed` where the folder, the file, the driver, or its
 * SQL fails, so the caller runs in memory instead.
 */
export const openLocalDatabase = Effect.fn("host/openLocalDatabase")(function* (
  stateRoot: string,
  accountId: string,
): Effect.fn.Return<
  LocalDatabaseConnection,
  LocalDatabaseFailed,
  LocalDatabaseDriver | FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const driver = yield* LocalDatabaseDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* accountFolder(stateRoot, accountId);
  const file = path.join(folder, DATABASE_FILE);
  const hash = yield* keptRowsHash;
  const failed = (cause: unknown) => new LocalDatabaseFailed({ accountId, cause });

  // Note that the file is made, or narrowed, to the user alone before SQLite opens it, because SQLite creates its WAL files with the database's mode.
  yield* Effect.gen(function* () {
    yield* fileSystem.makeDirectory(folder, { recursive: true, mode: FOLDER_MODE });
    yield* fileSystem.chmod(folder, FOLDER_MODE);

    if (!(yield* fileSystem.exists(file)))
      yield* fileSystem.writeFile(file, new Uint8Array(), { flag: "wx", mode: FILE_MODE });
    yield* fileSystem.chmod(file, FILE_MODE);
  }).pipe(Effect.mapError(failed));

  return yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const connection = driver.open(file);

        try {
          prepared(connection, hash);
        } catch (cause) {
          connection.close();
          throw cause;
        }

        return connection;
      },
      catch: failed,
    }),
    (connection) => Effect.sync(() => connection.close()),
  );
});

/**
 * Opens `accountId`'s database of collections kept on disk whole under
 * `stateRoot`, and the words its kept messages say beside it, for as long
 * as the caller's scope stands, closing both as the scope closes, each file
 * readable by the user alone as the database's is; none where the platform
 * keeps none. Fails as `LocalDatabaseFailed` where the folder, a file, or
 * the platform's persistence fails, so the caller keeps every kind, and the
 * words, in memory instead.
 */
export const openKeptCollections = Effect.fn("host/openKeptCollections")(function* (
  stateRoot: string,
  accountId: string,
): Effect.fn.Return<
  KeptCollections | undefined,
  LocalDatabaseFailed,
  LocalDatabaseDriver | FileSystem.FileSystem | Path.Path | Scope.Scope
> {
  const { collections, words } = yield* LocalDatabaseDriver;

  if (collections === undefined) return undefined;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* accountFolder(stateRoot, accountId);
  const failed = (cause: unknown) => new LocalDatabaseFailed({ accountId, cause });

  /** `name`'s file in the account's folder, made readable by the user alone where it stands not. */
  const placedFile = (name: string) =>
    Effect.gen(function* () {
      const file = path.join(folder, name);

      if (!(yield* fileSystem.exists(file)))
        yield* fileSystem.writeFile(file, new Uint8Array(), { flag: "wx", mode: FILE_MODE });
      yield* fileSystem.chmod(file, FILE_MODE);

      return file;
    }).pipe(Effect.mapError(failed));

  const file = yield* placedFile(COLLECTIONS_FILE);

  const opened = yield* Effect.acquireRelease(
    Effect.tryPromise({ try: () => collections(file), catch: failed }),
    (database) => Effect.promise(() => database.close()),
  );

  if (words === undefined) return { keep: opened.keep, words: keptWordsInMemory() };
  const wordsFile = yield* placedFile(WORDS_FILE);

  // Note that the words' database opens beside the launch rather than before it, since no first read waits on a search, so the kept Inbox is told as soon as the collections are.
  const wordsDatabase = words(wordsFile);
  // Note that a database that will not open is closed as nothing, its failure each call's own (`keptWordsOnceOpen`).
  wordsDatabase.catch(() => undefined);

  yield* Effect.addFinalizer(() =>
    Effect.promise(() =>
      wordsDatabase.then(
        (database) => database.close(),
        () => undefined,
      ),
    ),
  );

  const keptWords = wordsDatabase.then(keptWordsIn);
  keptWords.catch(() => undefined);

  return { keep: opened.keep, words: keptWordsOnceOpen(keptWords) };
});

/** Deletes `accountId`'s folder under `stateRoot`, its database and WAL files among it, as a sign-out does; one that stands not is already forgotten. */
export const forgetLocalDatabase = Effect.fn("host/forgetLocalDatabase")(function* (
  stateRoot: string,
  accountId: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const folder = yield* accountFolder(stateRoot, accountId);

  yield* fileSystem
    .remove(folder, { recursive: true, force: true })
    .pipe(Effect.mapError((cause) => new LocalDatabaseFailed({ accountId, cause })));
});
