/**
 * attachment-blob-tombstones.ts -- the Blob store's objects whose attachments are gone: read a batch of them, and drop those whose objects were deleted.
 *
 * A tombstone is written by the trigger on `attachment` as a row that named
 * a stored object goes (`../schemas/attachment-blob-tombstone.ts`), or by the
 * backfill before it writes a row's objects (`./attachment-blob-backfill.ts`),
 * or for an upload whose row was never written (`tombstoneUnwrittenUploads`). The sweep reads only the tombstones whose attachment
 * row is gone: an attachment's pathname is its row's id, which no row takes
 * again, so once the row is gone no claim can come to name the object, and
 * its delete can never take an object a row names. A tombstone whose row
 * still stands waits, harmless, until the row goes. The sweep reads a batch,
 * each at the version it stands at, deletes their objects, and only then
 * drops their tombstones, so an object whose delete failed keeps its
 * tombstone for the next sweep. Two sweeps that read the same batch delete
 * the same objects twice, which the store answers as done, and drop the same
 * tombstones twice, which drops nothing the second time.
 */

import { and, asc, eq, inArray, notExists, or, sql } from "drizzle-orm";
import { Effect } from "effect";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { attachment } from "../schemas/attachment.js";
import { attachmentBlobTombstone } from "../schemas/attachment-blob-tombstone.js";

type TombstoneEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/**
 * The attachment id a pathname names, as `attachmentBlobPath` spells it
 * (`attachments/<id>` or `attachments/<id>/phone`), or null for any other
 * pathname, which no row names.
 */
const attachmentIdOfKey = sql`substring(${attachmentBlobTombstone.key} from '^attachments/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:/phone)?$')::uuid`;

/** One tombstone as the purge read it: its pathname, and the version it stood at then. */
export interface AttachmentBlobTombstone {
  readonly key: string;
  readonly version: string;
}

/**
 * A tombstone's version: when it was last written, to the microsecond, as
 * text. Note that we compare it in SQL rather than as a `Date`, because a
 * `Date` keeps milliseconds and would match a tombstone written again since.
 */
const tombstoneVersion = sql<string>`((extract(epoch from ${attachmentBlobTombstone.createdAt}) * 1000000)::bigint)::text`;

/** Up to `limit` tombstones whose attachment row is gone, the oldest first. */
export function readAttachmentBlobTombstones(
  limit: number,
): TombstoneEffect<readonly AttachmentBlobTombstone[]> {
  return Effect.map(
    Database.use((db) =>
      db
        .select({ key: attachmentBlobTombstone.key, version: tombstoneVersion })
        .from(attachmentBlobTombstone)
        .where(
          notExists(
            db
              .select({ id: attachment.id })
              .from(attachment)
              .where(eq(attachment.id, attachmentIdOfKey)),
          ),
        )
        .orderBy(asc(attachmentBlobTombstone.createdAt), asc(attachmentBlobTombstone.key))
        .limit(limit),
    ),
    (rows) => rows.map((row) => ({ key: row.key, version: String(row.version) })),
  );
}

/**
 * The tombstones dropped, once their objects are gone from the store, each
 * only where it still stands at the version the purge read. Note that one
 * written again since, by a write that landed after the purge's delete
 * (`tombstoneAttachmentBlobsOfGoneRow`), stands for the next sweep.
 */
export function dropAttachmentBlobTombstones(
  tombstones: readonly AttachmentBlobTombstone[],
): TombstoneEffect<void> {
  if (tombstones.length === 0) return Effect.void;

  return Effect.asVoid(
    Database.use((db) =>
      db
        .delete(attachmentBlobTombstone)
        .where(
          or(
            ...tombstones.map((tombstone) =>
              and(
                eq(attachmentBlobTombstone.key, tombstone.key),
                sql`${tombstoneVersion} = ${tombstone.version}`,
              ),
            ),
          ),
        ),
    ),
  );
}

/** An upload to the store: the attachment row it was made for, and the pathnames it wrote. */
export interface AttachmentUpload {
  readonly id: string;
  readonly keys: readonly string[];
}

/**
 * Tombstones the pathnames of every upload whose attachment row does not
 * stand, so the sweep deletes objects a writer stored and then never named.
 * It runs once the write's transaction has ended, so an upload whose row
 * landed after all, a commit answered by a failure among them, keeps its
 * objects.
 */
export function tombstoneUnwrittenUploads(
  uploads: readonly AttachmentUpload[],
): TombstoneEffect<void> {
  if (uploads.length === 0) return Effect.void;

  return Effect.gen(function* () {
    const ids = uploads.map((upload) => upload.id);

    const written = yield* Database.use((db) =>
      db.select({ id: attachment.id }).from(attachment).where(inArray(attachment.id, ids)),
    );

    const standing = new Set(written.map((row) => row.id));
    const keys = uploads.flatMap((upload) => (standing.has(upload.id) ? [] : upload.keys));

    if (keys.length === 0) return;

    yield* Database.use((db) =>
      db
        .insert(attachmentBlobTombstone)
        .values(keys.map((key) => ({ key })))
        .onConflictDoNothing(),
    );
  });
}
