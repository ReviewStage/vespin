/**
 * entity-store.ts -- the file an older build kept the account's lists and queues in, sealed under the Keychain's key: read once at sign-in so the local database imports its queues, and carried until it has.
 *
 * The lists are kept in the account's local database (`local-copy.ts`), the
 * row writes waiting for the service in its outbox, and the messages the
 * service refused in its `refused` table (`local-queues.ts`). A file an
 * older build kept may still hold the writes (`queue`): the store hands
 * them out for the account's own file (`queue.entries`), for the local
 * database to import once, and carries them through every save until it
 * says they were imported (`queue.imported`), so a database that would not
 * open never leaves them nowhere on disk. So may the messages refused that
 * waited on the member's Retry, Edit, or Delete (`refused`), each in the
 * form the agents' record of messages on their way reads back
 * (`agent-queue-writes.ts`), which this file holds unread: handed out
 * (`refused.entries`) and carried the same way until the database says it
 * holds them (`refused.imported`). The lists such a file kept are never
 * read, and are written out of it by its next save.
 *
 * The file is `entities.sealed` beside `settings.json`, written whole
 * through a temporary file of its own (`writeSettingsFileAtomic`), sealed by
 * the account source's cipher, which on a Mac is the Keychain's
 * (`safeStorage`) and on an iPhone the app's native sealer under a key the
 * Keychain keeps (`xchacha-cipher.ts`), which seals straight to the file's
 * text; a host whose source hands no cipher, as a browser tab's, keeps none.
 * It names the account it was kept for, so a file of another account, or
 * one that will not open, is deleted and read as none. A store writes what
 * it carries `QUEUE_SETTLE` after it moves, at the moments the shell names
 * where it names any (`KeptListsDue`, the phone's app going to the
 * background), and once more as it closes; a sign-out forgets it, which
 * deletes the file.
 */

import type { QueuedEntry } from "@repo/sync";
import {
  Duration,
  Effect,
  Path,
  Queue,
  Result,
  Schema,
  type Scope,
  Semaphore,
  Stream,
} from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import { readSettingsFileText, writeSettingsFileAtomic } from "./effect/settings-store-io.js";
import type { SecretCipher } from "./settings-store.js";

/** The sealed file, beside the settings file in the state root. */
export const ENTITY_STORE_FILE_NAME = "entities.sealed";

/**
 * How long a store waits once what it carries moved before it writes it, so
 * a burst of moves is written once. Note that it is short, since what it
 * carries is what a crash would lose.
 */
const QUEUE_SETTLE = Duration.millis(500);

/** What the file names as its hash once it keeps no lists, which a build before reads as other row shapes and so reads its queues alone. */
const NO_LISTS = "none";

/** A row write waiting for the service, as the engine hands it out: its name, its key, and its input in its declaration's kept form. */
const queuedEntrySchema = Schema.Struct({
  name: Schema.String,
  key: Schema.String,
  input: Schema.Unknown,
});

/**
 * What the file holds: whose it is, the writes an older build kept waiting
 * until they are imported, and the messages refused. Note that it still
 * names a hash and the reads, kept empty, since a build before reads its
 * queues only from a file that names them.
 */
const keptSchema = Schema.Struct({
  hash: Schema.String,
  accountId: Schema.String,
  reads: Schema.Unknown,
  queue: Schema.optionalKey(Schema.Array(queuedEntrySchema)),
  refused: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

type Kept = typeof keptSchema.Type;

const decodeKept = Schema.decodeUnknownResult(Schema.fromJsonString(keptSchema));
const encodeKept = Schema.encodeEffect(Schema.fromJsonString(keptSchema));

/** The queues an older build kept in the account's file, carried until the local database imports them. */
export interface EntityStore {
  /** The row writes waiting for the service an older build kept in the account's own file, for the local database to import once; none where the file was there but would not read, so nothing is marked imported before it does. */
  readonly queue: SealedWrites | undefined;
  /** The messages the service refused an older build kept in the account's own file, for the local database to import once; none where the file was there but would not read. */
  readonly refused: SealedRefusals | undefined;
  /** Deletes the file and keeps nothing more, as a sign-out does. */
  readonly forget: Effect.Effect<void>;
}

/** The row writes an older build kept waiting in the file: carried through every save until `imported`, then never written again. */
export interface SealedWrites {
  /** The writes as the file held them when the store opened, oldest first. */
  readonly entries: readonly QueuedEntry[];
  /** Tells the store the local database holds them now, so its next save, written soon, leaves them out. */
  readonly imported: Effect.Effect<void>;
}

/** The messages the service refused an older build kept in the file: carried through every save until `imported`, then never written again. */
export interface SealedRefusals {
  /** As the file held them when the store opened, each in the form its reader kept it in. */
  readonly entries: readonly unknown[];
  /** Tells the store the local database holds them now, so its next save, written soon, leaves them out. */
  readonly imported: Effect.Effect<void>;
}

export interface EntityStoreOptions {
  /** The state root the settings file stands in. */
  readonly directory: string;
  /** The account source's cipher, which seals the file. */
  readonly cipher: SecretCipher;
  /** The account signed in, whose queues alone the file may hold. */
  readonly accountId: string;
  /** Each moment the shell asks the store written (`KeptListsDue`), as the store closing does. */
  readonly listsDue?: Stream.Stream<void>;
}

/** `plain` sealed as the file's text: in one step where the cipher seals to text itself, and as the base64 of its sealed bytes otherwise. */
function sealedText(cipher: SecretCipher, plain: string): string {
  return cipher.sealText?.(plain) ?? Base64.encode(cipher.encrypt(plain));
}

/** The file's text opened and read as far as its account, its older waiting writes, and its messages refused, or none where it will not open or is not a store's. */
function opened(cipher: SecretCipher, text: string): Kept | undefined {
  const sealed = text.trim();
  const { openText } = cipher;

  const plain =
    openText === undefined
      ? Result.flatMap(Base64.decode(sealed), (bytes) => Result.try(() => cipher.decrypt(bytes)))
      : Result.try(() => openText.call(cipher, sealed));

  if (Result.isFailure(plain)) return undefined;

  return Result.getOrUndefined(decodeKept(plain.success));
}

/** Deletes the file, a temporary one a cut-off write left beside it among it. */
const removed = Effect.fn("host/entityStoreRemoved")(function* (directory: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(directory, ENTITY_STORE_FILE_NAME);
  yield* Effect.ignore(fileSystem.remove(file, { force: true }));
  yield* Effect.ignore(fileSystem.remove(`${file}.tmp`, { force: true }));
});

/** Deletes the sealed file under `directory`, kept for whichever account, as a sign-out does where no store stands. */
export function forgetEntityStore(
  directory: string,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> {
  return removed(directory);
}

/**
 * The account's store for as long as the caller's scope stands: the file
 * read and opened, deleted where it is another account's or will not open;
 * what it carries written `QUEUE_SETTLE` after it moves, and once more as
 * the scope closes where it moved or the file still holds a build's lists,
 * unless it was forgotten.
 */
export function openEntityStore(
  options: EntityStoreOptions,
): Effect.Effect<EntityStore, never, FileSystem.FileSystem | Path.Path | Scope.Scope> {
  return Effect.gen(function* () {
    const { directory, cipher, accountId } = options;
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const textRead = yield* Effect.result(readSettingsFileText(directory, ENTITY_STORE_FILE_NAME));
    const text = Result.getOrUndefined(textRead);
    const read = text === undefined ? undefined : opened(cipher, text);
    const ours = read !== undefined && read.accountId === accountId;

    // Note that a file that is not this account's, or will not open, is deleted before anything reads it, so no other account's writes are ever sent.
    if (text !== undefined && !ours) yield* removed(directory);
    const legacyQueue: readonly QueuedEntry[] = ours ? (read.queue ?? []) : [];
    /** The older waiting writes each save still carries, until the local database imported them. */
    let queueCarried = legacyQueue;
    const refusedKept: readonly unknown[] = ours ? (read.refused ?? []) : [];
    /** The older messages refused each save still carries, until the local database imported them. */
    let refusedCarried = refusedKept;
    /** What the store carries, as one text a save compares. */
    const carriedNow = () => JSON.stringify([queueCarried, refusedCarried]);
    /** Whether the file still holds the lists a build before kept in it, which the next save, or the last, writes out. */
    let listsLeft = ours && read.hash !== NO_LISTS;
    let savedText = carriedNow();
    let forgotten = false;
    const lock = yield* Semaphore.make(1);

    const save = (closing: boolean) =>
      lock.withPermits(1)(
        Effect.suspend(() => {
          const carried = carriedNow();

          if (!((closing && listsLeft) || carried !== savedText) || forgotten) return Effect.void;
          const queue = queueCarried.length > 0 ? { queue: queueCarried } : undefined;
          const refused = refusedCarried.length > 0 ? { refused: refusedCarried } : undefined;

          return encodeKept({ hash: NO_LISTS, accountId, reads: {}, ...queue, ...refused }).pipe(
            Effect.map((plain) => sealedText(cipher, plain)),
            Effect.flatMap((sealed) =>
              writeSettingsFileAtomic(directory, sealed, undefined, ENTITY_STORE_FILE_NAME),
            ),
            // Note that what was written is marked saved only once the write lands, so one that failed is written again by the next save, or the last.
            Effect.tap(() =>
              Effect.sync(() => {
                listsLeft = false;
                savedText = carried;
              }),
            ),
            // Note that a failure is logged by its kind alone, since a message's words may be among its message.
            Effect.catch((failure) =>
              Effect.logWarning(`the entity store was not written: ${failure._tag}`),
            ),
            Effect.provideContext(services),
          );
        }),
      );

    /** Wakes the saver to look again, a burst of wakes waking it once. */
    const wake = yield* Queue.sliding<void>(1);
    const woken = Effect.asVoid(Queue.offer(wake, undefined));

    /**
     * The saver: once what the store carries moved, a save `QUEUE_SETTLE`
     * later; otherwise asleep until woken. Note that it ends once the store
     * is forgotten, since nothing it would save is kept.
     */
    const saver = Effect.gen(function* () {
      while (!forgotten) {
        if (carriedNow() === savedText) {
          yield* Queue.take(wake);
          continue;
        }

        yield* Effect.sleep(QUEUE_SETTLE);
        yield* Queue.clear(wake);
        yield* save(false);
      }
    });

    // Note that a moment the shell names writes the file as the store closing does, since the app may not run again before it is ended.
    if (options.listsDue !== undefined) {
      yield* Effect.forkScoped(
        Stream.runForEach(options.listsDue, () => save(true)),
        { startImmediately: true },
      );
    }

    yield* Effect.forkScoped(saver, { startImmediately: true });
    yield* Effect.addFinalizer(() => save(true));

    return {
      queue: Result.isFailure(textRead)
        ? undefined
        : {
            entries: legacyQueue,
            imported: Effect.suspend(() => {
              queueCarried = [];

              return woken;
            }),
          },
      refused: Result.isFailure(textRead)
        ? undefined
        : {
            entries: refusedKept,
            imported: Effect.suspend(() => {
              refusedCarried = [];

              return woken;
            }),
          },
      forget: lock.withPermits(1)(
        Effect.suspend(() => {
          forgotten = true;

          return Effect.andThen(woken, Effect.provideContext(removed(directory), services));
        }),
      ),
    };
  });
}
