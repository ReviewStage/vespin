/**
 * served-bytes.ts -- a file the service serves as its bytes rather than as JSON, as the window hears it: the bytes in base64 under their type, or why there are none.
 *
 * A picture a tool answered an agent, an inbox item's attachment, and an
 * image a pull request's overview names are each read this way, through an
 * agent (`agent-client.ts`) or by the pull request's repository
 * (`pull-request-client.ts`): one call under the account, a refusal read off
 * the body the service answered, and the bytes read whole only where it
 * served them.
 */

import { HTTP_METHOD, type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { type AccountCallEffects, type CallAnswer, callAnswered, jsonOf } from "./account-call.js";
import {
  AGENT_CALL_FAILURE,
  type AgentCallFailure,
  type AgentGitHubImageView,
  githubImageTypeSchema,
} from "./agent-view.js";
import type { FailureFacts } from "./failure-facts.js";
import { HostedUnanswered, hostedFailureFacts } from "./hosted-link.js";
import {
  type ImageBody,
  type ImageBodyUnread,
  imageBodyOf,
  imageBodyUnread,
} from "./image-body.js";
import { HOSTED_API_ERROR, hostedErrorSchema, readServiceAnswer } from "./service-wire.js";

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/** A served file's read that failed: why, and the facts of what failed beneath it where the host caught them. */
type ServedFailed = {
  readonly failure: AgentCallFailure;
  readonly cause?: FailureFacts;
};

/** A served file's refusal: not found where the service said so; unanswered for anything else. */
export function servedRefusal(payload: UnparsedWireValue): ServedFailed {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));

  return refusal === HOSTED_API_ERROR.NOT_FOUND
    ? { failure: AGENT_CALL_FAILURE.NOT_FOUND }
    : UNANSWERED;
}

/**
 * A call that never reached the service, unanswered with where it ended,
 * the network or its deadline among them, which the window reports and
 * never draws, so a read the network failed is not reported as the app's.
 */
export function unansweredCall(
  answer: Exclude<CallAnswer, { readonly response: Response }>,
): ServedFailed {
  const { fault, errorName } = answer;

  const unanswered = new HostedUnanswered({
    fault,
    ...(errorName === undefined ? undefined : { errorName }),
  });

  return { ...UNANSWERED, cause: hostedFailureFacts(unanswered) };
}

/** An image's read as the window hears it: its bytes, a body the network cut as a call that never reached the service, or else unanswered. */
export function imageAnswerOf<Type extends string>(
  read: ImageBody<Type> | ImageBodyUnread | undefined,
): ImageBody<Type> | ServedFailed {
  if (read === undefined) return UNANSWERED;

  return imageBodyUnread(read) ? unansweredCall(read) : read;
}

/**
 * One image a pull request's overview names, fetched under the account at
 * `path`: its bytes in base64 under the type GitHub served; not found where
 * the service said so; unanswered for anything else.
 */
export function servedGitHubImage(
  call: AccountCallEffects,
  path: string,
): Effect.Effect<AgentGitHubImageView, never, HttpClient.HttpClient> {
  return Effect.flatMap(
    call.send({ method: HTTP_METHOD.GET, path }),
    (answer): Effect.Effect<AgentGitHubImageView> => {
      if (!callAnswered(answer)) return Effect.succeed(unansweredCall(answer));

      if (!answer.response.ok) {
        return Effect.map(jsonOf(answer.response), (body) => servedRefusal(unparsedWire(body)));
      }

      return Effect.map(imageBodyOf(answer.response, githubImageTypeSchema), imageAnswerOf);
    },
  );
}
