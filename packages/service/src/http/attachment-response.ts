/**
 * attachment-response.ts -- how a byte route answers one attachment: its bytes from the row, a redirect to the Blob store, or the stored bytes piped through.
 *
 * A row whose bytes stand in the row is answered as every byte route always
 * answered one: the bytes under the type they are served as, with
 * `servedBytesHeaders`. A row whose bytes stand in the private Blob store
 * is answered without the function holding them where it can: a 302 to a
 * URL presigned for that one object for five minutes, which the reader
 * follows to the store itself; or, where a redirect would not serve the
 * reader, the stored bytes piped through as they arrive, under the same
 * headers an inline row's are.
 *
 * A presigned URL opens its object to whoever holds it until it expires, so
 * it is handed to the reader in the redirect and nowhere else: never a log
 * line, a trace, a counted event, or a fixture.
 */

import { ATTACHMENT_BODY, type AttachmentBody } from "@repo/database/models/attachment-body";
import { pictureMediaTypeSchema } from "@repo/features/picture-wire";
import { Effect, Option, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { BlobStore, logBlobStoreFailure } from "../storage/blob-store.js";
import { HOSTED_HTTP_STATUS } from "./http.js";
import { HOSTED_REFUSAL, type HostedRefusal, servedBytesHeaders } from "./http-effect.js";

/** How long a redirect's presigned URL opens its object: long enough to follow and begin a read, short enough to be worth little once copied. */
const ATTACHMENT_REDIRECT_SECONDS = 5 * 60;

/** The header every browser sends with a request it makes (Fetch Metadata), and no native client does. */
const FETCH_MODE_HEADER = "sec-fetch-mode";

/** The headers a redirect is answered under: no one on the way keeps it, and the store is told nothing of the page that asked. */
const REDIRECT_HEADERS = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
} as const;

/** Whether a served type is drawn or played, an image, a video, or a sound clip, rather than a file to be saved. */
const isPlayedOrDrawn = Schema.is(pictureMediaTypeSchema);

/**
 * Whether a stored attachment is answered by a redirect to the store.
 *
 * Only a picture, a video, or a sound clip is, and only for a reader that
 * is no browser: the desktop's host, whose Node `fetch` follows a redirect
 * with no CORS and drops its `Authorization` crossing origins, and the iOS
 * app, whose system loaders and player follow one and read ranges of it.
 * Note that every other answer is piped through instead, for two reasons
 * Blob gives and no option of ours changes. Blob serves every private
 * object as `Content-Disposition: attachment` under its pathname's last
 * segment, so a file a reader saves would be saved under the wrong name,
 * and a tab opened on the path would download a picture it now shows. And
 * the web tab's host names itself on every call to the service with
 * headers of its own (`clientNamedOnService`), which a browser carries
 * across a redirect and must ask leave for in a preflight, which Blob
 * refuses with a 403, so the tab's read would fail. A browser is known by
 * the Fetch Metadata it sends on every request (`Sec-Fetch-Mode`), which
 * neither native client sends.
 */
function redirectsTo(request: Request, contentType: string): boolean {
  return isPlayedOrDrawn(contentType) && !request.headers.has(FETCH_MODE_HEADER);
}

/** The redirect to a presigned URL for the stored object; unavailable where the store cannot sign one. */
function redirected(
  blobKey: string,
): Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal> {
  return Effect.gen(function* () {
    const store = yield* BlobStore;
    const url = yield* store.presignGet(blobKey, { validForSeconds: ATTACHMENT_REDIRECT_SECONDS });

    return HttpServerResponse.redirect(url, {
      status: HOSTED_HTTP_STATUS.FOUND,
      headers: REDIRECT_HEADERS,
    });
  }).pipe(
    Effect.tapError(logBlobStoreFailure),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
}

/** The stored object's bytes piped through under the type they are served as; not found where the store holds none, unavailable where it cannot answer. */
function piped(
  blobKey: string,
  contentType: string,
): Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal> {
  return Effect.gen(function* () {
    const store = yield* BlobStore;

    const found = yield* store.stream(blobKey).pipe(
      Effect.tapError(logBlobStoreFailure),
      Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
    );

    if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

    return HttpServerResponse.raw(found.value.stream, {
      status: HOSTED_HTTP_STATUS.OK,
      contentType,
      contentLength: found.value.size,
      headers: servedBytesHeaders(contentType),
    });
  });
}

/**
 * One attachment as a byte route answers it, by where its bytes stand and
 * who reads (`redirectsTo`): the row's bytes, a redirect to the store, or
 * the stored bytes piped through, each under the type it is served as.
 */
export function servedAttachment(
  request: Request,
  served: { readonly contentType: string; readonly body: AttachmentBody },
): Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal> {
  const { contentType, body } = served;

  if (body.kind === ATTACHMENT_BODY.INLINE) {
    return Effect.succeed(
      HttpServerResponse.uint8Array(body.bytes, {
        status: HOSTED_HTTP_STATUS.OK,
        contentType,
        headers: servedBytesHeaders(contentType),
      }),
    );
  }

  return redirectsTo(request, contentType)
    ? redirected(body.blobKey)
    : piped(body.blobKey, contentType);
}
