import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { attachmentBlobTombstone } from "@repo/database/schemas/attachment-blob-tombstone";
import { getTestDB } from "@repo/database/testing";
import { inArray } from "drizzle-orm";
import { ConfigProvider, Effect, Layer } from "effect";
import { memoryBlobStore } from "../testing/blob-store-fake.js";
import { ATTACHMENT_BLOB_VARIANT, attachmentBlobPath } from "./attachment-blob-paths.js";
import { purgeAttachmentBlobs } from "./attachment-blob-purge.js";
import { blobStoreFromEnvironment } from "./blob-store.js";

/**
 * attachment-blob-purge.test.ts -- the sweep deletes tombstoned objects from the store and then their tombstones, tolerating one already gone, and a deployment with no store keeps them.
 *
 * Synthetic ids and bytes throughout.
 */

/** The pathnames a stored recording and its copy for a phone stand at. */
const storedRecording = () => {
  const id = randomUUID();

  return [
    attachmentBlobPath(id, ATTACHMENT_BLOB_VARIANT.ORIGINAL),
    attachmentBlobPath(id, ATTACHMENT_BLOB_VARIANT.PHONE),
  ];
};

const tombstone = (keys: readonly string[]) =>
  Database.use((db) => db.insert(attachmentBlobTombstone).values(keys.map((key) => ({ key }))));

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

const store = memoryBlobStore();

it.layer(Layer.merge(getTestDB(), store.layer))("the purge over a store", (it) => {
  it.effect(
    "tombstoned objects leave the store and their tombstones go, an object already gone is no failure, and an untombstoned one stands",
    () =>
      Effect.gen(function* () {
        const [original, phone] = storedRecording();
        const [standing] = storedRecording();
        assert.ok(original !== undefined && phone !== undefined && standing !== undefined);

        for (const key of [original, standing]) {
          store.objects.set(key, {
            bytes: new Uint8Array([1]),
            contentType: "video/webm",
            etag: key,
          });
        }

        // Note that the phone copy's object is already gone, as after a purge whose drop failed.
        yield* tombstone([original, phone]);

        assert.equal(yield* purgeAttachmentBlobs(), 2);
        assert.deepEqual([...store.objects.keys()], [standing]);
        assert.deepEqual(yield* tombstonesOf([original, phone]), []);
      }),
  );
});

/** The store as a deployment that names none builds it, whatever this machine's environment holds. */
const unnamedStore = blobStoreFromEnvironment.pipe(
  Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({}))),
);

it.layer(Layer.merge(getTestDB(), unnamedStore))(
  "the purge on a deployment with no store",
  (it) => {
    it.effect("purges nothing and keeps every tombstone for when one is named", () =>
      Effect.gen(function* () {
        const keys = storedRecording();
        yield* tombstone(keys);

        assert.equal(yield* purgeAttachmentBlobs(), 0);
        assert.deepEqual(yield* tombstonesOf(keys), [...keys].sort());
      }),
    );
  },
);
