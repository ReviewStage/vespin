import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database, type DatabaseServices } from "@repo/database/core/query";
import {
  claimAttachmentBlobs,
  tombstoneAttachmentBlobs,
} from "@repo/database/models/attachment-blob-backfill";
import {
  ATTACHMENT_BODY,
  attachmentBodyOf,
  phoneBodyOf,
} from "@repo/database/models/attachment-body";
import { attachment } from "@repo/database/schemas/attachment";
import { user } from "@repo/database/schemas/auth";
import { conversations } from "@repo/database/schemas/storage";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { getTestDB } from "@repo/database/testing";
import {
  CONVERSATION_MEDIA_TYPE,
  type ConversationMediaType,
} from "@repo/features/conversation-picture-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { eq } from "drizzle-orm";
import { ConfigProvider, Effect, Exit, Layer, Option } from "effect";
import { memoryBlobStore } from "../testing/blob-store-fake.js";
import { moveAttachmentsToBlob } from "./attachment-blob-backfill.js";
import { ATTACHMENT_BLOB_VARIANT, attachmentBlobPath } from "./attachment-blob-paths.js";
import { purgeAttachmentBlobs } from "./attachment-blob-purge.js";
import { attachmentBytes } from "./attachment-bytes.js";
import {
  BLOB_STORE_FAILURE,
  BLOB_STORE_OPERATION,
  BlobStore,
  BlobStoreFailure,
  blobStoreFromEnvironment,
} from "./blob-store.js";

/**
 * attachment-blob-backfill.test.ts -- the sweep moves attachments kept inline into the store byte for byte, a write the store refuses, or a deployment with no store, leaves their bytes in the row, and what a write leaves unclaimed is purged once its row goes, never before.
 *
 * Synthetic accounts and bytes throughout.
 */

/** A conversation's picture kept inline, with a copy for a phone where one is given. */
const keepInline = (contentType: ConversationMediaType, bytes: Uint8Array, phone?: Uint8Array) =>
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
      byteCount: bytes.byteLength,
      bytes,
      mp4Bytes: phone ?? null,
      phoneByteCount: phone?.byteLength ?? null,
      createdAt: new Date(),
    });

    return id;
  });

/** Where the row's bytes stand, and its copy for a phone's. */
const bodiesOf = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database;

    const [row] = yield* db
      .select({
        bytes: attachment.bytes,
        blobKey: attachment.blobKey,
        mp4Bytes: attachment.mp4Bytes,
        phoneBlobKey: attachment.phoneBlobKey,
      })
      .from(attachment)
      .where(eq(attachment.id, id));

    assert.ok(row);

    return { original: attachmentBodyOf(row), phone: phoneBodyOf(row) };
  });

const store = memoryBlobStore();

it.layer(Layer.merge(getTestDB(), store.layer))("the backfill over a store", (it) => {
  it.effect(
    "rows kept inline move into the store byte for byte under their types, and a sweep with none left moves nothing",
    () =>
      Effect.gen(function* () {
        const picture = yield* keepInline(CONVERSATION_MEDIA_TYPE.PNG, new Uint8Array([1, 2, 3]));

        const recording = yield* keepInline(
          CONVERSATION_MEDIA_TYPE.WEBM,
          new Uint8Array([4, 5, 6, 7]),
          new Uint8Array([8, 9]),
        );

        assert.equal(yield* moveAttachmentsToBlob(), 2);
        assert.equal(yield* moveAttachmentsToBlob(), 0);

        const moved = yield* bodiesOf(recording);
        assert.equal(moved.original.kind, ATTACHMENT_BODY.STORED);
        assert.deepEqual(
          Option.getOrThrow(yield* attachmentBytes(moved.original)),
          new Uint8Array([4, 5, 6, 7]),
        );
        assert.ok(moved.phone !== undefined);
        assert.deepEqual(
          Option.getOrThrow(yield* attachmentBytes(moved.phone)),
          new Uint8Array([8, 9]),
        );

        const kept = yield* bodiesOf(picture);
        assert.equal(kept.phone, undefined);
        assert.deepEqual(
          Option.getOrThrow(yield* attachmentBytes(kept.original)),
          new Uint8Array([1, 2, 3]),
        );
        assert.deepEqual(
          [...store.objects.values()].map((object) => object.contentType).sort(),
          [CONVERSATION_MEDIA_TYPE.PNG, CONVERSATION_MEDIA_TYPE.WEBM, MP4_TYPE].sort(),
        );
      }),
  );

  it.effect(
    "a write the store refuses leaves the row's bytes inline and fails the sweep, and the next sweep moves it",
    () =>
      Effect.gen(function* () {
        const id = yield* keepInline(CONVERSATION_MEDIA_TYPE.PNG, new Uint8Array([10, 11]));
        const working = yield* BlobStore;

        const refusing = {
          ...working,
          put: (pathname: string) =>
            Effect.fail(
              new BlobStoreFailure({
                operation: BLOB_STORE_OPERATION.PUT,
                reason: BLOB_STORE_FAILURE.REQUEST,
                pathnames: [pathname],
              }),
            ),
        };

        const exit = yield* Effect.exit(
          Effect.provideService(moveAttachmentsToBlob(), BlobStore, refusing),
        );

        assert.ok(Exit.isFailure(exit));
        assert.deepEqual((yield* bodiesOf(id)).original, {
          kind: ATTACHMENT_BODY.INLINE,
          bytes: new Uint8Array([10, 11]),
        });

        assert.equal(yield* moveAttachmentsToBlob(), 1);
        const moved = (yield* bodiesOf(id)).original;
        assert.equal(moved.kind, ATTACHMENT_BODY.STORED);
        assert.deepEqual(
          Option.getOrThrow(yield* attachmentBytes(moved)),
          new Uint8Array([10, 11]),
        );
      }),
  );

  it.effect(
    "two sweeps at once move every row once between them, and the purge after them takes no object a row names",
    () =>
      Effect.gen(function* () {
        const ids = yield* Effect.forEach([1, 2, 3, 4, 5, 6], (byte) =>
          keepInline(CONVERSATION_MEDIA_TYPE.PNG, new Uint8Array([byte, byte])),
        );

        const [first, second] = yield* Effect.all(
          [moveAttachmentsToBlob(), moveAttachmentsToBlob()],
          { concurrency: 2 },
        );

        assert.equal(first + second, ids.length);

        yield* purgeAttachmentBlobs();

        for (const [index, id] of ids.entries()) {
          const body = (yield* bodiesOf(id)).original;
          const byte = index + 1;

          assert.equal(body.kind, ATTACHMENT_BODY.STORED);
          assert.deepEqual(
            Option.getOrThrow(yield* attachmentBytes(body)),
            new Uint8Array([byte, byte]),
          );
        }
      }),
  );

  it.effect(
    "an original written beside a copy for a phone the store refused is purged once its row is deleted",
    () =>
      Effect.gen(function* () {
        const id = yield* keepInline(
          CONVERSATION_MEDIA_TYPE.WEBM,
          new Uint8Array([13, 14]),
          new Uint8Array([15]),
        );

        const working = yield* BlobStore;
        const original = attachmentBlobPath(id, ATTACHMENT_BLOB_VARIANT.ORIGINAL);

        const refusingPhone = {
          ...working,
          put: (pathname: string, bytes: Uint8Array, contentType: string) =>
            pathname === original
              ? working.put(pathname, bytes, contentType)
              : Effect.fail(
                  new BlobStoreFailure({
                    operation: BLOB_STORE_OPERATION.PUT,
                    reason: BLOB_STORE_FAILURE.REQUEST,
                    pathnames: [pathname],
                  }),
                ),
        };

        yield* Effect.exit(
          Effect.provideService(moveAttachmentsToBlob(), BlobStore, refusingPhone),
        );
        assert.ok(store.objects.has(original));

        // The row keeps its bytes inline, so its delete tombstones nothing of its own.
        yield* Database.use((db) => db.delete(attachment).where(eq(attachment.id, id)));
        yield* purgeAttachmentBlobs();

        assert.equal(store.objects.has(original), false);
      }),
  );

  it.effect(
    "a write that lands after its row was deleted and its tombstones purged is purged by the next sweep",
    () =>
      Effect.gen(function* () {
        const id = yield* keepInline(CONVERSATION_MEDIA_TYPE.PNG, new Uint8Array([16, 17]));
        const working = yield* BlobStore;
        const original = attachmentBlobPath(id, ATTACHMENT_BLOB_VARIANT.ORIGINAL);

        // The row goes, and a concurrent sweep purges its tombstones, while the write is still on its way.
        const landingLate = {
          ...working,
          put: (pathname: string, bytes: Uint8Array, contentType: string) =>
            Effect.gen(function* () {
              yield* Database.use((db) => db.delete(attachment).where(eq(attachment.id, id)));
              yield* purgeAttachmentBlobs();
              yield* working.put(pathname, bytes, contentType);
            }),
        };

        assert.equal(
          yield* Effect.provideService(moveAttachmentsToBlob(), BlobStore, landingLate),
          0,
        );
        assert.ok(store.objects.has(original));

        yield* purgeAttachmentBlobs();

        assert.equal(store.objects.has(original), false);
      }),
  );

  it.effect(
    "a write that lands while the purge deletes its gone row's objects is purged by the next sweep",
    () =>
      Effect.gen(function* () {
        const id = yield* keepInline(CONVERSATION_MEDIA_TYPE.PNG, new Uint8Array([18, 19]));
        const working = yield* BlobStore;

        const keys = {
          blobKey: attachmentBlobPath(id, ATTACHMENT_BLOB_VARIANT.ORIGINAL),
          phoneBlobKey: null,
        };

        yield* tombstoneAttachmentBlobs(keys);
        yield* Database.use((db) => db.delete(attachment).where(eq(attachment.id, id)));

        const services = yield* Effect.context<DatabaseServices>();

        // The sweep's write lands, and its claim finds the row gone, after the purge's delete and before it drops the tombstone.
        const landingMidPurge = {
          ...working,
          delete: (pathnames: ReadonlyArray<string>) =>
            working
              .delete(pathnames)
              .pipe(
                Effect.andThen(working.put(keys.blobKey, new Uint8Array([18, 19]), "image/png")),
                Effect.andThen(claimAttachmentBlobs(id, keys)),
                Effect.provideContext(services),
                Effect.orDie,
                Effect.asVoid,
              ),
        };

        yield* Effect.provideService(purgeAttachmentBlobs(), BlobStore, landingMidPurge);
        assert.ok(store.objects.has(keys.blobKey));

        yield* purgeAttachmentBlobs();

        assert.equal(store.objects.has(keys.blobKey), false);
      }),
  );
});

/** The store as a deployment that names none builds it, whatever this machine's environment holds. */
const unnamedStore = blobStoreFromEnvironment.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
);

it.layer(Layer.merge(getTestDB(), unnamedStore))(
  "the backfill on a deployment with no store",
  (it) => {
    it.effect("moves nothing and leaves every row's bytes inline", () =>
      Effect.gen(function* () {
        const id = yield* keepInline(CONVERSATION_MEDIA_TYPE.PNG, new Uint8Array([12]));

        assert.equal(yield* moveAttachmentsToBlob(), 0);
        assert.equal((yield* bodiesOf(id)).original.kind, ATTACHMENT_BODY.INLINE);
      }),
    );
  },
);
