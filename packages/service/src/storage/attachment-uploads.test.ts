import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { readAttachmentBlobTombstones } from "@repo/database/models/attachment-blob-tombstones";
import { storedAttachmentColumns } from "@repo/database/models/attachment-body";
import { attachment } from "@repo/database/schemas/attachment";
import { attachmentBlobTombstone } from "@repo/database/schemas/attachment-blob-tombstone";
import { user } from "@repo/database/schemas/auth";
import { conversations } from "@repo/database/schemas/storage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB } from "@repo/database/testing";
import { INBOX_IMAGE_TYPE } from "@repo/features/inbox-wire";
import { pngBytes } from "@repo/wire/testing";
import { like } from "drizzle-orm";
import { Effect, Exit, Layer } from "effect";
import { memoryBlobStore } from "../testing/blob-store-fake.js";
import { putAttachment, withAttachmentUploads } from "./attachment-uploads.js";

/**
 * attachment-uploads.test.ts -- an upload whose write failed is tombstoned for the sweep, so no object stands in the Blob store that no row names, and one its row keeps leaves no tombstone.
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

  it.effect(
    "a picture its row keeps leaves no tombstone, its unwritten phone copy's among them",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const userId = `user-${randomUUID()}`;
        yield* db
          .insert(user)
          .values({ id: userId, name: "Test User", email: `${userId}@app.test` });

        const [conversation] = yield* db
          .insert(conversations)
          .values({ userId, kind: CONVERSATION_KIND.AGENT })
          .returning({ id: conversations.id });

        assert.ok(conversation);

        const stored = yield* withAttachmentUploads(
          Effect.tap(putAttachment(pngBytes(4, 3), INBOX_IMAGE_TYPE.PNG), (picture) =>
            db.insert(attachment).values({
              ...storedAttachmentColumns(picture),
              userId,
              conversationId: conversation.id,
              contentType: INBOX_IMAGE_TYPE.PNG,
              sha256: randomUUID(),
              width: 4,
              height: 3,
              createdAt: new Date(),
            }),
          ),
        );

        const tombstoned = yield* db
          .select({ key: attachmentBlobTombstone.key })
          .from(attachmentBlobTombstone)
          .where(like(attachmentBlobTombstone.key, `attachments/${stored.id}%`));

        assert.deepEqual(tombstoned, []);
      }),
  );
});
