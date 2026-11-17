/**
 * entity-store.ts -- the account's waiting writes kept on disk between launches, sealed under the Keychain's key, read back at the next launch so they are sent again.
 *
 * It keeps the row writes made while the service could not be reached, as
 * the sync engine hands them out (`EntityPool.queued`) and takes them back
 * at the next launch (`requeue`): each a write's name, its idempotency key,
 * and its input. It keeps the messages the service refused that wait on the
 * member's Retry, Edit, or Delete too, as the agents' record of messages on
 * their way hands them out (`agent-queue-writes.ts`): their words, their
 * key, their files' names, and why they did not go, each kept in the form
 * that record reads back, which this file holds unread. The lists are kept
 * in the account's local database (`local-copy.ts`) instead, and a file a
 * build before kept them in is read for its queues alone.
 *
 * The file is `entities.sealed` beside `settings.json`, written whole
 * through a temporary file of its own (`writeSettingsFileAtomic`), sealed by
 * the account source's cipher, which on a Mac is the Keychain's
 * (`safeStorage`) and on an iPhone the app's native sealer under a key the
 * Keychain keeps (`xchacha-cipher.ts`), which seals straight to the file's
 * text; a host whose source hands no cipher, as a browser tab's, keeps none.
 * It names the account it was kept for, so a file of another account, or
 * one that will not open, is deleted and read as none. A store writes the
 * queues `QUEUE_SETTLE` after they move, at the moments the shell names
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

/** What the file names as its hash once it keeps no lists, which a build before reads as other row shapes and so reads its queues alone. */
const NO_LISTS = "none";

/**
 * How long a store waits once the writes waiting for the service moved
 * before it writes them, so a burst of them is written once. Note that it is
 * short, since they are what a crash would lose.
 */
const QUEUE_SETTLE = Duration.millis(500);

/** A row write waiting for the service, as the engine hands it out: its name, its key, and its input in its declaration's kept form. */
const queuedEntrySchema = Schema.Struct({
  name: Schema.String,
  key: Schema.String,
  input: Schema.Unknown,
});

/**
 * What the file holds: whose it is, the writes waiting, and the messages
 * refused. Note that it still names a hash and the reads, kept empty, since
 * a build before reads its queues only from a file that names them.
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

/** The account's waiting writes as they were kept, written as they move. */
export interface EntityStore {
  /** The row writes waiting for the service as the file held them when the store opened, oldest first. */
  readonly queue: readonly QueuedEntry[];
  /** The messages the service refused as the file held them when the store opened, each in the form its reader kept it in. */
  readonly refused: readonly unknown[];
  /** Deletes the file and keeps nothing more, as a sign-out does. */
  readonly forget: Effect.Effect<void>;
}

export interface EntityStoreOptions {
  /** The state root the settings file stands in. */
  readonly directory: string;
  /** The account source's cipher, which seals the file. */
  readonly cipher: SecretCipher;
  /** The account signed in, whose lists alone the file may hold. */
  readonly accountId: string;
  /** The row writes waiting for the service now, oldest first, which every save keeps beside the lists. */
  readonly queued?: () => readonly QueuedEntry[];
  /** Each moving of `queued`, which has the store write them `QUEUE_SETTLE` later. */
  readonly queueMoves?: Stream.Stream<void>;
  /** The messages the service refused now, each in the form its reader keeps it in, which every save keeps beside the writes waiting. */
  readonly refused?: () => readonly unknown[];
  /** Each moving of `refused`, which has the store write them `QUEUE_SETTLE` later. */
  readonly refusedMoves?: Stream.Stream<void>;
  /** Each moment the shell asks the store written (`KeptListsDue`), as the store closing does. */
  readonly listsDue?: Stream.Stream<void>;
}

/** `plain` sealed as the file's text: in one step where the cipher seals to text itself, and as the base64 of its sealed bytes otherwise. */
function sealedText(cipher: SecretCipher, plain: string): string {
  return cipher.sealText?.(plain) ?? Base64.encode(cipher.encrypt(plain));
}

/** The file's text opened and read as far as its account and its waiting writes, or none where it will not open or is not a store's. */
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
 * the queues written `QUEUE_SETTLE` after they move, and once more as the
 * scope closes where they moved or the file still holds a build's lists,
 * unless it was forgotten.
 */
export function openEntityStore(
  options: EntityStoreOptions,
): Effect.Effect<EntityStore, never, FileSystem.FileSystem | Path.Path | Scope.Scope> {
  return Effect.gen(function* () {
    const { directory, cipher, accountId } = options;
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

    const text = yield* Effect.orElseSucceed(
      readSettingsFileText(directory, ENTITY_STORE_FILE_NAME),
      () => undefined,
    );

    const read = text === undefined ? undefined : opened(cipher, text);
    const ours = read !== undefined && read.accountId === accountId;

    // Note that a file that is not this account's is deleted before anything reads it, so no other account's writes are ever sent.
    if (text !== undefined && !ours) yield* removed(directory);
    const queue: readonly QueuedEntry[] = ours ? (read.queue ?? []) : [];
    const queued = options.queued ?? (() => queue);
    const refusedKept: readonly unknown[] = ours ? (read.refused ?? []) : [];
    const refusedNow = options.refused ?? (() => refusedKept);
    /** What waits on the member or the service, the writes waiting and the messages refused, as one text a save compares. */
    const waitingNow = () => JSON.stringify([queued(), refusedNow()]);
    /** Whether the file still holds the lists a build before kept in it, which the next save, or the last, writes out. */
    let listsLeft = ours && read.hash !== NO_LISTS;
    let savedQueue = JSON.stringify([queue, refusedKept]);
    let forgotten = false;
    const lock = yield* Semaphore.make(1);

    const save = (closing: boolean) =>
      lock.withPermits(1)(
        Effect.suspend(() => {
          const waiting = queued();
          const refused = refusedNow();
          const waitingText = JSON.stringify([waiting, refused]);

          if (!((closing && listsLeft) || waitingText !== savedQueue) || forgotten) {
            return Effect.void;
          }

          listsLeft = false;
          savedQueue = waitingText;

          return encodeKept({
            hash: NO_LISTS,
            accountId,
            reads: {},
            queue: waiting,
            refused,
          }).pipe(
            Effect.map((plain) => sealedText(cipher, plain)),
            Effect.flatMap((sealed) =>
              writeSettingsFileAtomic(directory, sealed, undefined, ENTITY_STORE_FILE_NAME),
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
     * The saver: once the writes waiting moved, a save `QUEUE_SETTLE` later;
     * otherwise asleep until woken. Note that it ends once the store is
     * forgotten, since nothing it would save is kept.
     */
    const saver = Effect.gen(function* () {
      while (!forgotten) {
        if (waitingNow() === savedQueue) {
          yield* Queue.take(wake);
          continue;
        }

        yield* Effect.sleep(QUEUE_SETTLE);
        yield* Queue.clear(wake);
        yield* save(false);
      }
    });

    if (options.queueMoves !== undefined) {
      yield* Effect.forkScoped(
        Stream.runForEach(options.queueMoves, () => woken),
        {
          startImmediately: true,
        },
      );
    }

    if (options.refusedMoves !== undefined) {
      yield* Effect.forkScoped(
        Stream.runForEach(options.refusedMoves, () => woken),
        { startImmediately: true },
      );
    }

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
      queue,
      refused: refusedKept,
      forget: lock.withPermits(1)(
        Effect.suspend(() => {
          forgotten = true;

          return Effect.andThen(woken, Effect.provideContext(removed(directory), services));
        }),
      ),
    };
  });
}
