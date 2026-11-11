/**
 * reset-credits.ts -- a Codex agent held at its ChatGPT plan's usage limit offered one of the plan's rate-limit reset credits, and the credit spent, on the hosted oRPC router.
 *
 * A turn its plan's limit cut short, where no payer has room, waits for the
 * reset (`turns.waits_until`, `native-projection.ts`'s `#retried`). Where the
 * agent ran on its starter's ChatGPT plan, the plan's reset credits
 * (`accounts/chatgpt-reset-credits.ts`) lift the limit before then: the read
 * counts them, and the spend lifts it with one and hands the waiting turns on
 * as the minute sweep does once the reset passes (`handWaitedTurnsOn`), so
 * the agent carries on at once.
 *
 * The spend is keyed by the limit the agent waits on, its turn and its reset
 * (`spendKey`), as Codex's own clients key a spend by its attempt: a retry
 * after no answer, and two presses at once, send the same key, and ChatGPT
 * spends one credit for it, answering `alreadyRedeemed` to the second. Once a
 * spend lifts the limit the wait is cleared, so a later press finds nothing
 * to spend on. Nothing is stored, so no ledger stands beside ChatGPT's own.
 *
 * Only the agent's starter, whose plan it is, is offered a credit or may spend
 * one; any other member who reaches the agent reads none and is refused the
 * spend.
 */

import { createHash } from "node:crypto";
import { readAgentRouting } from "@repo/database/models/agent-store";
import type { KeyRing } from "@repo/database/models/provider-key-seal";
import { setPlanStatus } from "@repo/database/models/provider-key-store";
import { releaseConversationWaitedTurns, waitingTurnOf } from "@repo/database/models/turn-state";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@repo/features/provider-key-wire";
import { RESET_CREDIT_OUTCOME, type ResetCreditOutcome } from "@repo/features/reset-credit-wire";
import { DateTime, Effect, Option } from "effect";
import { consumeResetCredit, readResetCredits } from "../accounts/chatgpt-reset-credits.js";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted, keyRingMiddleware } from "../orpc/base.js";
import { type ReachedAgent, reachedAgentById } from "./agent-reach.js";
import { handWaitedTurnsOn } from "./coder-host/steer.js";

/** The outcomes after which no limit stands on the plan: a credit spent, this very spend taken before, or no limit to lift. */
const LIFTED: ReadonlySet<ResetCreditOutcome> = new Set([
  RESET_CREDIT_OUTCOME.RESET,
  RESET_CREDIT_OUTCOME.ALREADY_REDEEMED,
  RESET_CREDIT_OUTCOME.NOTHING_TO_RESET,
]);

/** The spend's idempotency key: a UUID drawn from the limit the agent waits on, its turn and its reset, so every spend on that limit sends the same one. */
function spendKey(turnId: string, waitsUntil: Date): string {
  const hex = createHash("sha256")
    .update(JSON.stringify([turnId, waitsUntil.getTime()]))
    .digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The limit the reader may spend a credit on: the agent's turn that waits on
 * its starter's ChatGPT plan's limit, and the subscription it ran on; none
 * for a reader who is not its starter, an agent on any other payer, and one
 * that waits on nothing.
 */
const waitOnPlan = /* @__PURE__ */ Effect.fnUntraced(function* (reached: ReachedAgent) {
  const { agent, target } = reached;
  if (reached.userId !== agent.userId) return Option.none();
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(agent.userId, agent.id));
  const payer = Option.getOrUndefined(routing);
  if (payer?.payer !== AGENT_PAYER.CHATGPT_SUBSCRIPTION) return Option.none();
  const waiting = yield* hostedStoreOrUnavailable(waitingTurnOf(target));
  return Option.map(waiting, (turn) => ({
    ...turn,
    subscriptionId: payer.subscriptionId ?? undefined,
  }));
});

/**
 * The plan's limit lifted, so the next launch finds room on it, and the
 * agent's waiting turns handed on now, as the sweep hands them on once the
 * reset passes; answers whether a turn went on.
 */
const liftedAndResumed = /* @__PURE__ */ Effect.fnUntraced(function* (
  reached: ReachedAgent,
  subscriptionId: string | undefined,
) {
  const now = yield* DateTime.nowAsDate;
  yield* hostedStoreOrUnavailable(
    setPlanStatus(
      reached.agent.userId,
      PROVIDER_KEY_PROVIDER.OPENAI,
      PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      PROVIDER_KEY_STATUS.VERIFIED,
      undefined,
      now,
      now,
      subscriptionId,
    ),
  );
  const released = yield* hostedStoreOrUnavailable(releaseConversationWaitedTurns(reached.target));
  yield* hostedStoreOrUnavailable(handWaitedTurnsOn(released));
  return released.length > 0;
});

/** How many credits the plan the agent waits on holds, read as the account given: none where it waits on no plan's limit, or ChatGPT did not answer. */
const agentResetCredits = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  agentId: string,
) {
  const reached = yield* reachedAgentById(userId, agentId);
  const wait = yield* waitOnPlan(reached);
  if (Option.isNone(wait)) return { available: 0 };
  const count = yield* readResetCredits(userId, ring, wait.value.subscriptionId);
  return { available: Option.getOrElse(count, () => 0) };
});

/**
 * One credit spent on the limit the agent waits on, keyed by it, as the
 * account given, which must be the agent's starter, and the agent carried on
 * where the limit lifted; nothing is spent where it waits on no plan's limit.
 * A spend ChatGPT answered nothing to may have landed, so it is refused as
 * upstream's for a retry, which sends the same key.
 */
export const spentResetCredit = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  agentId: string,
) {
  const reached = yield* reachedAgentById(userId, agentId);
  if (reached.userId !== reached.agent.userId) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }
  const wait = yield* waitOnPlan(reached);
  if (Option.isNone(wait)) {
    return { outcome: RESET_CREDIT_OUTCOME.NOTHING_TO_RESET, resumed: false };
  }
  const { turnId, waitsUntil, subscriptionId } = wait.value;
  const key = spendKey(turnId, waitsUntil);
  const outcome = yield* consumeResetCredit(userId, ring, subscriptionId, key);
  if (Option.isNone(outcome)) return yield* Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR);
  const resumed = LIFTED.has(outcome.value)
    ? yield* liftedAndResumed(reached, subscriptionId)
    : false;
  return { outcome: outcome.value, resumed };
});

export interface AgentResetCreditsProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** A Codex agent's reset credits: their count, and one spent, to its signed-in starter on a deployment that holds a ring. */
export function agentResetCreditsProcedures(seams: AgentResetCreditsProcedureSeams) {
  const keyed = hosted.agentResetCredits
    .use(accountMiddleware(seams.resolveUserId))
    .use(keyRingMiddleware);
  return {
    /** How many credits the plan the agent waits on holds. */
    read: keyed.read.effect(function* ({ input, context }) {
      return yield* agentResetCredits(context.userId, context.ring, input.id);
    }),
    /** One credit spent on the limit the agent waits on, and the agent carried on where it lifted. */
    use: keyed.use.effect(function* ({ input, context }) {
      return yield* spentResetCredit(context.userId, context.ring, input.id);
    }),
  };
}
