/**
 * reset-credit-wire.ts -- a Codex agent's rate-limit reset credits on the wire: how many its ChatGPT plan holds, and how spending one went.
 *
 * ChatGPT grants a plan reset credits, each of which lifts a usage limit
 * before it resets. A coding agent held at its plan's limit
 * (`turns.waits_until`) is offered one on its limit notice: the read answers
 * how many the plan holds, none where the agent waits on nothing a credit
 * lifts, and a spend answers how ChatGPT took it, in Codex's own words
 * (`ConsumeAccountRateLimitResetCreditOutcome`). A credit spent, or one a
 * retry of the same spend finds already spent, has the agent carry on at
 * once, as the reset would.
 */

import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";

/** How ChatGPT took a spend, as Codex's app-server names it. */
export const RESET_CREDIT_OUTCOME = {
  /** One credit spent: the limit is lifted. */
  RESET: "reset",
  /** No limit stood to lift, so nothing was spent. */
  NOTHING_TO_RESET: "nothingToReset",
  /** The plan holds no credit. */
  NO_CREDIT: "noCredit",
  /** This very spend was taken before, as a retry finds it: the limit is lifted, and no second credit spent. */
  ALREADY_REDEEMED: "alreadyRedeemed",
} as const;

export type ResetCreditOutcome = (typeof RESET_CREDIT_OUTCOME)[keyof typeof RESET_CREDIT_OUTCOME];

/** The credits the agent's plan holds, as ChatGPT counts them; none where the agent waits on no limit a credit lifts. */
export const resetCreditsAnswerSchema = EffectSchema.Struct({
  available: countedNumber,
});

/** How the spend went, and whether the agent carries on now. */
export const resetCreditUseAnswerSchema = EffectSchema.Struct({
  outcome: EffectSchema.Literals(Object.values(RESET_CREDIT_OUTCOME)),
  resumed: EffectSchema.Boolean,
});
