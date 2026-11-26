/**
 * blob-store-fake.ts -- the Blob store as a test stands it: objects held in memory, and presigned URLs that name what they would open without opening anything.
 */

import { Clock, Effect, Layer, Option } from "effect";
import { assertPresignLifetime, BLOB_STORE_OPERATION, BlobStore } from "../storage/blob-store.js";

/** The host every fake presigned URL names, which no request ever reaches. */
const FAKE_BLOB_HOST = "https://blob.test";

/** One object as the fake holds it. */
export interface MemoryBlobObject {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly etag: string;
}

/** A presigned URL the fake minted, and what it was minted for. */
export interface MemoryBlobPresign {
  readonly operation:
    | typeof BLOB_STORE_OPERATION.PRESIGN_GET
    | typeof BLOB_STORE_OPERATION.PRESIGN_PUT;
  readonly pathname: string;
  readonly validUntil: number;
  readonly contentType?: string;
  readonly maxBytes?: number;
}

export interface MemoryBlobStore {
  readonly layer: Layer.Layer<never>;
  /** Every object the store holds, by pathname. */
  readonly objects: Map<string, MemoryBlobObject>;
  /** Every presigned URL the store minted, in order. */
  readonly presigned: MemoryBlobPresign[];
}

/** A store in memory: a write replaces, a delete of nothing succeeds, and a presign records what it was asked. */
export function memoryBlobStore(): MemoryBlobStore {
  const objects = new Map<string, MemoryBlobObject>();
  const presigned: MemoryBlobPresign[] = [];
  let writes = 0;

  const presign = (minted: Omit<MemoryBlobPresign, "validUntil">, validForSeconds: number) =>
    Effect.map(Clock.currentTimeMillis, (now) => {
      assertPresignLifetime(validForSeconds);
      const record = { ...minted, validUntil: now + validForSeconds * 1000 };
      const url = new URL(`${FAKE_BLOB_HOST}/${minted.pathname}`);

      presigned.push(record);
      url.searchParams.set("operation", minted.operation);
      url.searchParams.set("valid-until", String(record.validUntil));

      return url.toString();
    });

  const layer = Layer.succeed(BlobStore, {
    put: (pathname, bytes, contentType) =>
      Effect.sync(() => {
        writes += 1;
        objects.set(pathname, { bytes: bytes.slice(), contentType, etag: `"${writes}"` });
      }),
    head: (pathname) =>
      Effect.sync(() =>
        Option.map(Option.fromNullishOr(objects.get(pathname)), (found) => ({
          size: found.bytes.length,
          contentType: found.contentType,
          etag: found.etag,
        })),
      ),
    get: (pathname) =>
      Effect.sync(() =>
        Option.map(Option.fromNullishOr(objects.get(pathname)), (found) => found.bytes.slice()),
      ),
    stream: (pathname) =>
      Effect.sync(() =>
        Option.map(Option.fromNullishOr(objects.get(pathname)), (found) => ({
          stream: new Blob([found.bytes.slice()]).stream(),
          size: found.bytes.length,
          contentType: found.contentType,
        })),
      ),
    getFirstBytes: (pathname, byteCount) =>
      Effect.sync(() =>
        Option.map(Option.fromNullishOr(objects.get(pathname)), (found) =>
          found.bytes.slice(0, byteCount),
        ),
      ),
    presignGet: (pathname, options) =>
      presign({ operation: BLOB_STORE_OPERATION.PRESIGN_GET, pathname }, options.validForSeconds),
    presignPut: (pathname, options) =>
      presign(
        {
          operation: BLOB_STORE_OPERATION.PRESIGN_PUT,
          pathname,
          contentType: options.contentType,
          maxBytes: options.maxBytes,
        },
        options.validForSeconds,
      ),
    delete: (pathnames) =>
      Effect.sync(() => {
        for (const pathname of pathnames) objects.delete(pathname);
      }),
  });

  return { layer, objects, presigned };
}
