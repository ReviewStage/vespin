/**
 * attachment-blob-backfill.ts -- the sweep's move of attachments kept before the Blob store, from their rows into it.
 *
 * Each sweep takes a bounded batch of the rows that still keep their bytes
 * inline (`ATTACHMENT_BLOB_BACKFILL`), and moves a few at a time: for each it reads
 * the row's bytes, writes them, and its copy for a phone, to the row's own
 * pathnames, and only then claims them on the row, clearing its bytes in
 * the same statement (`@repo/database/models/attachment-blob-backfill`). No
 * lock is held across a write, so a reader or a delete never waits on the
 * store. Every key is tombstoned before its write and its tombstone dropped
 * by the claim, so an object a row never came to name, because its write
 * half failed, the row was deleted meanwhile, or another sweep moved it
 * first, is purged once its row is gone, and never before, so the purge
 * cannot take an object a concurrent claim names. A reader serves a row the
 * same wherever its bytes stand (`attachment-bytes.ts`), so a move is
 * invisible to it.
 *
 * A row whose write fails keeps its bytes and is taken again next sweep; the
 * rest of the batch still moves, and the sweep fails so its monitor sees it.
 * A deployment that names no store moves nothing. Once no row keeps its bytes inline, the step reads an empty
 * batch and does nothing. Its progress is logged as counts alone, never a
 * key or a URL.
 */

import {
  ATTACHMENT_CLAIM,
  claimAttachmentBlobs,
  countInlineAttachments,
  type InlineAttachment,
  readInlineAttachmentBytes,
  readInlineAttachments,
  tombstoneAttachmentBlobs,
  tombstoneAttachmentBlobsOfGoneRow,
} from "@repo/database/models/attachment-blob-backfill";
import { Data, Effect, Option } from "effect";
import { ATTACHMENT_BLOB_BACKFILL } from "../maintenance/maintenance-bounds.js";
import { ATTACHMENT_BLOB_VARIANT, attachmentBlobPath } from "./attachment-blob-paths.js";
import { BLOB_STORE_FAILURE, BlobStore, type BlobStoreFailure } from "./blob-store.js";

/** What became of one row the sweep took. */
const ROW_MOVE = {
  MOVED: "moved",
  /** Gone, or moved already by another sweep. */
  SKIPPED: "skipped",
  /** The store refused or never answered; the row keeps its bytes. */
  FAILED: "failed",
  /** This deployment names no store, so nothing moves this sweep. */
  UNCONFIGURED: "unconfigured",
} as const;

type RowMove = (typeof ROW_MOVE)[keyof typeof ROW_MOVE];

/** A sweep in which some rows' writes failed: they keep their bytes for the next sweep. */
class AttachmentBackfillFailed extends Data.TaggedError("AttachmentBackfillFailed")<{
  readonly failed: number;
}> {}

/** The batch's first rows within the sweep's byte budget, and always its first, however large. */
function withinBudget(rows: readonly InlineAttachment[]): readonly InlineAttachment[] {
  const taken: InlineAttachment[] = [];
  let bytes = 0;

  for (const row of rows) {
    if (taken.length > 0 && bytes + row.byteCount > ATTACHMENT_BLOB_BACKFILL.BYTES_PER_SWEEP) break;
    taken.push(row);
    bytes += row.byteCount;
  }

  return taken;
}

/** The store's failure as what became of the row. */
const failedMove = (failure: BlobStoreFailure): RowMove =>
  failure.reason === BLOB_STORE_FAILURE.UNCONFIGURED ? ROW_MOVE.UNCONFIGURED : ROW_MOVE.FAILED;

/** Moves one row's bytes into the store and claims them on the row. */
const moveRow = /* @__PURE__ */ Effect.fn("storage/moveAttachmentRow")(function* (id: string) {
  const store = yield* BlobStore;
  const read = yield* readInlineAttachmentBytes(id);

  if (Option.isNone(read)) return ROW_MOVE.SKIPPED;
  const { original, phone } = read.value;
  const blobKey = attachmentBlobPath(id, ATTACHMENT_BLOB_VARIANT.ORIGINAL);

  const phoneBlobKey =
    phone === null ? null : attachmentBlobPath(id, ATTACHMENT_BLOB_VARIANT.PHONE);

  // Note that the keys are tombstoned before the writes, so whatever they leave unclaimed is purged once its row goes.
  yield* tombstoneAttachmentBlobs({ blobKey, phoneBlobKey });

  const written = yield* Effect.gen(function* () {
    yield* store.put(blobKey, original.bytes, original.contentType);

    if (phone !== null && phoneBlobKey !== null) {
      yield* store.put(phoneBlobKey, phone.bytes, phone.contentType);
    }

    return true as const;
  }).pipe(Effect.catchTag("BlobStoreFailure", (failure) => Effect.succeed(failedMove(failure))));

  if (written !== true) {
    // A write refused may still have landed after the purge took the row's tombstones, had the row gone meanwhile.
    yield* tombstoneAttachmentBlobsOfGoneRow(id, { blobKey, phoneBlobKey });

    return written;
  }

  const claim = yield* claimAttachmentBlobs(id, { blobKey, phoneBlobKey });

  return claim === ATTACHMENT_CLAIM.MOVED ? ROW_MOVE.MOVED : ROW_MOVE.SKIPPED;
});

/** Moves a sweep's worth of attachments kept inline into the Blob store, answering how many moved. */
export const moveAttachmentsToBlob = /* @__PURE__ */ Effect.fn("storage/moveAttachmentsToBlob")(
  function* () {
    const batch = withinBudget(
      yield* readInlineAttachments(ATTACHMENT_BLOB_BACKFILL.ROWS_PER_SWEEP),
    );

    const [first, ...rest] = batch;

    if (first === undefined) return 0;
    // The first row alone finds out whether this deployment names a store, before the rest are read.
    const head = yield* moveRow(first.id);

    if (head === ROW_MOVE.UNCONFIGURED) return 0;

    const outcomes = [
      head,
      ...(yield* Effect.forEach(rest, (row) => moveRow(row.id), {
        concurrency: ATTACHMENT_BLOB_BACKFILL.ROWS_AT_ONCE,
      })),
    ];

    const moved = outcomes.filter((outcome) => outcome === ROW_MOVE.MOVED).length;
    const failed = outcomes.filter((outcome) => outcome === ROW_MOVE.FAILED).length;

    if (moved + failed > 0) {
      const left = yield* countInlineAttachments();

      yield* Effect.logInfo(
        `attachment backfill: ${moved} moved, ${failed} failed, ${left} left inline`,
      );
    }

    if (failed > 0) return yield* Effect.fail(new AttachmentBackfillFailed({ failed }));

    return moved;
  },
);
