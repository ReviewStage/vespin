/**
 * chatgpt-reset-credits.ts -- a ChatGPT plan's rate-limit reset credits, counted and spent at ChatGPT's own backend, as Codex's app-server counts and spends them.
 *
 * Codex's `account/rateLimits/read` counts a plan's credits from the usage
 * endpoint's `rate_limit_reset_credits`, and its
 * `account/rateLimitResetCredit/consume` posts the spend to the credits'
 * consume endpoint under the caller's idempotency key (`redeem_request_id`),
 * which a retry sends again, so ChatGPT spends one credit however often the
 * spend is sent. Both are asked here as Codex's client asks them, with the
 * plan's own access token, renewed under its lock where due, even while its
 * limit stands (`refreshChatGptAccess`'s `evenAtLimit`), and its ChatGPT
 * workspace (`asPlan`). The endpoints are undocumented, so an answer that is
 * not what Codex reads, a refusal, or no answer within the time any call to
 * OpenAI is given answers none. The access token goes to ChatGPT alone and is
 * never logged; nothing of an answer is but the count or the outcome.
 */

import type { KeyRing } from "@repo/database/models/provider-key-seal";
import { RESET_CREDIT_OUTCOME, type ResetCreditOutcome } from "@repo/features/reset-credit-wire";
import { Effect, Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import {
  CHATGPT_ACCESS,
  OPENAI_CALL_TIMEOUT,
  refreshChatGptAccess,
} from "./chatgpt-credentials.js";
import { asPlan, CHATGPT_USAGE_URL } from "./chatgpt-usage.js";

/** Where Codex's client spends one of a plan's reset credits. */
const CONSUME_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";

/** The status ChatGPT answers a call it took with. */
const HTTP_OK = 200;

/** What of the usage answer is read: the count of credits the plan holds. */
const CountAnswerSchema = Schema.Struct({
  rate_limit_reset_credits: Schema.Struct({ available_count: Schema.Number }),
});

/** How ChatGPT answers a spend, in its own words, as Codex maps them. */
const OUTCOME_OF_CODE = {
  reset: RESET_CREDIT_OUTCOME.RESET,
  nothing_to_reset: RESET_CREDIT_OUTCOME.NOTHING_TO_RESET,
  no_credit: RESET_CREDIT_OUTCOME.NO_CREDIT,
  already_redeemed: RESET_CREDIT_OUTCOME.ALREADY_REDEEMED,
} as const satisfies Record<string, ResetCreditOutcome>;

const ConsumeAnswerSchema = Schema.Struct({
  code: Schema.Literals(Object.keys(OUTCOME_OF_CODE) as (keyof typeof OUTCOME_OF_CODE)[]),
});

/**
 * The JSON ChatGPT answered the plan's request with, or none where the plan
 * could not be opened or ChatGPT took nothing in time. A request that
 * failed or timed out is no answer, and its cause is dropped unread, since it
 * may quote the token.
 */
const askAsPlan = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  subscriptionId: string | undefined,
  request: HttpClientRequest.HttpClientRequest,
) {
  const access = yield* refreshChatGptAccess(userId, ring, undefined, subscriptionId, true);
  if (access.outcome !== CHATGPT_ACCESS.READY) return Option.none<unknown>();
  const client = yield* HttpClient.HttpClient;
  return yield* client.execute(asPlan(request, access)).pipe(
    Effect.flatMap((response: HttpClientResponse.HttpClientResponse) =>
      response.status === HTTP_OK
        ? Effect.map(response.json, Option.some)
        : Effect.succeed(Option.none()),
    ),
    Effect.scoped,
    Effect.timeout(OPENAI_CALL_TIMEOUT),
    Effect.orElseSucceed(() => Option.none<unknown>()),
  );
});

/** How many reset credits the plan holds, as ChatGPT counts them now; none where it answered nothing Codex would read. */
export const readResetCredits = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  subscriptionId: string | undefined,
) {
  const answered = yield* askAsPlan(
    userId,
    ring,
    subscriptionId,
    HttpClientRequest.get(CHATGPT_USAGE_URL),
  );
  return Option.flatMap(answered, (body) =>
    Option.map(
      Schema.decodeUnknownOption(CountAnswerSchema)(body),
      (read) => read.rate_limit_reset_credits.available_count,
    ),
  );
});

/**
 * One of the plan's reset credits spent under the key given, which a retry
 * of the same spend sends again so ChatGPT spends one credit for it: how
 * ChatGPT took it, or none where it answered nothing Codex would read, so
 * the spend may be sent again under the same key.
 */
export const consumeResetCredit = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  subscriptionId: string | undefined,
  idempotencyKey: string,
) {
  const request = HttpClientRequest.post(CONSUME_URL).pipe(
    HttpClientRequest.bodyJsonUnsafe({ redeem_request_id: idempotencyKey }),
  );
  const answered = yield* askAsPlan(userId, ring, subscriptionId, request);
  return Option.flatMap(answered, (body) =>
    Option.map(
      Schema.decodeUnknownOption(ConsumeAnswerSchema)(body),
      (read): ResetCreditOutcome => OUTCOME_OF_CODE[read.code],
    ),
  );
});
