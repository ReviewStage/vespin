import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { AUDIO_TYPE } from "@repo/features/audio-signature";
import {
  CONVERSATION_MEDIA_TYPE,
  type ConversationMediaType,
} from "@repo/features/conversation-picture-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { eq, inArray } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { attachment } from "../../schemas/attachment.js";
import { attachmentBlobTombstone } from "../../schemas/attachment-blob-tombstone.js";
import { user } from "../../schemas/auth.js";
import { conversations } from "../../schemas/storage.js";
import { CONVERSATION_KIND } from "../../storage-vocabulary.js";
import { getTestDB } from "../../testing/index.js";
import {
  ATTACHMENT_CLAIM,
  claimAttachmentBlobs,
  readInlineAttachmentBytes,
  readInlineAttachments,
  tombstoneAttachmentBlobs,
} from "../attachment-blob-backfill.js";
import { readAttachmentBlobTombstones } from "../attachment-blob-tombstones.js";

/**
 * attachment-blob-backfill.test.ts -- the backfill's batch and byte reads of rows kept inline, and its claim on the objects written for one, whose tombstones the purge reads only once the row is gone.
 *
 * Synthetic accounts, pathnames, and bytes throughout.
 */

/** A conversation's recording or clip, kept inline with its copy for a phone. */
const keepInline = (contentType: ConversationMediaType) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });

    const [conversation] = yield* db
      .insert(conversations)
      .values({ userId, kind: CONVERSATION_KIND.AGENT })
      .returning({ id: conversations.id });

    assert.ok(conversation);
    const id = randomUUID();

    yield* db.insert(attachment).values({
      id,
      userId,
      conversationId: conversation.id,
      sha256: randomUUID(),
      width: 1280,
      height: 720,
      contentType,
      byteCount: 3,
      bytes: new Uint8Array([1, 2, 3]),
      mp4Bytes: new Uint8Array([4, 5]),
      phoneByteCount: 2,
      createdAt: new Date(),
    });

    return id;
  });

const keysOf = (id: string) => ({
  blobKey: `attachments/${id}`,
  phoneBlobKey: `attachments/${id}/phone`,
});

const tombstonesOf = (keys: readonly string[]) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ key: attachmentBlobTombstone.key })
        .from(attachmentBlobTombstone)
        .where(inArray(attachmentBlobTombstone.key, [...keys])),
    ),
    (rows) => rows.map((row) => row.key).sort(),
  );

it.layer(getTestDB())("the backfill's reads and claim", (it) => {
  it.effect(
    "a row kept inline is read with its copy's bytes counted and typed, and a claim moves it out of the batch",
    () =>
      Effect.gen(function* () {
        const recording = yield* keepInline(CONVERSATION_MEDIA_TYPE.WEBM);
        const clip = yield* keepInline(AUDIO_TYPE.OGG);

        const batch = yield* readInlineAttachments(1_000);
        assert.deepEqual(
          batch
            .filter((row) => row.id === recording || row.id === clip)
            .map((row) => row.byteCount),
          [5, 5],
        );

        const read = yield* readInlineAttachmentBytes(clip);
        assert.ok(Option.isSome(read));
        assert.deepEqual(read.value.original, {
          bytes: new Uint8Array([1, 2, 3]),
          contentType: AUDIO_TYPE.OGG,
        });
        assert.deepEqual(read.value.phone, {
          bytes: new Uint8Array([4, 5]),
          contentType: AUDIO_TYPE.M4A,
        });
        const recordingRead = yield* readInlineAttachmentBytes(recording);
        assert.equal(Option.getOrThrow(recordingRead).phone?.contentType, MP4_TYPE);

        assert.equal(yield* claimAttachmentBlobs(clip, keysOf(clip)), ATTACHMENT_CLAIM.MOVED);

        const db = yield* Database;

        const [row] = yield* db
          .select({
            bytes: attachment.bytes,
            mp4Bytes: attachment.mp4Bytes,
            blobKey: attachment.blobKey,
            phoneBlobKey: attachment.phoneBlobKey,
            phoneByteCount: attachment.phoneByteCount,
          })
          .from(attachment)
          .where(eq(attachment.id, clip));

        assert.deepEqual(row, { ...keysOf(clip), bytes: null, mp4Bytes: null, phoneByteCount: 2 });
        assert.ok(!(yield* readInlineAttachments(1_000)).some((inline) => inline.id === clip));
        assert.ok(Option.isNone(yield* readInlineAttachmentBytes(clip)));
      }),
  );

  it.effect(
    "the purge reads a written key's tombstone only once its row is gone: never while a claim names it, a second sweep's lost claim among them",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const moved = yield* keepInline(CONVERSATION_MEDIA_TYPE.WEBM);
        const deleted = yield* keepInline(CONVERSATION_MEDIA_TYPE.WEBM);

        const purgeable = () =>
          Effect.map(readAttachmentBlobTombstones(100_000), (tombstones) =>
            tombstones
              .map((tombstone) => tombstone.key)
              .filter((key) => key.includes(moved) || key.includes(deleted))
              .sort(),
          );

        yield* tombstoneAttachmentBlobs(keysOf(moved));
        assert.equal(yield* claimAttachmentBlobs(moved, keysOf(moved)), ATTACHMENT_CLAIM.MOVED);
        assert.deepEqual(yield* tombstonesOf(Object.values(keysOf(moved))), []);

        // A second sweep wrote the same keys and lost the claim: its tombstones stand, but the purge passes them by.
        yield* tombstoneAttachmentBlobs(keysOf(moved));
        assert.equal(yield* claimAttachmentBlobs(moved, keysOf(moved)), ATTACHMENT_CLAIM.GONE);

        yield* tombstoneAttachmentBlobs(keysOf(deleted));
        yield* db.delete(attachment).where(eq(attachment.id, deleted));
        assert.equal(yield* claimAttachmentBlobs(deleted, keysOf(deleted)), ATTACHMENT_CLAIM.GONE);
        assert.deepEqual(yield* purgeable(), Object.values(keysOf(deleted)).sort());

        yield* db.delete(attachment).where(eq(attachment.id, moved));
        assert.deepEqual(
          yield* purgeable(),
          [...Object.values(keysOf(deleted)), ...Object.values(keysOf(moved))].sort(),
        );
      }),
  );
});
