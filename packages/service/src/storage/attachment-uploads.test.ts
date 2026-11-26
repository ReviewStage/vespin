import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { readAttachmentBlobTombstones } from "@repo/database/models/attachment-blob-tombstones";
import { getTestDB } from "@repo/database/testing";
import { INBOX_IMAGE_TYPE } from "@repo/features/inbox-wire";
import { pngBytes } from "@repo/wire/testing";
import { Effect, Exit, Layer } from "effect";
import { memoryBlobStore } from "../testing/blob-store-fake.js";
import { putAttachment, withAttachmentUploads } from "./attachment-uploads.js";

/**
 * attachment-uploads.test.ts -- an upload whose write failed is tombstoned for the sweep, so no object stands in the Blob store that no row names.
 *
 * Synthetic bytes throughout.
 */

const blobs = memoryBlobStore();

it.layer(Layer.merge(getTestDB(), blobs.layer))("a new attachment's uploads", (it) => {
  it.effect("a write that fails after its upload leaves the upload tombstoned", () =>
    Effect.gen(function* () {
      let blobKey: string | undefined;

      const failed = yield* Effect.exit(
        withAttachmentUploads(
          Effect.flatMap(putAttachment(pngBytes(4, 3), INBOX_IMAGE_TYPE.PNG), (stored) => {
            blobKey = stored.blobKey;

            return Effect.fail("the row's write failed");
          }),
        ),
      );

      assert.ok(Exit.isFailure(failed));
      assert.ok(blobKey !== undefined && blobs.objects.has(blobKey));
      assert.ok((yield* readAttachmentBlobTombstones(10_000)).some((one) => one.key === blobKey));
    }),
  );
});
