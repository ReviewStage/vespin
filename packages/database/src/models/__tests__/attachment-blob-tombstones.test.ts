import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { attachment } from "../../schemas/attachment.js";
import { attachmentBlobTombstone } from "../../schemas/attachment-blob-tombstone.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  dropAttachmentBlobTombstones,
  readAttachmentBlobTombstones,
  tombstoneUnwrittenUploads,
} from "../attachment-blob-tombstones.js";
import { deleteConversations } from "../conversation-delete.js";

/**
 * attachment-blob-tombstones.test.ts -- a stored attachment's objects tombstoned by its owner's cascade, and the sweep's batch read and drop of them.
 *
 * Synthetic accounts, pathnames, and bytes throughout.
 */

const openConversation = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

  const [row] = yield* db
    .insert(conversations)
    .values({ userId, kind: CONVERSATION_KIND.AGENT })
    .returning({ id: conversations.id });

  assert.ok(row);

  return { userId, conversationId: row.id };
});

/** A conversation's picture's columns but its bytes and where they stand. */
const pictureOf = (userId: string, conversationId: string) => ({
  id: randomUUID(),
  userId,
  conversationId,
  sha256: randomUUID(),
  width: 1280,
  height: 720,
  createdAt: new Date(),
});

it.layer(getTestDB())("a stored attachment's tombstones", (it) => {
  it.effect(
    "a conversation's delete tombstones its stored recording and its copy for a phone, and an inline picture leaves none",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { userId, conversationId } = yield* openConversation;
        const stored = pictureOf(userId, conversationId);
        const inline = pictureOf(userId, conversationId);
        const blobKey = `attachments/${stored.id}`;
        const phoneBlobKey = `attachments/${stored.id}/phone`;

        yield* db.insert(attachment).values([
          {
            ...stored,
            contentType: CONVERSATION_MEDIA_TYPE.WEBM,
            byteCount: 2_000,
            blobKey,
            phoneBlobKey,
            phoneByteCount: 1_500,
          },
          {
            ...inline,
            contentType: CONVERSATION_MEDIA_TYPE.PNG,
            byteCount: 3,
            bytes: new Uint8Array([1, 2, 3]),
          },
        ]);

        yield* deleteConversations([conversationId]);

        const tombstoned = (yield* readAttachmentBlobTombstones(1_000)).map(
          (tombstone) => tombstone.key,
        );

        assert.deepEqual(
          tombstoned.filter((key) => key.includes(stored.id) || key.includes(inline.id)),
          [blobKey, phoneBlobKey],
        );
      }),
  );

  it.effect("a batch reads the oldest first, and a dropped tombstone is not read again", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const oldest = `attachments/${randomUUID()}`;
      const older = `attachments/${randomUUID()}`;

      // Note that these stand before any other test's tombstones, so the batch reads them first.
      yield* db.insert(attachmentBlobTombstone).values([
        { key: older, createdAt: new Date("2000-01-02T00:00:00Z") },
        { key: oldest, createdAt: new Date("2000-01-01T00:00:00Z") },
      ]);

      const batch = yield* readAttachmentBlobTombstones(2);

      assert.deepEqual(
        batch.map((tombstone) => tombstone.key),
        [oldest, older],
      );

      yield* dropAttachmentBlobTombstones(batch.slice(0, 1));

      const rest = yield* readAttachmentBlobTombstones(1);

      assert.deepEqual(
        rest.map((tombstone) => tombstone.key),
        [older],
      );

      yield* dropAttachmentBlobTombstones(rest);
    }),
  );

  it.effect(
    "an upload whose row was never written is tombstoned, and one whose row stands is not",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { userId, conversationId } = yield* openConversation;
        const written = pictureOf(userId, conversationId);
        const unwritten = randomUUID();
        const writtenKey = `attachments/${written.id}`;
        const unwrittenKey = `attachments/${unwritten}`;

        yield* db.insert(attachment).values({
          ...written,
          contentType: CONVERSATION_MEDIA_TYPE.PNG,
          byteCount: 3,
          blobKey: writtenKey,
        });

        yield* tombstoneUnwrittenUploads([
          { id: written.id, keys: [writtenKey] },
          { id: unwritten, keys: [unwrittenKey] },
        ]);

        const tombstoned = (yield* readAttachmentBlobTombstones(1_000)).filter(
          (tombstone) => tombstone.key === writtenKey || tombstone.key === unwrittenKey,
        );

        assert.deepEqual(
          tombstoned.map((tombstone) => tombstone.key),
          [unwrittenKey],
        );

        yield* dropAttachmentBlobTombstones(tombstoned);
      }),
  );
});
