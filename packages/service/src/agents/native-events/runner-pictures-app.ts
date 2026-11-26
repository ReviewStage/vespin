/**
 * runner-pictures-app.ts -- where a native harness's runner keeps a picture its harness's tool answered beside the transcript, apart from its events.
 *
 * A runner posts one picture's bytes alone to a request, under the bearer
 * it was launched with, before the event that carries the picture, and
 * posts that event with the picture's block naming what this answered in
 * its bytes' place (`@repo/agent-runner`'s `RUNNER_KEPT_PICTURE_KEY`), so no
 * event carries a picture's bytes and the events route's bound is never
 * passed for a picture's sake. The events route's readers read the name
 * into the settled call (`runner-moments.ts`'s `blocksAnswer`).
 *
 * The bytes are kept as every other picture of a transcript is
 * (`../../storage/attachment-keeps.ts`'s `keepPictureNote`): sniffed and
 * measured from themselves, put in the Blob store, and written as a row
 * beside the conversation the bearer names, keyed by their hash, so the
 * same picture posted twice is one row, and held to one picture's bound and
 * the conversation's (`CONVERSATION_PICTURE_BOUNDS`). The row goes with its
 * conversation, and its object with the row. What could not be kept is
 * answered as why, with the bytes' size, never as a failure, and a body past
 * one picture's bound is refused unread past it; either way the runner posts
 * the block as it would have without this route, its bytes left out, and
 * the transcript stands in `[image]` for it as it always has.
 *
 * The bearer is admitted as the events route admits it
 * (`../workspace-mcp/bearer.ts`): one no standing agent holds, a retired
 * one's among them, is refused. Posts are braked per conversation, so one
 * runner cannot load the store past what a turn's pictures need. A
 * picture's bytes are never logged.
 */

import type { RunnerPictureAnswer } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import { CONVERSATION_PICTURE_BOUNDS } from "@repo/features/conversation-picture-wire";
import { HTTP_METHOD } from "@repo/wire";
import { Duration, Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  readBodyBytesEffect,
} from "../../http/http-effect.js";
import { createRateBrake, type RateBrake } from "../../http/rate-brake.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { keepPictureNote } from "../../storage/attachment-keeps.js";
import { admitRunnerRequest } from "../workspace-mcp/bearer.js";

/** The path a runner keeps a picture at. */
export const RUNNER_PICTURES_PATH = "/api/agents/runner-pictures";

/**
 * How many pictures one conversation's runner may post: a read of a PDF's
 * pages answers twenty at once, so a turn reading many of them stays well
 * within this, while a runner past it, posting the same picture again and
 * again, is refused before its bytes are put anywhere.
 */
const RUNNER_PICTURES_BRAKE = {
  windowMs: Duration.toMillis(Duration.minutes(10)),
  maxRequestsPerWindow: 300,
  maxTrackedUsers: 10_000,
} as const;

/** POST: one picture's bytes kept beside the conversation the bearer names, answered as what was kept or why not. */
const runnerPicturesEndpoint = /* @__PURE__ */ Effect.fn("web/runnerPicturesEndpoint")(function* (
  brake: RateBrake,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;

  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }

  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const { target } = (yield* admitRunnerRequest(request)).runner;

  if (!(yield* brake.check(target.conversationId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.QUOTA_EXHAUSTED);
  }

  const bytes = yield* readBodyBytesEffect(CONVERSATION_PICTURE_BOUNDS.MAX_BYTES);

  const note = yield* keepPictureNote(target, bytes).pipe(
    Effect.tapError(logStoreFailure),
    Effect.mapError((): HostedRefusal => HOSTED_REFUSAL.UNAVAILABLE),
  );

  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, note satisfies RunnerPictureAnswer);
});

/** The group: the one pictures path, braked per conversation, and the hosted vocabulary's own refusal for any other. */
export function runnerPicturesApp(): WebRoutes<DatabaseServices> {
  const endpoint = runnerPicturesEndpoint(createRateBrake(RUNNER_PICTURES_BRAKE));

  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_PICTURES_PATH, hostedRefusing(endpoint)),
    hostedNotFoundRoute,
  );
}
