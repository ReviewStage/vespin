/**
 * attachment-blob-purge.ts -- the sweep's purge of deleted attachments' objects from the Blob store, through the tombstones their rows left.
 *
 * A deleted attachment is unreachable at once, since nothing names its
 * object but its row; its object leaves the store here, within the minute
 * the sweep runs on. A batch of tombstones is taken oldest first and
 * deleted a request at a time, each request's tombstones dropped only once
 * the store answered it, so a failure leaves the rest standing for the next
 * sweep. An object already gone is no failure, so a batch two sweeps took at
 * once, or one whose drop failed after its delete, is deleted again
 * harmlessly. A deployment that names no store purges nothing and keeps
 * every tombstone until one is named.
 */

import {
  dropAttachmentBlobTombstones,
  readAttachmentBlobTombstones,
} from "@repo/database/models/attachment-blob-tombstones";
import { Array as Arr, Effect } from "effect";
import { ATTACHMENT_BLOB_PURGE } from "../maintenance/maintenance-bounds.js";
import { BLOB_STORE_FAILURE, BlobStore, type BlobStoreFailure } from "./blob-store.js";

/** Whether the store failed only because this deployment names none, which no retry this minute would mend. */
const isUnconfigured = (failure: BlobStoreFailure) =>
  failure.reason === BLOB_STORE_FAILURE.UNCONFIGURED;

/** Deletes a sweep's worth of tombstoned objects and then their tombstones, answering how many it purged. */
export const purgeAttachmentBlobs = /* @__PURE__ */ Effect.fn("storage/purgeAttachmentBlobs")(
  function* () {
    const store = yield* BlobStore;
    const keys = yield* readAttachmentBlobTombstones(ATTACHMENT_BLOB_PURGE.TOMBSTONES_PER_SWEEP);
    let purged = 0;

    for (const batch of Arr.chunksOf(keys, ATTACHMENT_BLOB_PURGE.PATHNAMES_PER_DELETE)) {
      const deleted = yield* store.delete(batch).pipe(
        Effect.as(true),
        Effect.catchIf(isUnconfigured, () => Effect.succeed(false)),
      );

      if (!deleted) break;
      yield* dropAttachmentBlobTombstones(batch);
      purged += batch.length;
    }

    return purged;
  },
);
