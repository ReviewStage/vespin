/**
 * attachment-blob-tombstones.ts -- the Blob store's objects whose attachments are gone: read a batch of them, and drop those whose objects were deleted.
 *
 * A tombstone is written by the trigger on `attachment` as a row that named
 * a stored object goes (`../schemas/attachment-blob-tombstone.ts`), or by the
 * backfill before it writes a row's objects (`./attachment-blob-backfill.ts`),
 * or for an upload its row never came to name (`tombstoneUnwrittenUploads`).
 *
 * The sweep reads only the tombstones of keys no row names or may yet come
 * to name. An attachment's pathname is its row's id (`attachmentBlobPath`),
 * so only that one row could ever name it, and a key is purged once that
 * row is gone, or once it keeps its bytes in the store and names the key as
 * neither `blob_key` nor `phone_blob_key`. Note that the second is safe
 * because a stored row's keys are written once, as the row is inserted
 * under the id they are built from, and never changed: no writer updates a
 * row's keys but the backfill (`./attachment-blob-backfill.ts`), and it
 * claims only a row that still keeps its bytes inline. So no claim can come
 * to name such a key, and its delete can never take an object a row names.
 * A tombstone whose row is still inline, where the backfill may yet claim
 * the key, or whose row names the key, waits, harmless, until that changes.
 *
 * The sweep reads a batch,
 * each at the version it stands at, deletes their objects, and only then
 * drops their tombstones, so an object whose delete failed keeps its
 * tombstone for the next sweep. Two sweeps that read the same batch delete
 * the same objects twice, which the store answers as done, and drop the same
 * tombstones twice, which drops nothing the second time.
 */

import { and, asc, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm";
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

/** Up to `limit` tombstones of keys no row names or may yet name, the oldest first. */
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
              .where(
                and(
                  eq(attachment.id, attachmentIdOfKey),
                  or(
                    isNull(attachment.blobKey),
                    eq(attachment.blobKey, attachmentBlobTombstone.key),
                    eq(attachment.phoneBlobKey, attachmentBlobTombstone.key),
                  ),
                ),
              ),
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
 * Tombstones every object an upload put in the store that its row does not
 * name: all of an upload's objects where its row was never written, and,
 * where it was, any it recorded and the row kept no key of, such as a copy
 * for a phone that landed but was not kept, which the sweep deletes within
 * the minute, since the row keeps its bytes in the store. An upload records
 * only a key it may write (`attachment-uploads.ts`), never one it only
 * reserved, which holds no object. An object the row names stays. It runs once the write's transaction has ended, so
 * an upload whose row landed after all, a commit answered by a failure
 * among them, keeps its objects.
 */
export function tombstoneUnwrittenUploads(
  uploads: readonly AttachmentUpload[],
): TombstoneEffect<void> {
  if (uploads.length === 0) return Effect.void;

  return Effect.gen(function* () {
    const ids = uploads.map((upload) => upload.id);

    const written = yield* Database.use((db) =>
      db
        .select({ blobKey: attachment.blobKey, phoneBlobKey: attachment.phoneBlobKey })
        .from(attachment)
        .where(inArray(attachment.id, ids)),
    );

    const named = new Set(
      written.flatMap((row) => [row.blobKey, row.phoneBlobKey].filter((key) => key !== null)),
    );

    const keys = uploads.flatMap((upload) => upload.keys.filter((key) => !named.has(key)));

    if (keys.length === 0) return;

    yield* Database.use((db) =>
      db
        .insert(attachmentBlobTombstone)
        .values(keys.map((key) => ({ key })))
        .onConflictDoNothing(),
    );
  });
}
