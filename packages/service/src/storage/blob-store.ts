/**
 * blob-store.ts -- the deployment's private Vercel Blob store, as the one door attachment bytes go in and out by.
 *
 * Every object is private: it is read either by the service, under the
 * function's own OIDC token, or by whoever holds a presigned URL the service
 * minted for that one pathname and one operation, until it expires. The store
 * is the one `BLOB_STORE_ID` names, which the Vercel project's storage
 * connection sets: production's own store on Production, a preview store on
 * Preview and Development. No long-lived read-write token is ever read; the
 * SDK takes the OIDC token from the function's request context
 * (`@vercel/oidc`), or from `VERCEL_OIDC_TOKEN` on a machine that pulled one.
 *
 * Names are pathnames inside the store, built by `attachment-blob-paths.ts`
 * and never at a call site. A write replaces what stood at its pathname, so a
 * retried write lands the same bytes rather than failing. A delete takes any
 * number of pathnames, and one that names nothing is no failure, so a sweep
 * may run it again.
 *
 * What Blob answers that a reader should know (measured against the preview
 * store with SDK 2.9.0): a private object is always served as
 * `Content-Disposition: attachment` named after its pathname's last segment,
 * with `X-Content-Type-Options: nosniff` and a `default-src 'none'` CSP,
 * whatever the URL says, so a presigned URL offers no inline or download
 * choice; a `Range` request answers 206 with `Content-Range`; and a CORS
 * response allows any origin but exposes no header past the safelisted ones
 * and refuses every preflight.
 *
 * Without `BLOB_STORE_ID`, as a local run or a test that sets none, the store
 * answers every call as unavailable and reaches nothing, as the sweep does
 * without `CRON_SECRET`. A failure names its operation and the pathname,
 * never a URL, since a presigned one is a bearer of the object.
 */

import {
  BlobNotFoundError,
  del,
  get,
  head,
  issueSignedToken,
  parseStoreIdFromDelegationToken,
  presignUrl,
  put,
} from "@vercel/blob";
import { Clock, Config, Context, Data, Effect, Layer, Option } from "effect";
import { present } from "../environment.js";

/** The deployment's variable the store is named by, which the project's storage connection sets. */
export const BLOB_STORE_ENVIRONMENT = {
  STORE_ID: "BLOB_STORE_ID",
} as const;

/** What a call on the store was doing when it failed. */
export const BLOB_STORE_OPERATION = {
  PUT: "put",
  HEAD: "head",
  GET: "get",
  PRESIGN_GET: "presign-get",
  PRESIGN_PUT: "presign-put",
  DELETE: "delete",
} as const;

export type BlobStoreOperation = (typeof BLOB_STORE_OPERATION)[keyof typeof BLOB_STORE_OPERATION];

/** Why a call on the store failed: the deployment names no store, or Blob refused or never answered. */
export const BLOB_STORE_FAILURE = {
  UNCONFIGURED: "unconfigured",
  REQUEST: "request",
} as const;

export type BlobStoreFailureReason = (typeof BLOB_STORE_FAILURE)[keyof typeof BLOB_STORE_FAILURE];

/** The longest a presigned URL may live: Blob refuses a signed token that outlives seven days. */
export const BLOB_PRESIGN_MAX_SECONDS = 7 * 24 * 60 * 60;

/** Blob's answer to a range past the end, which an empty object answers to any range. */
const RANGE_NOT_SATISFIABLE = "416";

/** Every object in the store is private. */
const ACCESS = "private";

/**
 * The headers an upload to a presigned URL carries, as the SDK's own
 * presigned `put` sends them (`@vercel/blob` 2.9.0, Blob API version 13):
 * the API version, the store, the object's access and type, and that it may
 * not replace what stands.
 */
const PRESIGNED_PUT_HEADER = {
  API_VERSION: "x-api-version",
  STORE_ID: "x-vercel-blob-store-id",
  ACCESS: "x-vercel-blob-access",
  CONTENT_TYPE: "x-content-type",
  ALLOW_OVERWRITE: "x-allow-overwrite",
} as const;

/** The Blob API version the SDK this store was measured against speaks. */
const BLOB_API_VERSION = "13";

export class BlobStoreFailure extends Data.TaggedError("BlobStoreFailure")<{
  readonly operation: BlobStoreOperation;
  readonly reason: BlobStoreFailureReason;
  /** The pathnames the call named. */
  readonly pathnames: ReadonlyArray<string>;
  readonly cause?: unknown;
}> {}

/** What the store holds about one object. */
export interface BlobObjectHead {
  readonly size: number;
  readonly contentType: string;
  readonly etag: string;
}

/** One object's bytes as a stream, with what the store holds about it. */
export interface BlobObjectStream {
  readonly stream: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly contentType: string;
}

export interface PresignGetOptions {
  /** How long the URL opens the object, at most `BLOB_PRESIGN_MAX_SECONDS`. */
  readonly validForSeconds: number;
}

/** A presigned upload: the URL, which is a bearer of the upload and never logged, and the headers the request must carry, which are not secret. */
export interface PresignedUpload {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface PresignPutOptions {
  /** The one content type the upload may carry. */
  readonly contentType: string;
  /** The most bytes the upload may carry. */
  readonly maxBytes: number;
  /** How long the URL takes an upload, at most `BLOB_PRESIGN_MAX_SECONDS`. */
  readonly validForSeconds: number;
}

export interface BlobStoreValues {
  /** Writes `bytes` at `pathname` as `contentType`, replacing what stood there. */
  readonly put: (
    pathname: string,
    bytes: Uint8Array,
    contentType: string,
  ) => Effect.Effect<void, BlobStoreFailure>;
  /** What the store holds about the object at `pathname`, or nothing where none stands. */
  readonly head: (
    pathname: string,
  ) => Effect.Effect<Option.Option<BlobObjectHead>, BlobStoreFailure>;
  /** The object's bytes, or nothing where none stands. */
  readonly get: (pathname: string) => Effect.Effect<Option.Option<Uint8Array>, BlobStoreFailure>;
  /** The object's bytes as a stream, read as its reader reads it, or nothing where none stands; the stream is the caller's to read to its end or cancel. */
  readonly stream: (
    pathname: string,
  ) => Effect.Effect<Option.Option<BlobObjectStream>, BlobStoreFailure>;
  /** The object's first `byteCount` bytes, fewer where it is shorter, or nothing where none stands. */
  readonly getFirstBytes: (
    pathname: string,
    byteCount: number,
  ) => Effect.Effect<Option.Option<Uint8Array>, BlobStoreFailure>;
  /** A URL that reads the one object at `pathname` with a plain GET until it expires. */
  readonly presignGet: (
    pathname: string,
    options: PresignGetOptions,
  ) => Effect.Effect<string, BlobStoreFailure>;
  /**
   * A URL that takes one upload to `pathname`, of that type and at most that
   * size, until it expires, and the headers the upload carries. Note that it
   * never replaces what stands at the pathname, so once one upload has
   * landed the URL takes no other, and what was read back after it stays.
   */
  readonly presignPut: (
    pathname: string,
    options: PresignPutOptions,
  ) => Effect.Effect<PresignedUpload, BlobStoreFailure>;
  /** Deletes the objects at `pathnames`; one that names nothing is no failure. */
  readonly delete: (pathnames: ReadonlyArray<string>) => Effect.Effect<void, BlobStoreFailure>;
}

/**
 * The store a runtime reads attachment bytes from and writes them to:
 * unconfigured by default, as a test or a local run has it, and the one the
 * deployment names wherever its runtime is built over
 * `blobStoreFromEnvironment`. Note that it is a reference rather than a
 * service a caller must be handed, because a reader of an attachment's
 * bytes sits beneath nearly every send to an agent (a lost line handed
 * over again, a picture forwarded), as the deployment's other queues and
 * stores do (`TurnQueue`, `VoiceCallLeases`).
 */
export const BlobStore = Context.Reference<BlobStoreValues>("BlobStore", {
  defaultValue: unconfiguredStore,
});

/**
 * The failure as one line: the store's operation and why it failed, and
 * nothing it carried, since its cause's words may name an address. Note
 * that a store the deployment names none of is an error rather than a
 * warning, because a row whose bytes stand there then reads as unavailable
 * on every read until the runtime is built over `blobStoreFromEnvironment`.
 */
export function logBlobStoreFailure(failure: BlobStoreFailure): Effect.Effect<void> {
  const line = `Blob store unavailable: ${failure.operation} ${failure.reason}`;

  return failure.reason === BLOB_STORE_FAILURE.UNCONFIGURED
    ? Effect.logError(line)
    : Effect.logWarning(line);
}

/** Asserts a lifetime Blob would sign: a whole number of seconds, above zero and within its seven days. */
export function assertPresignLifetime(validForSeconds: number): void {
  if (
    !Number.isInteger(validForSeconds) ||
    validForSeconds <= 0 ||
    validForSeconds > BLOB_PRESIGN_MAX_SECONDS
  ) {
    throw new Error(
      "BlobStore: a presigned URL lives a whole number of seconds, up to seven days.",
    );
  }
}

/** Asserts a ranged read's length: a whole number of bytes above zero. */
function assertByteCount(byteCount: number): void {
  if (!Number.isInteger(byteCount) || byteCount <= 0) {
    throw new Error("BlobStore: a ranged read takes a whole number of bytes above zero.");
  }
}

/** Reads a stream to its end, or to `limit` bytes and no further, canceling the rest unread. */
async function readUpTo(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;

  while (length < limit) {
    const { done, value } = await reader.read();

    if (done) break;
    chunks.push(value);
    length += value.length;
  }

  // Note that we cancel rather than drain, because Blob may ignore a range and send the whole object.
  await reader.cancel();
  const bytes = new Uint8Array(Math.min(length, limit));
  let offset = 0;

  for (const chunk of chunks) {
    const take = chunk.subarray(0, bytes.length - offset);

    bytes.set(take, offset);
    offset += take.length;
  }

  return bytes;
}

/** True where Blob answered a range past the end, which is how an empty object answers a ranged read. */
function isRangeNotSatisfiable(cause: unknown): boolean {
  return cause instanceof Error && cause.message.includes(RANGE_NOT_SATISFIABLE);
}

/** A store that reaches nothing and answers every call as unconfigured. */
function unconfiguredStore(): BlobStoreValues {
  const refuse = (operation: BlobStoreOperation, pathnames: ReadonlyArray<string>) =>
    Effect.fail(
      new BlobStoreFailure({ operation, reason: BLOB_STORE_FAILURE.UNCONFIGURED, pathnames }),
    );

  return {
    put: (pathname) => refuse(BLOB_STORE_OPERATION.PUT, [pathname]),
    head: (pathname) => refuse(BLOB_STORE_OPERATION.HEAD, [pathname]),
    get: (pathname) => refuse(BLOB_STORE_OPERATION.GET, [pathname]),
    stream: (pathname) => refuse(BLOB_STORE_OPERATION.GET, [pathname]),
    getFirstBytes: (pathname) => refuse(BLOB_STORE_OPERATION.GET, [pathname]),
    presignGet: (pathname) => refuse(BLOB_STORE_OPERATION.PRESIGN_GET, [pathname]),
    presignPut: (pathname) => refuse(BLOB_STORE_OPERATION.PRESIGN_PUT, [pathname]),
    delete: (pathnames) => refuse(BLOB_STORE_OPERATION.DELETE, pathnames),
  };
}

/** The store `storeId` names, reached through `@vercel/blob` under the function's OIDC token. */
function vercelBlobStore(storeId: string): BlobStoreValues {
  const call = <A>(
    operation: BlobStoreOperation,
    pathnames: ReadonlyArray<string>,
    run: (signal: AbortSignal) => Promise<A>,
  ) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        new BlobStoreFailure({ operation, reason: BLOB_STORE_FAILURE.REQUEST, pathnames, cause }),
    }).pipe(Effect.withSpan(`BlobStore.${operation}`, { attributes: { pathnames } }));

  const validUntil = (validForSeconds: number) =>
    Effect.map(Clock.currentTimeMillis, (now) => {
      assertPresignLifetime(validForSeconds);

      return now + validForSeconds * 1000;
    });

  return {
    put: (pathname, bytes, contentType) =>
      call(BLOB_STORE_OPERATION.PUT, [pathname], (abortSignal) =>
        put(pathname, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
          access: ACCESS,
          contentType,
          allowOverwrite: true,
          storeId,
          abortSignal,
        }),
      ).pipe(Effect.asVoid),

    head: (pathname) =>
      call(BLOB_STORE_OPERATION.HEAD, [pathname], async (abortSignal) => {
        try {
          const found = await head(pathname, { storeId, abortSignal });

          return Option.some({
            size: found.size,
            contentType: found.contentType,
            etag: found.etag,
          });
        } catch (cause) {
          if (cause instanceof BlobNotFoundError) return Option.none();
          throw cause;
        }
      }),

    get: (pathname) =>
      call(BLOB_STORE_OPERATION.GET, [pathname], async (abortSignal) => {
        const found = await get(pathname, { access: ACCESS, storeId, abortSignal });

        if (found === null || found.statusCode !== 200) return Option.none();

        return Option.some(new Uint8Array(await new Response(found.stream).arrayBuffer()));
      }),

    stream: (pathname) =>
      call(BLOB_STORE_OPERATION.GET, [pathname], async (abortSignal) => {
        const found = await get(pathname, { access: ACCESS, storeId, abortSignal });

        if (found === null || found.statusCode !== 200) return Option.none();

        return Option.some({
          stream: found.stream,
          size: found.blob.size,
          contentType: found.blob.contentType,
        });
      }),

    getFirstBytes: (pathname, byteCount) =>
      Effect.suspend(() => {
        assertByteCount(byteCount);

        return call(BLOB_STORE_OPERATION.GET, [pathname], async (abortSignal) => {
          try {
            const found = await get(pathname, {
              access: ACCESS,
              storeId,
              abortSignal,
              headers: { Range: `bytes=0-${byteCount - 1}` },
            });

            if (found === null || found.statusCode !== 200) return Option.none();

            return Option.some(await readUpTo(found.stream, byteCount));
          } catch (cause) {
            if (isRangeNotSatisfiable(cause)) return Option.some(new Uint8Array(0));
            throw cause;
          }
        });
      }),

    presignGet: (pathname, options) =>
      Effect.flatMap(validUntil(options.validForSeconds), (until) =>
        call(BLOB_STORE_OPERATION.PRESIGN_GET, [pathname], async (abortSignal) => {
          const token = await issueSignedToken({
            pathname,
            operations: ["get"],
            validUntil: until,
            storeId,
            abortSignal,
          });

          const signed = await presignUrl(token, {
            operation: "get",
            pathname,
            access: ACCESS,
            validUntil: until,
          });

          return signed.presignedUrl;
        }),
      ),

    presignPut: (pathname, options) =>
      Effect.flatMap(validUntil(options.validForSeconds), (until) =>
        call(BLOB_STORE_OPERATION.PRESIGN_PUT, [pathname], async (abortSignal) => {
          const limits = {
            allowedContentTypes: [options.contentType],
            maximumSizeInBytes: options.maxBytes,
          };

          const token = await issueSignedToken({
            pathname,
            operations: ["put"],
            validUntil: until,
            ...limits,
            storeId,
            abortSignal,
          });

          const signed = await presignUrl(token, {
            operation: "put",
            pathname,
            access: ACCESS,
            validUntil: until,
            ...limits,
            allowOverwrite: false,
          });

          return {
            url: signed.presignedUrl,
            headers: {
              [PRESIGNED_PUT_HEADER.API_VERSION]: BLOB_API_VERSION,
              [PRESIGNED_PUT_HEADER.STORE_ID]: parseStoreIdFromDelegationToken(
                token.delegationToken,
              ),
              [PRESIGNED_PUT_HEADER.ACCESS]: ACCESS,
              [PRESIGNED_PUT_HEADER.CONTENT_TYPE]: options.contentType,
              [PRESIGNED_PUT_HEADER.ALLOW_OVERWRITE]: "0",
            },
          };
        }),
      ),

    delete: (pathnames) =>
      pathnames.length === 0
        ? Effect.void
        : call(BLOB_STORE_OPERATION.DELETE, pathnames, (abortSignal) =>
            del([...pathnames], { storeId, abortSignal }),
          ),
  };
}

/**
 * The store as this deployment's environment names it, read as the services
 * are built; one that reaches nothing without `BLOB_STORE_ID`, saying so
 * once by the variable's name.
 */
export const blobStoreFromEnvironment: Layer.Layer<never> = Layer.effect(
  BlobStore,
  Effect.gen(function* () {
    const read = yield* Config.option(Config.String(BLOB_STORE_ENVIRONMENT.STORE_ID)).pipe(
      Effect.orElseSucceed(() => Option.none<string>()),
    );

    const storeId = present(read);

    if (storeId === undefined) {
      yield* Effect.logWarning(
        `${BLOB_STORE_ENVIRONMENT.STORE_ID} is unset, so attachment storage is unavailable.`,
      );

      return unconfiguredStore();
    }

    return vercelBlobStore(storeId);
  }),
);
