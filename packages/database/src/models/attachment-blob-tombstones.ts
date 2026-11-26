/**
 * attachment-blob-tombstones.ts -- the Blob store's objects whose attachments are gone: read a batch of them, and drop those whose objects were deleted.
 *
 * A tombstone is written by the trigger on `attachment` as a row that named
 * a stored object goes (`../schemas/attachment-blob-tombstone.ts`), never by
 * a call here. The sweep reads a batch, deletes their objects, and only then
 * drops their tombstones, so an object whose delete failed keeps its
 * tombstone for the next sweep. Two sweeps that read the same batch delete
 * the same objects twice, which the store answers as done, and drop the same
 * tombstones twice, which drops nothing the second time.
 */

import { asc, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { attachmentBlobTombstone } from "../schemas/attachment-blob-tombstone.js";

type TombstoneEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** Up to `limit` tombstoned pathnames, the oldest first. */
export function readAttachmentBlobTombstones(limit: number): TombstoneEffect<readonly string[]> {
  return Effect.map(
    Database.use((db) =>
      db
        .select({ key: attachmentBlobTombstone.key })
        .from(attachmentBlobTombstone)
        .orderBy(asc(attachmentBlobTombstone.createdAt), asc(attachmentBlobTombstone.key))
        .limit(limit),
    ),
    (rows) => rows.map((row) => row.key),
  );
}

/** The tombstones of `keys` dropped, once their objects are gone from the store. */
export function dropAttachmentBlobTombstones(keys: readonly string[]): TombstoneEffect<void> {
  if (keys.length === 0) return Effect.void;

  return Effect.asVoid(
    Database.use((db) =>
      db.delete(attachmentBlobTombstone).where(inArray(attachmentBlobTombstone.key, [...keys])),
    ),
  );
}
