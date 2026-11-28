/**
 * attachment-blob-backfill.ts -- the rows that still keep their bytes inline, read a batch at a time, and each one's claim on the Blob objects its bytes were copied to.
 *
 * The sweep moves every attachment kept before the Blob store, whose bytes
 * stand in its row (`bytes`, and `mp4_bytes` beside a recording or a clip),
 * into the store (`packages/service/src/storage/attachment-blob-backfill.ts`).
 * It reads a batch of such rows without their bytes, then one row's bytes at
 * a time, writes them to the store with no lock held, and only then claims
 * the objects: one statement names the keys on the row and clears its bytes,
 * and only while the bytes still stand inline.
 *
 * Every key is tombstoned before its write (`tombstoneAttachmentBlobs`), and
 * a claim drops those tombstones in its own transaction, once the row names
 * the keys. So an object written for a row that never claimed it, whose write
 * half failed, or whose row was deleted before its claim, always has a
 * tombstone. The purge deletes an attachment's object only once its row is
 * gone (`readAttachmentBlobTombstones`), which no later claim can undo, since
 * a pathname is the row's own id (`attachmentBlobPath`) and no row takes an id
 * again. So a tombstone written for a write that another sweep claimed after
 * all stands harmless until its row is deleted, and then its objects go as
 * the row's own would. A row deleted while its write was still landing may
 * have had its tombstones purged before the write landed, so a claim or a
 * failed write that finds the row gone tombstones the keys again.
 */

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { attachment, phoneCopyContentType } from "../schemas/attachment.js";
import { attachmentBlobTombstone } from "../schemas/attachment-blob-tombstone.js";

type BackfillEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** What a claim found: the row now names the objects, or it was gone or moved already and the objects stay tombstoned. */
export const ATTACHMENT_CLAIM = {
  MOVED: "moved",
  GONE: "gone",
} as const;

export type AttachmentClaim = (typeof ATTACHMENT_CLAIM)[keyof typeof ATTACHMENT_CLAIM];

/** A row that keeps its bytes inline, as the batch reads it: its id and how many bytes it keeps, its copy for a phone's among them. */
export interface InlineAttachment {
  readonly id: string;
  readonly byteCount: number;
}

/** One body's bytes and the type they are stored under. */
export interface InlineBody {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

/** A row's inline bytes, and its copy for a phone where it keeps one. */
export interface InlineAttachmentBytes {
  readonly original: InlineBody;
  readonly phone: InlineBody | null;
}

/** The keys a row's bytes were copied to, its copy for a phone's among them where it keeps one. */
export interface AttachmentBlobKeys {
  readonly blobKey: string;
  readonly phoneBlobKey: string | null;
}

/** Whether the row keeps its bytes inline, which is what the move takes and the claim requires. */
const keepsBytesInline = and(isNull(attachment.blobKey), isNotNull(attachment.bytes));

/**
 * Up to `limit` rows that keep their bytes inline, by id, each with its
 * bytes and its copy's counted together. Note that we read the copy's
 * length as Postgres stores it, since a row kept before `phone_byte_count`
 * may lack the count, and the length reads no bytes.
 */
export function readInlineAttachments(limit: number): BackfillEffect<readonly InlineAttachment[]> {
  return Effect.map(
    Database.use((db) =>
      db
        .select({
          id: attachment.id,
          byteCount: sql<number>`(${attachment.byteCount} + coalesce(octet_length(${attachment.mp4Bytes}), 0))::int`,
        })
        .from(attachment)
        .where(keepsBytesInline)
        .orderBy(asc(attachment.id))
        .limit(limit),
    ),
    (rows) => rows.map((row) => ({ id: row.id, byteCount: Number(row.byteCount) })),
  );
}

/** The row's inline bytes, or nothing where it is gone or no longer keeps them inline. */
export function readInlineAttachmentBytes(
  id: string,
): BackfillEffect<Option.Option<InlineAttachmentBytes>> {
  return Effect.map(
    Database.use((db) =>
      db
        .select({
          contentType: attachment.contentType,
          bytes: attachment.bytes,
          phoneContentType: phoneCopyContentType(),
          phoneBytes: attachment.mp4Bytes,
        })
        .from(attachment)
        .where(and(eq(attachment.id, id), keepsBytesInline)),
    ),
    ([row]) => {
      if (row === undefined || row.bytes === null) return Option.none();

      const phone =
        row.phoneBytes === null
          ? null
          : { bytes: row.phoneBytes, contentType: row.phoneContentType };

      return Option.some({ original: { bytes: row.bytes, contentType: row.contentType }, phone });
    },
  );
}

/**
 * Tombstones the keys about to be written for a row, before the write, so
 * whatever the write leaves in the store is purged unless the row claims it.
 * Note that a key already tombstoned is written again at a new version, so a
 * purge that read it before cannot drop it (`dropAttachmentBlobTombstones`).
 */
export function tombstoneAttachmentBlobs(keys: AttachmentBlobKeys): BackfillEffect<void> {
  const written = [keys.blobKey, keys.phoneBlobKey].filter((key) => key !== null);

  return Effect.asVoid(
    Database.use((db) =>
      db
        .insert(attachmentBlobTombstone)
        .values(written.map((key) => ({ key, createdAt: sql`clock_timestamp()` })))
        .onConflictDoUpdate({
          target: attachmentBlobTombstone.key,
          set: { createdAt: sql`clock_timestamp()` },
        }),
    ),
  );
}

/**
 * Tombstones the keys written for a row again where the row is gone, since
 * the purge may have taken their first tombstones, and deleted nothing or
 * only part of the write, while the write was still landing. Note that we
 * check and then write, because a row that is gone never comes back.
 */
export function tombstoneAttachmentBlobsOfGoneRow(
  id: string,
  keys: AttachmentBlobKeys,
): BackfillEffect<void> {
  return Effect.gen(function* () {
    const db = yield* Database;

    const standing = yield* db
      .select({ id: attachment.id })
      .from(attachment)
      .where(eq(attachment.id, id));

    if (standing.length > 0) return;
    yield* tombstoneAttachmentBlobs(keys);
  });
}

/**
 * Names the objects on the row, clears its inline bytes, and drops the keys'
 * tombstones, in one transaction, once the store holds the objects; where no
 * row keeps its bytes inline any longer, leaves the tombstones standing, and
 * where the row is gone, tombstones the keys again
 * (`tombstoneAttachmentBlobsOfGoneRow`). Note that the claim also requires the row's copy
 * for a phone to stand exactly where a key was written for it, so it never
 * clears a copy it did not move, and that the tombstones drop under the
 * row's lock, so a delete of the row waits and tombstones the keys afresh.
 */
export function claimAttachmentBlobs(
  id: string,
  keys: AttachmentBlobKeys,
): BackfillEffect<AttachmentClaim> {
  const written = [keys.blobKey, keys.phoneBlobKey].filter((key) => key !== null);

  const claim = Effect.gen(function* () {
    const db = yield* Database;

    const phoneMatches =
      keys.phoneBlobKey === null ? isNull(attachment.mp4Bytes) : isNotNull(attachment.mp4Bytes);

    const claimed = yield* db
      .update(attachment)
      .set({
        blobKey: keys.blobKey,
        phoneBlobKey: keys.phoneBlobKey,
        phoneByteCount: sql`coalesce(${attachment.phoneByteCount}, octet_length(${attachment.mp4Bytes}))`,
        bytes: null,
        mp4Bytes: null,
      })
      .where(and(eq(attachment.id, id), keepsBytesInline, phoneMatches))
      .returning({ id: attachment.id });

    if (claimed.length === 0) {
      yield* tombstoneAttachmentBlobsOfGoneRow(id, keys);

      return ATTACHMENT_CLAIM.GONE;
    }

    yield* db.delete(attachmentBlobTombstone).where(inArray(attachmentBlobTombstone.key, written));

    return ATTACHMENT_CLAIM.MOVED;
  });

  return Effect.flatMap(SqlClient.SqlClient, (client) => client.withTransaction(claim));
}

/** How many rows still keep their bytes inline. */
export function countInlineAttachments(): BackfillEffect<number> {
  return Effect.map(
    Database.use((db) =>
      db.select({ count: sql<number>`count(*)::int` }).from(attachment).where(keepsBytesInline),
    ),
    ([row]) => row?.count ?? 0,
  );
}
