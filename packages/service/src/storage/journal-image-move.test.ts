import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { keepConversationPicture } from "@repo/database/models/conversation-pictures";
import { attachment } from "@repo/database/schemas/attachment";
import { attachmentBlobTombstone } from "@repo/database/schemas/attachment-blob-tombstone";
import { journalImageMove, journalImageRewrite } from "@repo/database/schemas/journal-image-move";
import { messages } from "@repo/database/schemas/storage";
import { getTestDB, inlineImagePart, queueJournalLine } from "@repo/database/testing";
import { INBOX_IMAGE_TYPE } from "@repo/features/inbox-wire";
import { messageFileChips } from "@repo/features/message-files";
import { MESSAGE_ROLE, type WireValue } from "@repo/wire";
import { pngBytes } from "@repo/wire/testing";
import { eq, sql } from "drizzle-orm";
import { ConfigProvider, Effect, Layer, Option } from "effect";
import { memoryBlobStore } from "../testing/blob-store-fake.js";
import { attachmentBlobPath } from "./attachment-blob-paths.js";
import { readConversationPictureBytes } from "./attachment-bytes.js";
import { BlobStore, blobStoreFromEnvironment } from "./blob-store.js";
import { moveJournalImages } from "./journal-image-move.js";

/**
 * journal-image-move.test.ts -- the sweep's move of a line's inline images into Blob-backed pictures: the transcript reads the same files in the same order, each served the bytes it held, and a row it cannot move, or a store that keeps nothing, leaves the journal as it stands.
 *
 * Synthetic accounts and pictures throughout.
 */

const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** The journal's row's parts as it stands, as the wire carries them. */
const partsOf = (messageId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ parts: sql<readonly WireValue[]>`${messages.parts}` })
        .from(messages)
        .where(eq(messages.id, messageId)),
    ),
    ([row]) => row?.parts ?? [],
  );

/** The row's files as the transcript lists them (`messageFileChips`). */
const chipsOf = (messageId: string, parts: readonly WireValue[]) =>
  messageFileChips({ id: messageId, role: MESSAGE_ROLE.USER, parts });

/** Whether the row still waits in the queue, and why it was passed over where it was. */
const queuedOf = (messageId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ failure: journalImageMove.failure })
        .from(journalImageMove)
        .where(eq(journalImageMove.messageId, messageId)),
    ),
    ([row]) => row,
  );

const store = memoryBlobStore();

it.layer(Layer.merge(getTestDB(), store.layer))("the journal image move over a store", (it) => {
  it.effect(
    "a line's images become the conversation's pictures in Blob: the same files in the same order, each served its own bytes, the bytes it already kept reused",
    () =>
      Effect.gen(function* () {
        const screen = pngBytes(1280, 720, 1);
        const sketch = pngBytes(640, 480, 2);

        const line = yield* queueJournalLine([
          { type: "text", text: "Here is what I see." },
          inlineImagePart(screen, INBOX_IMAGE_TYPE.PNG, "screen.png"),
          inlineImagePart(sketch, INBOX_IMAGE_TYPE.PNG, "sketch.png"),
          inlineImagePart(screen, INBOX_IMAGE_TYPE.PNG, "screen again.png"),
        ]);

        // The conversation already keeps the sketch, as a later line's image would have kept it.
        const held = yield* keepConversationPicture(line, {
          bytes: sketch,
          contentType: INBOX_IMAGE_TYPE.PNG,
          width: 640,
          height: 480,
        });

        assert.ok(Option.isSome(held));
        const before = chipsOf(line.messageId, yield* partsOf(line.messageId));

        assert.equal(yield* moveJournalImages(), 3);

        const parts = yield* partsOf(line.messageId);
        const after = chipsOf(line.messageId, parts);

        assert.deepEqual(parts[0], { type: "text", text: "Here is what I see." });
        assert.deepEqual(
          after.map(({ name, mediaType, url }) => ({ name, mediaType, url })),
          before.map(({ name, mediaType }) => ({ name, mediaType, url: "" })),
        );

        const [screenId, sketchId, againId] = after.map((chip) => chip.pictureId);
        assert.ok(screenId !== undefined && sketchId !== undefined);
        assert.equal(againId, screenId, "the same bytes are one picture");
        assert.equal(sketchId, held.value.id, "bytes the conversation kept are named, not stored");

        for (const [id, bytes] of [
          [screenId, screen],
          [sketchId, sketch],
        ] as const) {
          const served = yield* readConversationPictureBytes(line.conversationId, id);
          assert.ok(Option.isSome(served));
          assert.equal(sha256Of(served.value.bytes), sha256Of(bytes));
        }

        assert.ok(store.objects.has(attachmentBlobPath(screenId)));
        assert.equal(yield* queuedOf(line.messageId), undefined);

        const logged = yield* Database.use((db) =>
          db
            .select({
              partIndex: journalImageRewrite.partIndex,
              id: journalImageRewrite.attachmentId,
            })
            .from(journalImageRewrite)
            .where(eq(journalImageRewrite.messageId, line.messageId))
            .orderBy(journalImageRewrite.partIndex),
        );

        assert.deepEqual(logged, [
          { partIndex: 1, id: screenId },
          { partIndex: 2, id: sketchId },
          { partIndex: 3, id: screenId },
        ]);
      }),
  );

  it.effect(
    "a line whose image states no size is passed over and kept as it stands, and no later sweep takes it",
    () =>
      Effect.gen(function* () {
        const parts = [
          inlineImagePart(new Uint8Array([1, 2, 3]), INBOX_IMAGE_TYPE.PNG, "broken.png"),
        ];

        const line = yield* queueJournalLine(parts);

        yield* moveJournalImages();
        yield* moveJournalImages();

        assert.deepEqual(yield* partsOf(line.messageId), parts);
        assert.deepEqual(yield* queuedOf(line.messageId), { failure: "unsupported" });
      }),
  );
});

/** A store that answers every write as done but keeps none of it, so what is read back is not what was written. */
const losingStore = Layer.effect(
  BlobStore,
  Effect.gen(function* () {
    const kept = yield* BlobStore;

    return { ...kept, put: () => Effect.void };
  }),
).pipe(Layer.provide(memoryBlobStore().layer));

it.layer(Layer.merge(getTestDB(), losingStore))(
  "the journal image move over a store that loses its writes",
  (it) => {
    it.effect("leaves the line as it stands, queued, and tombstones what it uploaded", () =>
      Effect.gen(function* () {
        const parts = [inlineImagePart(pngBytes(320, 200, 3), INBOX_IMAGE_TYPE.PNG, "lost.png")];
        const line = yield* queueJournalLine(parts);

        const moved = yield* Effect.exit(moveJournalImages());

        assert.equal(moved._tag, "Failure");
        assert.deepEqual(yield* partsOf(line.messageId), parts);
        assert.deepEqual(yield* queuedOf(line.messageId), { failure: null });

        const pictures = yield* Database.use((db) =>
          db
            .select({ id: attachment.id })
            .from(attachment)
            .where(eq(attachment.conversationId, line.conversationId)),
        );

        const tombstones = yield* Database.use((db) =>
          db.select({ key: attachmentBlobTombstone.key }).from(attachmentBlobTombstone),
        );

        assert.deepEqual(pictures, []);
        assert.equal(tombstones.length, 1);
      }),
    );
  },
);

/** The store as a deployment that names none builds it, whatever this machine's environment holds. */
const unnamedStore = blobStoreFromEnvironment.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
);

it.layer(Layer.merge(getTestDB(), unnamedStore))("the journal image move with no store", (it) => {
  it.effect("moves nothing and keeps the line queued for when one is named", () =>
    Effect.gen(function* () {
      const parts = [inlineImagePart(pngBytes(320, 200, 4), INBOX_IMAGE_TYPE.PNG, "kept.png")];
      const line = yield* queueJournalLine(parts);

      assert.equal(yield* moveJournalImages(), 0);
      assert.deepEqual(yield* partsOf(line.messageId), parts);
      assert.deepEqual(yield* queuedOf(line.messageId), { failure: null });
    }),
  );
});
