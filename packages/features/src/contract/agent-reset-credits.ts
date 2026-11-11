/**
 * agent-reset-credits.ts -- a Codex agent held at its ChatGPT plan's usage limit, offered a rate-limit reset credit on its limit notice (`reset-credit-wire.ts`).
 *
 * The agent travels in the path. The read asks ChatGPT how many credits the
 * plan the agent waits on holds; the spend lifts that plan's limit with one,
 * keyed by the limit the agent waits on, so a retry or a second press spends
 * no second credit, and has the agent carry on. Both refuse as an agent's
 * routes do (an agent not found, or not the caller's to reach), and answer an
 * upstream error where ChatGPT did not answer.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { resetCreditsAnswerSchema, resetCreditUseAnswerSchema } from "../reset-credit-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { declaredProcedure, refuses } from "./base.js";

/** The agent a path names; the service reads an id that is no UUID as naming none. */
const agentParamsSchema = EffectSchema.Struct({ id: EffectSchema.String });

/** Where the agent's reset credits stand. */
const RESET_CREDITS_PATH = `${HOSTED_SERVICE_PATH.AGENTS}/{id}/reset-credits` as const;

/** A route on the agent's plan, refusing as an agent's routes do. */
const resetCreditsProcedure = declaredProcedure.errors(
  refuses(
    HOSTED_API_ERROR.NOT_FOUND,
    HOSTED_API_ERROR.NOT_PERMITTED,
    HOSTED_API_ERROR.UPSTREAM_ERROR,
  ),
);

export const agentResetCreditsContract = {
  /** How many reset credits the plan the agent waits on holds; none where it waits on no limit a credit lifts. */
  read: resetCreditsProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: RESET_CREDITS_PATH }))
    .input(agentParamsSchema)
    .output(EffectSchema.flip(resetCreditsAnswerSchema)),
  /** One credit spent on the limit the agent waits on, at most once for that limit, and the agent carried on where it lifted. */
  use: resetCreditsProcedure
    .meta(openapi({ method: HTTP_METHOD.POST, path: RESET_CREDITS_PATH }))
    .input(agentParamsSchema)
    .output(EffectSchema.flip(resetCreditUseAnswerSchema)),
};
