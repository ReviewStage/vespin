/**
 * entity-store.ts -- the account's lists kept on disk between launches, sealed under the Keychain's key: what each kept read last answered, read back at the next launch so the lists draw before the service answers.
 *
 * Only the reads `KEPT_READ` names are kept, and each as the service
 * answered it, never with a write drawn over it: the task list's plans and
 * agents with the sync id they were read at, which its follow reads past,
 * the sidebar's sections, the tasks and agents in them, and its pinned
 * repositories, the account's workspaces with their GitHub installations,
 * and, for each workspace a window followed them in, its members and those
 * who left, its pending invitations with the origin their accept links are
 * built on, and its automations with their latest runs; and the Inbox: the
 * threads the account reaches as its follow last took them, the first in
 * the order a plan's list draws them that fit in `KEPT_CHARACTERS`
 * (`account-items-follow.ts`), each with the plan it is on, its title, who
 * it waits on, and its messages' words and files' names as its thread
 * carries them (the latest `INBOX_BOUNDS.MAX_MESSAGES_READ`), never a
 * file's bytes, with the sync id they were read at where they are every
 * thread. None of them holds a credential, and an automation's row holds
 * no webhook's body or secret. Every other read the host holds stays in memory, among them
 * transcripts, descriptions, pages, comments, browser tabs, Mac commands,
 * Terminal bytes, pictures, devices, and every credential's standing.
 *
 * The file is `entities.sealed` beside `settings.json`, written whole
 * through a temporary file of its own (`writeSettingsFileAtomic`), sealed by
 * the account source's cipher, which on a Mac is the Keychain's
 * (`safeStorage`) and on an iPhone the app's native sealer under a key the
 * Keychain keeps (`xchacha-cipher.ts`), which seals straight to the file's
 * text; a host whose source hands no cipher, as a browser tab's,
 * keeps none. It names the account it was kept for and a hash of the row
 * shapes it was kept at: a file of another account, or one that will not
 * open, is deleted and read as none, and every read reads whole; one kept at
 * another build's shapes keeps each read, Inbox item and workspace's rows that
 * still reads (`tolerantReads`), so an update that changes one shape costs
 * only its rows, and those are read whole. A store saves lists that moved at most every
 * `SAVE_EVERY`, or only at the moments the shell names where it names any
 * (`KeptListsDue`, the phone's app going to the background), the messages
 * refused `QUEUE_SETTLE` after they move, and both once more as it closes;
 * a sign-out forgets it,
 * which deletes the file. Rows
 * kept where none of them moved but where they stand (`keepUnmoved`), as the
 * task list's sync id moving alone, are written only beside the next save of
 * something that moved, and as the store closes. Note that a file left
 * behind at an older sync id reads right, because a read past an id answers
 * every row that moved since it, and the rows the file kept at that id are
 * the very rows the service held there.
 *
 * The row writes waiting for the service are kept in the local database's
 * outbox alone, and the messages the service refused in its `refused`
 * table (`local-queues.ts`). A file an older build kept may still
 * hold them (`queue`): the store hands them out for the account's own file
 * (`queue.entries`), for the local database to import once, and carries
 * them through every save until it says they were imported
 * (`queue.imported`), so a database that would not open never leaves them
 * nowhere on disk. So may the messages refused that waited on the member's
 * Retry, Edit, or Delete (`refused`), each in the form the agents' record
 * of messages on their way reads back (`agent-queue-writes.ts`), which this
 * file holds unread: handed out (`refused.entries`) and carried the same
 * way until the database says it holds them (`refused.imported`).
 */

import { AUTOMATIONS_READ } from "@repo/features/automation-live";
import { inboxItemSchema } from "@repo/features/inbox-wire";
import { TASK_LIST_READ } from "@repo/features/task-list-live";
import {
  agentSectionEntrySchema,
  taskSectionEntrySchema,
  taskSectionSchema,
} from "@repo/features/task-section-wire";
import { repositoryPinSchema } from "@repo/features/task-wire";
import { WORKSPACE_INVITATIONS_READ, WORKSPACE_MEMBERS_READ } from "@repo/features/workspace-live";
import { workspaceSchema } from "@repo/features/workspace-wire";
import type { QueuedEntry } from "@repo/sync";
import { isRecord, type UnparsedWireValue } from "@repo/wire";
import {
  Clock,
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
 * How often, at most, a store writes lists that moved. Note that it is long,
 * because each write seals the whole file again and the task list moves
 * about once a second while agents work, and that a crash between two saves
 * costs only a launch drawing the lists a little older until the service
 * answers.
 */
const SAVE_EVERY = Duration.seconds(30);

/**
 * How long a store waits once the messages refused moved before it writes
 * them, so a burst of them is written once. Note that it is short, since
 * they are what a crash would lose.
 */
const QUEUE_SETTLE = Duration.millis(500);

/** The reads whose rows are kept on disk, and the only ones: a read not named here stays in memory. */
export const KEPT_READ = {
  TASK_LIST: "taskList",
  SIDEBAR: "sidebar",
  WORKSPACES: "workspaces",
  MEMBERS: "members",
  INVITATIONS: "invitations",
  AUTOMATIONS: "automations",
  INBOX: "inbox",
} as const;

type KeptRead = (typeof KEPT_READ)[keyof typeof KEPT_READ];

/** The kept reads held per workspace, each workspace's rows under its id. */
type KeptByWorkspace =
  | typeof KEPT_READ.MEMBERS
  | typeof KEPT_READ.INVITATIONS
  | typeof KEPT_READ.AUTOMATIONS;

/** One workspace's invitations as the file keeps them, with the origin they were read from. */
const keptInvitationsSchema = Schema.Struct({
  origin: Schema.String,
  invitations: WORKSPACE_INVITATIONS_READ.rows.fields.invitations,
});

/** One Inbox item as the file keeps it, with the plan it is on. */
const keptInboxItemSchema = Schema.Struct({ item: inboxItemSchema, taskId: Schema.String });

/** Each kept read's rows as the file keeps them: what its follow last answered, the task list's and the Inbox's with the sync id they were read at. */
const keptRowsSchema = Schema.Struct({
  [KEPT_READ.TASK_LIST]: Schema.Struct({
    rows: TASK_LIST_READ.rows,
    at: Schema.String,
    /** The workspaces the answer said hold any task, where it said; absent from a file kept before they were. */
    taskWorkspaces: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  [KEPT_READ.SIDEBAR]: Schema.Struct({
    sections: Schema.Array(taskSectionSchema),
    entries: Schema.Array(taskSectionEntrySchema),
    agentEntries: Schema.Array(agentSectionEntrySchema),
    pins: Schema.Array(repositoryPinSchema),
  }),
  [KEPT_READ.WORKSPACES]: Schema.Array(workspaceSchema),
  [KEPT_READ.MEMBERS]: Schema.Record(Schema.String, WORKSPACE_MEMBERS_READ.rows),
  [KEPT_READ.INVITATIONS]: Schema.Record(Schema.String, keptInvitationsSchema),
  [KEPT_READ.AUTOMATIONS]: Schema.Record(Schema.String, AUTOMATIONS_READ.rows),
  [KEPT_READ.INBOX]: Schema.Struct({
    /** The first items the follow held, as it took them from the service, each with the plan it is on. */
    items: Schema.Array(keptInboxItemSchema),
    /** The sync id the items were read at, kept only where they are every item the follow held, so the next launch reads past it; absent where the follow kept only its first ones, and reads whole. */
    at: Schema.optionalKey(Schema.String),
  }),
});

/** Each kept read's rows, as a read hands them to the store and takes them back. */
export type KeptRows = typeof keptRowsSchema.Type;

/** A row write waiting for the service as an older build kept it here: its name, its key, and its input in its declaration's kept form. */
const queuedEntrySchema = Schema.Struct({
  name: Schema.String,
  key: Schema.String,
  input: Schema.Unknown,
});

/** Every read's rows, each optional, since a read that never answered keeps nothing. */
const keptReadsSchema = Schema.Struct({
  [KEPT_READ.TASK_LIST]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.TASK_LIST]),
  [KEPT_READ.SIDEBAR]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.SIDEBAR]),
  [KEPT_READ.WORKSPACES]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.WORKSPACES]),
  [KEPT_READ.MEMBERS]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.MEMBERS]),
  [KEPT_READ.INVITATIONS]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.INVITATIONS]),
  [KEPT_READ.AUTOMATIONS]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.AUTOMATIONS]),
  [KEPT_READ.INBOX]: Schema.optionalKey(keptRowsSchema.fields[KEPT_READ.INBOX]),
});

/** What the file holds once opened: whose it is, the shapes its rows were kept at, the rows, the writes an older build kept waiting until they are imported, and the messages refused. */
const keptSchema = Schema.Struct({
  hash: Schema.String,
  accountId: Schema.String,
  reads: keptReadsSchema,
  queue: Schema.optionalKey(Schema.Array(queuedEntrySchema)),
  refused: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

/** The file opened as far as its account, the writes an older build kept waiting in it, and its messages refused, whatever shapes its rows were kept at. */
const envelopeSchema = Schema.Struct({
  hash: Schema.String,
  accountId: Schema.String,
  reads: Schema.Unknown,
  queue: Schema.optionalKey(Schema.Array(queuedEntrySchema)),
  refused: Schema.optionalKey(Schema.Array(Schema.Unknown)),
});

type Envelope = typeof envelopeSchema.Type;

const decodeEnvelope = Schema.decodeUnknownResult(Schema.fromJsonString(envelopeSchema));
const decodeReads = Schema.decodeUnknownResult(keptReadsSchema);

/** What of a kept read still read at these shapes, and how many of its rows didn't. */
interface Tolerated<Rows> {
  readonly rows: Rows;
  readonly dropped: number;
}

/** What of a file's reads still read at these shapes, and how many reads, Inbox items or workspaces' rows didn't. */
interface ToleratedReads {
  readonly reads: Partial<KeptRows>;
  readonly dropped: number;
}

/** `value` as `schema` reads it, or none where it doesn't. */
function decodedAs<Type>(
  schema: Schema.Codec<Type, unknown>,
  value: UnparsedWireValue,
): Type | undefined {
  return Result.getOrUndefined(Schema.decodeUnknownResult(schema)(value));
}

/** A record's entries each read as `schema`, those that don't read left out; none where `value` is no record. */
function entriesAs<Type>(
  schema: Schema.Codec<Type, unknown>,
  value: UnparsedWireValue,
): Tolerated<Record<string, Type>> | undefined {
  if (!isRecord(value)) return undefined;
  const rows: Record<string, Type> = {};
  let dropped = 0;

  for (const [key, entry] of Object.entries(value)) {
    const row = decodedAs(schema, entry);

    if (row === undefined) dropped += 1;
    else rows[key] = row;
  }

  return { rows, dropped };
}

/** The kept Inbox read: each item read on its own, those that don't read left out, and its sync id kept only where every item read. */
function keptInboxOf(
  value: UnparsedWireValue,
): Tolerated<KeptRows[typeof KEPT_READ.INBOX]> | undefined {
  if (!isRecord(value) || !Array.isArray(value.items)) return undefined;
  const items = value.items.flatMap((each) => decodedAs(keptInboxItemSchema, each) ?? []);
  const dropped = value.items.length - items.length;
  const at = decodedAs(Schema.String, value.at);

  // Note that the sync id goes with any item left out, since a read past it answers only items that moved, and one left out that never moves would never be answered again.
  return { rows: dropped === 0 && at !== undefined ? { items, at } : { items }, dropped };
}

/**
 * The reads a file kept at other row shapes, each read on its own, and
 * within the Inbox each item, and within a read kept per workspace each
 * workspace's rows, so a build that changes one shape costs only the rows of
 * it that no longer read: the rest are drawn at once, and the reads left out
 * are read whole from the service, as a fresh install's are. Counts how many
 * reads, items or workspaces' rows were left out beside what read.
 */
function tolerantReads(value: UnparsedWireValue): ToleratedReads {
  if (!isRecord(value)) return { reads: {}, dropped: 0 };
  const fields = keptRowsSchema.fields;
  let dropped = 0;

  /** `read` as its own shape reads it whole, counted as left out where it was kept and doesn't read. */
  const whole = <Read extends KeptRead>(
    read: Read,
    schema: Schema.Codec<KeptRows[Read], unknown>,
  ) => {
    const kept = value[read];

    if (kept === undefined) return undefined;
    const rows = decodedAs(schema, kept);

    if (rows === undefined) dropped += 1;

    return rows;
  };

  /** `read` kept per workspace, each workspace's rows read on their own. */
  const byWorkspace = <Row>(read: KeptByWorkspace, schema: Schema.Codec<Row, unknown>) => {
    const kept = value[read];

    if (kept === undefined) return undefined;
    const entries = entriesAs(schema, kept);
    dropped += entries?.dropped ?? 1;

    return entries?.rows;
  };

  const keptInbox = value[KEPT_READ.INBOX];
  const inbox = keptInbox === undefined ? undefined : keptInboxOf(keptInbox);
  dropped += keptInbox === undefined ? 0 : (inbox?.dropped ?? 1);

  const taskList = whole(KEPT_READ.TASK_LIST, fields[KEPT_READ.TASK_LIST]);
  const sidebar = whole(KEPT_READ.SIDEBAR, fields[KEPT_READ.SIDEBAR]);
  const workspaces = whole(KEPT_READ.WORKSPACES, fields[KEPT_READ.WORKSPACES]);
  const members = byWorkspace(KEPT_READ.MEMBERS, WORKSPACE_MEMBERS_READ.rows);
  const invitations = byWorkspace(KEPT_READ.INVITATIONS, keptInvitationsSchema);
  const automations = byWorkspace(KEPT_READ.AUTOMATIONS, AUTOMATIONS_READ.rows);

  // Note that a read left out stands absent, as a read that never answered does.
  const reads: Partial<KeptRows> = {
    ...(taskList === undefined ? undefined : { [KEPT_READ.TASK_LIST]: taskList }),
    ...(sidebar === undefined ? undefined : { [KEPT_READ.SIDEBAR]: sidebar }),
    ...(workspaces === undefined ? undefined : { [KEPT_READ.WORKSPACES]: workspaces }),
    ...(members === undefined ? undefined : { [KEPT_READ.MEMBERS]: members }),
    ...(invitations === undefined ? undefined : { [KEPT_READ.INVITATIONS]: invitations }),
    ...(automations === undefined ? undefined : { [KEPT_READ.AUTOMATIONS]: automations }),
    ...(inbox === undefined ? undefined : { [KEPT_READ.INBOX]: inbox.rows }),
  };

  return { reads, dropped };
}

const encodeKept = Schema.encodeEffect(Schema.fromJsonString(keptSchema));

/** The account's lists as they were kept, and what moved since, written within `SAVE_EVERY`. */
export interface EntityStore {
  /** What the file held of `read` as the store opened, for this account and these row shapes; none where it held none. */
  readonly stored: <Read extends KeptRead>(read: Read) => KeptRows[Read] | undefined;
  /** `read`'s rows as the service answered them now, written within `SAVE_EVERY` and as the store closes; the workspaces' leave with them every read kept per workspace of one they no longer name. */
  readonly keep: <Read extends KeptRead>(read: Read, rows: KeptRows[Read]) => Effect.Effect<void>;
  /** `read`'s rows kept as `keep` keeps them where none of them moved but where they stand, as the task list's sync id alone: written only with the next save of something that moved, and as the store closes. */
  readonly keepUnmoved: <Read extends KeptRead>(
    read: Read,
    rows: KeptRows[Read],
  ) => Effect.Effect<void>;
  /** What the store holds of one workspace's `read` now: as the file held it, or as it was kept since; none where it holds none. */
  readonly storedIn: <Read extends KeptByWorkspace>(
    read: Read,
    workspaceId: string,
  ) => KeptRows[Read][string] | undefined;
  /** One workspace's `read` as the service answered it now, kept beside the other workspaces' as `keep` keeps a read. */
  readonly keepIn: <Read extends KeptByWorkspace>(
    read: Read,
    workspaceId: string,
    rows: KeptRows[Read][string],
  ) => Effect.Effect<void>;
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
  /** Tells the store the local database holds them now, so its next save leaves them out. */
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
  /** The account signed in, whose lists alone the file may hold. */
  readonly accountId: string;
  /** Each moment the shell asks the lists written (`KeptListsDue`); where given, lists that moved are written only then and as the store closes, never every `SAVE_EVERY`. */
  readonly listsDue?: Stream.Stream<void>;
}

/** The SHA-256, in hex, of every kept row shape's JSON Schema, which a build that changes any of them changes. */
const keptRowsHash: Effect.Effect<string> = Effect.map(
  Effect.promise(() =>
    crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(Schema.toJsonSchemaDocument(keptRowsSchema))),
    ),
  ),
  (digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
);

/** The record of each workspace's rows `read` holds in `reads`; none where it holds none. */
function byWorkspaceOf<Read extends KeptByWorkspace>(
  reads: Partial<KeptRows>,
  read: Read,
): Readonly<Record<string, KeptRows[Read][string]>> | undefined {
  // SAFETY: a read kept per workspace is a record of its rows by workspace, so what `reads` holds of `read` is one.
  return reads[read] as Readonly<Record<string, KeptRows[Read][string]>> | undefined;
}

/** `reads` with every read kept per workspace cut to the workspaces the kept list names, where it names any. */
function withinWorkspaces(reads: Partial<KeptRows>): Partial<KeptRows> {
  const listed = reads[KEPT_READ.WORKSPACES];

  if (listed === undefined) return reads;
  const named = new Set(listed.map((workspace) => workspace.id));

  const cut = <Rows>(byWorkspace: Readonly<Record<string, Rows>>) =>
    Object.fromEntries(Object.entries(byWorkspace).filter(([id]) => named.has(id)));

  const {
    [KEPT_READ.MEMBERS]: members,
    [KEPT_READ.INVITATIONS]: invitations,
    [KEPT_READ.AUTOMATIONS]: automations,
  } = reads;

  return {
    ...reads,
    ...(members === undefined ? undefined : { [KEPT_READ.MEMBERS]: cut(members) }),
    ...(invitations === undefined ? undefined : { [KEPT_READ.INVITATIONS]: cut(invitations) }),
    ...(automations === undefined ? undefined : { [KEPT_READ.AUTOMATIONS]: cut(automations) }),
  };
}

/** `plain` sealed as the file's text: in one step where the cipher seals to text itself, and as the base64 of its sealed bytes otherwise. */
function sealedText(cipher: SecretCipher, plain: string): string {
  return cipher.sealText?.(plain) ?? Base64.encode(cipher.encrypt(plain));
}

/** The file's text opened and read as far as its account, its older waiting writes, and its messages refused, or none where it will not open or is not a store's. */
function opened(cipher: SecretCipher, text: string): Envelope | undefined {
  const sealed = text.trim();
  const { openText } = cipher;

  const plain =
    openText === undefined
      ? Result.flatMap(Base64.decode(sealed), (bytes) => Result.try(() => cipher.decrypt(bytes)))
      : Result.try(() => openText.call(cipher, sealed));

  if (Result.isFailure(plain)) return undefined;

  return Result.getOrUndefined(decodeEnvelope(plain.success));
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
 * read and opened, deleted where it is another account's or will not open,
 * and kept as far as its rows still read where it is of other row shapes;
 * what moves written at most every `SAVE_EVERY`,
 * and once more as the scope closes, unless it was forgotten.
 */
export function openEntityStore(
  options: EntityStoreOptions,
): Effect.Effect<EntityStore, never, FileSystem.FileSystem | Path.Path | Scope.Scope> {
  return Effect.gen(function* () {
    const { directory, cipher, accountId } = options;
    const services = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const hash = yield* keptRowsHash;

    const textRead = yield* Effect.result(readSettingsFileText(directory, ENTITY_STORE_FILE_NAME));
    const text = Result.getOrUndefined(textRead);

    const read = text === undefined ? undefined : opened(cipher, text);
    const ours = read !== undefined && read.accountId === accountId;

    // Note that the shapes' hash is a hint: where it matches, the reads are read whole at once, and otherwise, or where they still don't read, each read is read on its own, keeping what of them still reads.
    const whole =
      ours && read.hash === hash ? Result.getOrUndefined(decodeReads(read.reads)) : undefined;

    // SAFETY: the file's text was read with `fromJsonString`, so its reads are what `JSON.parse` answers, a JSON value.
    const tolerant =
      ours && whole === undefined ? tolerantReads(read.reads as UnparsedWireValue) : undefined;

    const kept = whole ?? tolerant?.reads;

    // Note that a file that is not this account's, or will not open, is deleted before anything reads it, so no other account's rows are ever drawn.
    if (text !== undefined && kept === undefined) yield* removed(directory);
    const stored: Partial<KeptRows> = kept ?? {};
    // Note that the account's own waiting writes an older build kept outlast other row shapes, for the local database to import.
    const legacyQueue: readonly QueuedEntry[] = ours ? (read.queue ?? []) : [];
    /** The older waiting writes each save still carries, until the local database imported them. */
    let queueCarried = legacyQueue;
    // Note that the account's own messages refused an older build kept outlast other row shapes, for the local database to import.
    const refusedKept: readonly unknown[] = ours ? (read.refused ?? []) : [];
    /** The older messages refused each save still carries, until the local database imported them. */
    let refusedCarried = refusedKept;
    /** The messages refused carried, as one text a save compares. */
    const waitingNow = () => JSON.stringify(refusedCarried);
    let reads: Partial<KeptRows> = stored;

    // Note that rows kept at other shapes are written again at the next save, at these shapes and under this hash, so the next launch reads them whole.
    let dirty =
      tolerant !== undefined ||
      (kept === undefined && (legacyQueue.length > 0 || refusedKept.length > 0));

    /** Whether rows kept since the last save moved nothing but where they stand (`keepUnmoved`), which only a save of something that moved, or the last, writes. */
    let unmoved = false;
    let savedRefused = JSON.stringify(refusedKept);
    let forgotten = false;
    const lock = yield* Semaphore.make(1);
    let savedAt = yield* Clock.currentTimeMillis;

    const save = (closing: boolean) =>
      lock.withPermits(1)(
        Effect.flatMap(Clock.currentTimeMillis, (now) => {
          const waitingText = waitingNow();
          const listsDue = dirty && (closing || now - savedAt >= Duration.toMillis(SAVE_EVERY));
          const moved = listsDue || waitingText !== savedRefused;

          if (!(moved || (closing && unmoved)) || forgotten) return Effect.void;
          dirty = false;
          unmoved = false;
          savedRefused = waitingText;
          savedAt = now;

          const queue = queueCarried.length > 0 ? { queue: queueCarried } : undefined;
          const refused = refusedCarried.length > 0 ? { refused: refusedCarried } : undefined;

          return encodeKept({ hash, accountId, reads, ...queue, ...refused }).pipe(
            Effect.map((plain) => sealedText(cipher, plain)),
            Effect.flatMap((sealed) =>
              writeSettingsFileAtomic(directory, sealed, undefined, ENTITY_STORE_FILE_NAME),
            ),
            // Note that a failure is logged by its kind alone, since a row's words may be among its message.
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
     * The saver: once the messages refused moved, a save `QUEUE_SETTLE` later;
     * once lists moved, where the shell names no moments of its own, one when `SAVE_EVERY` has passed since the last save,
     * sooner where the messages refused move meanwhile; otherwise asleep until
     * woken. Note that it ends once the store is forgotten, since nothing it
     * would save is kept.
     */
    const saver = Effect.gen(function* () {
      while (!forgotten) {
        if (waitingNow() !== savedRefused) {
          yield* Effect.sleep(QUEUE_SETTLE);
        } else if (dirty && options.listsDue === undefined) {
          const left = savedAt + Duration.toMillis(SAVE_EVERY) - (yield* Clock.currentTimeMillis);

          if (left > 0) {
            yield* Effect.raceFirst(Effect.sleep(Duration.millis(left)), Queue.take(wake));
            continue;
          }
        } else {
          yield* Queue.take(wake);
          continue;
        }

        yield* Queue.clear(wake);
        yield* save(false);
      }
    });

    // Note that a moment the shell names writes the lists whole, as the store closing does, since the app may not run again before it is ended.
    if (options.listsDue !== undefined) {
      yield* Effect.forkScoped(
        Stream.runForEach(options.listsDue, () => save(true)),
        { startImmediately: true },
      );
    }

    yield* Effect.forkScoped(saver, { startImmediately: true });
    yield* Effect.addFinalizer(() => save(true));

    /** `read`'s rows laid among those kept, the workspaces' leaving with them every read kept per workspace of one they no longer name. */
    const laid = <Read extends KeptRead>(kept: Read, rows: KeptRows[Read]) => {
      reads = { ...reads, [kept]: rows };

      if (kept === KEPT_READ.WORKSPACES) reads = withinWorkspaces(reads);
    };

    return {
      stored: (read) => stored[read],
      queue: Result.isFailure(textRead)
        ? undefined
        : {
            entries: legacyQueue,
            imported: Effect.sync(() => {
              queueCarried = [];
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
      keep: (kept, rows) =>
        Effect.andThen(
          Effect.sync(() => {
            laid(kept, rows);
            dirty = true;
          }),
          woken,
        ),
      keepUnmoved: (kept, rows) =>
        Effect.sync(() => {
          laid(kept, rows);
          unmoved = true;
        }),
      storedIn: <Read extends KeptByWorkspace>(kept: Read, workspaceId: string) =>
        byWorkspaceOf<Read>(reads, kept)?.[workspaceId],
      keepIn: <Read extends KeptByWorkspace>(
        kept: Read,
        workspaceId: string,
        rows: KeptRows[Read][string],
      ) =>
        Effect.suspend(() => {
          // Note that a late answer for a workspace the kept list no longer names is not kept, so a workspace left never comes back with it.
          const listed = reads[KEPT_READ.WORKSPACES];

          if (listed !== undefined && !listed.some((workspace) => workspace.id === workspaceId)) {
            return Effect.void;
          }

          const byWorkspace = { ...byWorkspaceOf<Read>(reads, kept), [workspaceId]: rows };
          // SAFETY: the read `kept` names is set to a record of its own rows, each workspace's `KeptRows[Read][string]`.
          reads = { ...reads, [kept]: byWorkspace };
          dirty = true;

          return woken;
        }),
      forget: lock.withPermits(1)(
        Effect.suspend(() => {
          forgotten = true;

          return Effect.andThen(woken, Effect.provideContext(removed(directory), services));
        }),
      ),
    };
  });
}
