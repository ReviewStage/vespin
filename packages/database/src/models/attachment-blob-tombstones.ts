/**
 * attachment-blob-tombstones.ts -- the Blob store's objects whose attachments are gone: read a batch of them, and drop those whose objects were deleted.
 *
 * A tombstone is written by the trigger on `attachment` as a row that named
 * a stored object goes (`../schemas/attachment-blob-tombstone.ts`), never by
 * a call here, but for an upload whose row was never written
 * (`tombstoneUnwrittenUploads`). The sweep reads a batch, deletes their objects, and only then
 * drops their tombstones, so an object whose delete failed keeps its
 * tombstone for the next sweep. Two sweeps that read the same batch delete
 * the same objects twice, which the store answers as done, and drop the same
 * tombstones twice, which drops nothing the second time.
 */

import { asc, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { attachment } from "../schemas/attachment.js";
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
