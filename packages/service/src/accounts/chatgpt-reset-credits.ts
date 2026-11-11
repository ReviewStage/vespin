/**
 * chatgpt-reset-credits.ts -- one of a ChatGPT plan's rate-limit reset credits spent at ChatGPT's own backend, as Codex's app-server spends it, and the plan's waiting agents carried on.
 *
 * Codex's `account/rateLimitResetCredit/consume` posts the spend under the
 * caller's idempotency key (`redeem_request_id`). Settings and a limit
 * notice mint one key per confirmed press and send it again on a retry, so
 * ChatGPT spends one credit however often the press is sent. Where the
 * plan's limit no longer stands, its status is lifted on the credential the
 * spend was made with, the turns of the agents it pays for that wait on a
 * reset are handed on as the minute sweep hands them on, and its usage is
 * read again so its count moves. The access token goes to ChatGPT alone and
 * is never logged.
 */

import type { KeyRing } from "@repo/database/models/provider-key-seal";
import { listProviderKeyRows, setPlanStatus } from "@repo/database/models/provider-key-store";
import { releasePlanWaitedTurns } from "@repo/database/models/turn-state";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  RESET_CREDIT_OUTCOME,
  type ResetCreditOutcome,
} from "@repo/features/provider-key-wire";
import { DateTime, Effect, Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { handWaitedTurnsOn } from "../agents/coder-host/steer.js";
import { hostedStoreOrUnavailable } from "../http/http-effect.js";
import {
  CHATGPT_ACCESS,
  OPENAI_CALL_TIMEOUT,
  refreshChatGptAccess,
} from "./chatgpt-credentials.js";
import { asPlan, rereadPlanUsage } from "./chatgpt-usage.js";

/** Where Codex's client spends one of a plan's reset credits. */
const CONSUME_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits/consume";

const HTTP_OK = 200;

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

/** The outcomes after which no limit stands on the plan. */
const LIFTED: ReadonlySet<ResetCreditOutcome> = new Set([
  RESET_CREDIT_OUTCOME.RESET,
  RESET_CREDIT_OUTCOME.ALREADY_REDEEMED,
  RESET_CREDIT_OUTCOME.NOTHING_TO_RESET,
]);

/** How ChatGPT took the spend, or none where it answered nothing Codex would read, so the press may send it again under the same key. */
const consumed = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  subscriptionId: string,
  idempotencyKey: string,
) {
  const access = yield* refreshChatGptAccess(userId, ring, undefined, subscriptionId, true);
  if (access.outcome !== CHATGPT_ACCESS.READY) return Option.none<ResetCreditOutcome>();
  const client = yield* HttpClient.HttpClient;
  const request = HttpClientRequest.post(CONSUME_URL).pipe(
    HttpClientRequest.bodyJsonUnsafe({ redeem_request_id: idempotencyKey }),
  );
  // A request that failed or timed out is no answer, and its cause is dropped unread, since it may quote the token.
  const answered = yield* client.execute(asPlan(request, access)).pipe(
    Effect.flatMap((response) =>
      response.status === HTTP_OK
        ? Effect.map(response.json, Option.some)
        : Effect.succeed(Option.none()),
    ),
    Effect.scoped,
    Effect.timeout(OPENAI_CALL_TIMEOUT),
    Effect.orElseSucceed(() => Option.none<unknown>()),
  );
  return Option.flatMap(answered, (body) =>
    Option.map(
      Schema.decodeUnknownOption(ConsumeAnswerSchema)(body),
      (read): ResetCreditOutcome => OUTCOME_OF_CODE[read.code],
    ),
  );
});

/**
 * One of the account's ChatGPT plan's reset credits spent under the press's
 * key, and where no limit then stands, the plan lifted and its agents
 * carried on; none where the account holds no such plan or ChatGPT answered
 * nothing, which a retry under the same key settles.
 */
export const spentResetCredit = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  subscriptionId: string,
  idempotencyKey: string,
) {
  const plans = yield* hostedStoreOrUnavailable(
    listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH),
  );
  const plan = plans.find((row) => row.id === subscriptionId);
  if (plan === undefined) return Option.none<ResetCreditOutcome>();
  const savedBy = yield* DateTime.nowAsDate;
  const outcome = yield* consumed(userId, ring, subscriptionId, idempotencyKey);
  if (Option.isNone(outcome) || !LIFTED.has(outcome.value)) return outcome;
  const now = yield* DateTime.nowAsDate;
  // Note that the status is written only where the credential is the one the spend was made with (`savedBy`).
  yield* hostedStoreOrUnavailable(
    setPlanStatus(
      userId,
      PROVIDER_KEY_PROVIDER.OPENAI,
      PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      PROVIDER_KEY_STATUS.VERIFIED,
      undefined,
      savedBy,
      now,
      subscriptionId,
    ),
  );
  const released = yield* hostedStoreOrUnavailable(
    releasePlanWaitedTurns(userId, subscriptionId, plans[0]?.id === subscriptionId),
  );
  yield* hostedStoreOrUnavailable(handWaitedTurnsOn(released));
  yield* rereadPlanUsage(userId, ring, plan);
  return outcome;
});
