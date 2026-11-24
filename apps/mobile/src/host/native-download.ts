/**
 * native-download.ts -- the host's download straight into a file, as the phone answers it: a client whose request iOS's own URL session carries and writes to a file of the app, so a picture's bytes never cross into JavaScript.
 *
 * The host reads a picture through its account call, which reads and renews
 * the bearer and retries a 401 once (`@repo/features/account-call`); this is
 * only the client that call is carried by, provided for that one read
 * (`PlatformFileDownload`). It answers the status and headers alone, its body
 * already written where it was told. Note that the request's headers, the
 * bearer among them, are handed to the native download and nothing else, and
 * a download that failed says only the kind of error it ended with, never
 * its words. The picture routes answer their bytes directly and never
 * redirect; iOS's session follows a redirect as every request the host's
 * `fetch` sends does, so this carries the bearer nowhere the host's other
 * calls would not.
 */

import type { FileDownloadSeam } from "@repo/host/effect";
import { Effect } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { downloadAsync } from "expo-file-system/legacy";

/** The phone's download into a file: each request written to `path` by the system's URL session. */
export const nativeFileDownload: FileDownloadSeam = {
  into: (path) =>
    HttpClient.make((request, url) =>
      Effect.map(
        Effect.tryPromise({
          try: () => downloadAsync(url.href, path, { headers: { ...request.headers } }),
          catch: (cause) =>
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, cause }),
            }),
        }),
        // Note that the body stands in the file, so the response the call reads holds none.
        (written) =>
          HttpClientResponse.fromWeb(
            request,
            new Response(null, { status: written.status, headers: written.headers }),
          ),
      ),
    ),
};
