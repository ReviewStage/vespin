/**
 * share-extension-send.ts -- the share extension's one runtime edge: a share's writes run through the platform's fetch, where `@repo/features/ios-share-extension` builds them.
 *
 * The extension runs no host, so its sends are run here rather than on the
 * app's runtime. Note that nothing of a failure is logged here or by the
 * caller, since a request's failure may carry its headers, and the token
 * rides in one.
 */

import { type ShareSent, type ShareService, sendShare } from "@repo/features/ios-share-extension";
import type { ShareSendTo } from "@repo/features/ios-share-send";
import { Effect } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

/** Sends a share's writes under `token`; what came of them. */
export function sendFromExtension(
  sends: readonly ShareSendTo[],
  token: string | undefined,
  service: ShareService,
): Promise<ShareSent> {
  return Effect.runPromise(
    sendShare(sends, token, service).pipe(Effect.provide(FetchHttpClient.layer)),
  );
}
