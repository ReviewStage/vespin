import type { InboxImageType } from "@repo/features/inbox-wire";
import { LEGACY_APP_WORD } from "@repo/wire";
import type { FileUIPart } from "ai";
import { and, asc, eq, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { attachment } from "../schemas/attachment.js";
import {
  type JournalImageMoveFailure,
  type JournalImageUpload,
  journalImageMove,
  journalImageRewrite,
} from "../schemas/journal-image-move.js";
import { conversations, messages } from "../schemas/storage.js";
import { keptImageMetadata } from "./attached-file-parts.js";
import { tombstoneUnwrittenUploads } from "./attachment-blob-tombstones.js";
import { bumpedRevision, landedRevision } from "./writer.js";

/**
 * journal-image-moves.ts -- the one-off move's reads and writes: the journal rows still queued, their image parts as `data:` URLs, and the one transaction that keeps their pictures and rewrites the parts to name them.
 *
 * The move (`packages/service/src/storage/journal-image-move.ts`) reads a
 * queued row's image parts with a digest of each, stores their bytes in
 * Blob, and then settles the row here in one transaction: the row is
 * locked, and only where every part it read still stands as it was read are
 * the pictures written beside the row's conversation, its parts rewritten to
 * the kept shape (`attached-file-parts.ts`) under a bump of the journal's
 * revision, each rewrite logged, and the row taken off the queue. A row
 * changed since it was read is left queued for the next sweep to read again.
 * A sweep claims its rows for a lease, and records each upload on its row
 * before making it; the uploads no committed picture names are tombstoned
 * as the row is released or dropped, or by the next sweep to take it where
 * the last one died first.
 * The pictures are written past the conversation's budget, since their
 * bytes were already kept, in the row.
 */

type MoveEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** How a queued row was settled. */
export const JOURNAL_IMAGE_SETTLED = {
  /** Its parts now name the pictures they were kept as. */
  REWRITTEN: "rewritten",
  /** A part read changed before the rewrite, so nothing was written and the row stays queued. */
  CHANGED: "changed",
  /** The row is gone, and so is its place in the queue. */
  GONE: "gone",
} as const;

export type JournalImageSettled =
  (typeof JOURNAL_IMAGE_SETTLED)[keyof typeof JOURNAL_IMAGE_SETTLED];

/** An image part as a queued row keeps it: its place among the row's parts, the part, and a digest of it as read. */
export interface JournalImagePart {
  readonly index: number;
  readonly part: FileUIPart;
  readonly digest: string;
}

/** A queued row's image parts, with the conversation they belong to and the account it is kept for. */
export interface JournalImageRow {
  readonly messageId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly images: readonly JournalImagePart[];
}

/** A picture of the conversation already kept, which a part is rewritten to name. */
export interface HeldJournalPicture {
  readonly id: string;
}

/** A picture whose bytes the move stored in Blob under the id it minted, to be written beside the conversation. */
export interface StoredJournalPicture {
  readonly id: string;
  readonly blobKey: string;
  readonly sha256: string;
  readonly contentType: InboxImageType;
  readonly width: number;
  readonly height: number;
  readonly byteCount: number;
}

/** One part to rewrite: where it stands, its digest as read, and the picture it is to name. */
export interface JournalImageRewrite {
  readonly index: number;
  readonly digest: string;
  readonly part: FileUIPart;
  readonly picture: HeldJournalPicture | StoredJournalPicture;
}

/** A row settled: how, and how many of its parts were rewritten. */
export interface JournalImageSettlement {
  readonly settled: JournalImageSettled;
  readonly rewritten: number;
}

/** The parts a row's image parts are read from: a developer's file over a `data:` URL of an image, each with its place and digest. */
const imagePartsOf = (parts: SQL | typeof messages.parts) => sql`coalesce((
  select jsonb_agg(jsonb_build_object('index', image.place - 1, 'part', image.part, 'digest', md5(image.part::text)) order by image.place)
  from jsonb_array_elements(${parts}) with ordinality as image(part, place)
  where image.part ->> 'type' = 'file' and starts_with(image.part ->> 'url', 'data:image/')
), '[]'::jsonb)`;

/** The digest of every part of a row, in order, as `imagePartsOf` digests one. */
const partDigestsOf = (parts: typeof messages.parts) => sql`array(
  select md5(part.value::text)
  from jsonb_array_elements(${parts}) with ordinality as part(value, place)
  order by part.place
)`;

const ImagePartSchema = Schema.Struct({
  index: Schema.Int,
  part: Schema.Unknown,
  digest: Schema.String,
});

const QueuedRowSchema = Schema.Struct({
  conversationId: Schema.String,
  userId: Schema.String,
  images: Schema.Array(ImagePartSchema),
});

const decodeQueuedRow = Schema.decodeUnknownEffect(QueuedRowSchema);

const decodeDigests = Schema.decodeUnknownEffect(Schema.Array(Schema.String));

const decodeUploads = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ id: Schema.String, keys: Schema.Array(Schema.String) })),
);

/** The part rewritten to name the picture it was kept as: no bytes, and the picture's id under today's provider key in place of any legacy one. */
function keptPart(part: FileUIPart, attachmentId: string): FileUIPart {
  const { [LEGACY_APP_WORD]: _legacy, ...metadata } = part.providerMetadata ?? {};

  return {
    ...part,
    url: "",
    providerMetadata: { ...metadata, ...keptImageMetadata({ id: attachmentId }) },
  };
}

/** The row's parts with each rewrite set in its place. */
function rewrittenParts(rewrites: readonly { index: number; part: FileUIPart }[]): SQL {
  return rewrites.reduce<SQL>(
    (parts, { index, part }) =>
      sql`jsonb_set(${parts}, array[${String(index)}]::text[], ${JSON.stringify(part)}::jsonb)`,
    sql`${messages.parts}`,
  );
}

/** Whether a picture is one the move stored, rather than one the conversation already kept. */
function isStored(
  picture: HeldJournalPicture | StoredJournalPicture,
): picture is StoredJournalPicture {
  return "blobKey" in picture;
}

/**
 * Writes the stored pictures beside the conversation and answers the id
 * each picture's hash is kept under. Note that a picture whose bytes the
 * conversation came to keep since it was read stands down to the row kept,
 * so its stored copy is left unnamed, for its upload's tombstone.
 */
const writePictures = (
  row: Pick<JournalImageRow, "conversationId" | "userId">,
  pictures: readonly StoredJournalPicture[],
) =>
  Effect.gen(function* () {
    if (pictures.length === 0) return new Map<string, string>();
    const db = yield* Database;
    const now = yield* DateTime.nowAsDate;

    yield* db
      .insert(attachment)
      .values(
        pictures.map((picture) => ({
          userId: row.userId,
          conversationId: row.conversationId,
          id: picture.id,
          contentType: picture.contentType,
          sha256: picture.sha256,
          width: picture.width,
          height: picture.height,
          byteCount: picture.byteCount,
          blobKey: picture.blobKey,
          createdAt: now,
        })),
      )
      .onConflictDoNothing({ target: [attachment.conversationId, attachment.sha256] });

    return yield* readKeptJournalPictures(
      row.conversationId,
      pictures.map((picture) => picture.sha256),
    );
  });

/** The pictures the conversation keeps of the bytes each hash names, by hash; a hash it keeps none of is not named. */
export function readKeptJournalPictures(
  conversationId: string,
  sha256s: readonly string[],
): MoveEffect<ReadonlyMap<string, string>> {
  if (sha256s.length === 0) return Effect.succeed(new Map());

  return Effect.map(
    Database.use((db) =>
      db
        .select({ id: attachment.id, sha256: attachment.sha256 })
        .from(attachment)
        .where(
          and(
            eq(attachment.conversationId, conversationId),
            inArray(attachment.sha256, [...sha256s]),
          ),
        ),
    ),
    (kept) => new Map(kept.flatMap((one) => (one.sha256 === null ? [] : [[one.sha256, one.id]]))),
  );
}

/**
 * Claims up to `limit` queued rows that wait to be moved and that no sweep
 * holds, until `leaseMillis` from now, answering their ids. Note that a row
 * another sweep is claiming at the same moment is passed over rather than
 * waited on.
 */
export function claimJournalImageMoves(
  limit: number,
  leaseMillis: number,
): MoveEffect<readonly string[]> {
  return Effect.gen(function* () {
    const db = yield* Database;
    const now = yield* DateTime.nowAsDate;

    const waiting = db
      .select({ messageId: journalImageMove.messageId })
      .from(journalImageMove)
      .where(
        and(
          isNull(journalImageMove.failure),
          or(isNull(journalImageMove.claimedUntil), lt(journalImageMove.claimedUntil, now)),
        ),
      )
      .orderBy(asc(journalImageMove.messageId))
      .limit(limit)
      .for("update", { skipLocked: true });

    const claimed = yield* db
      .update(journalImageMove)
      .set({ claimedUntil: new Date(now.getTime() + leaseMillis) })
      .where(inArray(journalImageMove.messageId, waiting))
      .returning({ messageId: journalImageMove.messageId });

    return claimed.map((row) => row.messageId).sort();
  });
}

/** Records an upload on its row before it is made, so it is tombstoned whatever becomes of the sweep making it. */
export function recordJournalImageUpload(
  messageId: string,
  upload: JournalImageUpload,
): MoveEffect<void> {
  return Effect.asVoid(
    Database.use((db) =>
      db
        .update(journalImageMove)
        .set({
          uploads: sql`${journalImageMove.uploads} || jsonb_build_array(${JSON.stringify(upload)}::jsonb)`,
        })
        .where(eq(journalImageMove.messageId, messageId)),
    ),
  );
}

/** Tombstones the row's recorded uploads that no picture names, and forgets them. */
export function tombstoneJournalImageUploads(messageId: string): MoveEffect<void> {
  return Effect.gen(function* () {
    const db = yield* Database;

    const [row] = yield* db
      .select({ uploads: journalImageMove.uploads })
      .from(journalImageMove)
      .where(eq(journalImageMove.messageId, messageId));

    if (row === undefined) return;
    const uploads = yield* decodeUploads(row.uploads);

    if (uploads.length === 0) return;
    yield* tombstoneUnwrittenUploads(uploads);

    yield* db
      .update(journalImageMove)
      .set({ uploads: [] })
      .where(eq(journalImageMove.messageId, messageId));
  });
}

/** Lets a row the sweep holds go, its uploads no picture names tombstoned, for the next sweep to take where it still waits. */
export function releaseJournalImageMove(messageId: string): MoveEffect<void> {
  return Effect.gen(function* () {
    yield* tombstoneJournalImageUploads(messageId);

    yield* Database.use((db) =>
      db
        .update(journalImageMove)
        .set({ claimedUntil: null })
        .where(eq(journalImageMove.messageId, messageId)),
    );
  });
}

/** A queued row's image parts as it stands; nothing where the row is gone. */
export function readJournalImageRow(messageId: string): MoveEffect<Option.Option<JournalImageRow>> {
  return Effect.gen(function* () {
    const db = yield* Database;

    const [found] = yield* db
      .select({
        conversationId: messages.conversationId,
        userId: conversations.userId,
        images: imagePartsOf(messages.parts),
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .where(eq(messages.id, messageId));

    if (found === undefined) return Option.none();
    const row = yield* decodeQueuedRow(found);

    // SAFETY: the read takes only parts whose type is `file` and whose URL is a string, the AI SDK's file part as the journal writes it.
    const images = row.images.map(({ index, part, digest }) => ({
      index,
      part: part as FileUIPart,
      digest,
    }));

    return Option.some({ ...row, messageId, images });
  });
}

/**
 * Settles a queued row in one transaction: where it is gone, drops it from
 * the queue; where a part named changed since it was read, writes nothing;
 * and otherwise writes the stored pictures, rewrites each part to name its
 * picture, logs each rewrite, and drops the row from the queue.
 */
export function settleJournalImageRow(
  row: Pick<JournalImageRow, "messageId" | "conversationId" | "userId">,
  rewrites: readonly JournalImageRewrite[],
): MoveEffect<JournalImageSettlement> {
  const settle = Effect.gen(function* () {
    const db = yield* Database;

    const [locked] = yield* db
      .select({ digests: partDigestsOf(messages.parts) })
      .from(messages)
      .where(eq(messages.id, row.messageId))
      .for("update");

    if (locked === undefined) {
      yield* dropJournalImageMove(row.messageId);

      return { settled: JOURNAL_IMAGE_SETTLED.GONE, rewritten: 0 };
    }

    const digests = yield* decodeDigests(locked.digests);

    if (rewrites.some((rewrite) => digests[rewrite.index] !== rewrite.digest)) {
      return { settled: JOURNAL_IMAGE_SETTLED.CHANGED, rewritten: 0 };
    }

    const stored = rewrites.flatMap(({ picture }) => (isStored(picture) ? [picture] : []));
    const keptByHash = yield* writePictures(row, stored);

    const named = rewrites.map((rewrite) => {
      const { picture } = rewrite;
      const id = isStored(picture) ? keptByHash.get(picture.sha256) : picture.id;

      if (id === undefined)
        throw new Error("settleJournalImageRow: a stored picture was not kept.");

      return { index: rewrite.index, part: keptPart(rewrite.part, id), attachmentId: id };
    });

    if (named.length > 0) {
      const bumped = bumpedRevision(row.conversationId);

      yield* db
        .with(bumped)
        .update(messages)
        .set({ parts: rewrittenParts(named), revision: landedRevision(bumped) })
        .where(eq(messages.id, row.messageId));

      const now = yield* DateTime.nowAsDate;

      yield* db.insert(journalImageRewrite).values(
        named.map(({ index, attachmentId }) => ({
          messageId: row.messageId,
          partIndex: index,
          attachmentId,
          rewrittenAt: now,
        })),
      );
    }

    yield* dropJournalImageMove(row.messageId);

    return { settled: JOURNAL_IMAGE_SETTLED.REWRITTEN, rewritten: named.length };
  });

  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(settle));
}

/** Takes a row off the queue, as one moved, gone, or holding no image to move, its uploads no picture names tombstoned first. */
export function dropJournalImageMove(messageId: string): MoveEffect<void> {
  return Effect.gen(function* () {
    yield* tombstoneJournalImageUploads(messageId);

    yield* Database.use((db) =>
      db.delete(journalImageMove).where(eq(journalImageMove.messageId, messageId)),
    );
  });
}

/** Keeps a queued row from being taken again, naming why one of its images cannot be kept. */
export function failJournalImageMove(
  messageId: string,
  failure: JournalImageMoveFailure,
): MoveEffect<void> {
  return Effect.asVoid(
    Database.use((db) =>
      db.update(journalImageMove).set({ failure }).where(eq(journalImageMove.messageId, messageId)),
    ),
  );
}
