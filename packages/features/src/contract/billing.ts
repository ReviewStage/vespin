/**
 * billing.ts -- a workspace's billing (`billing-wire.ts`), as procedures: read its status, set it up, manage it.
 *
 * Every output is its wire schema flipped. A body refuses a key it does not
 * name (`exactInput`); the read's query refuses nothing it does not name.
 *
 * Each declares the refusals its handler answers
 * (`packages/service/src/billing/billing-procedures.ts`): a workspace the
 * account is not a member of is not found, a member who is no owner or admin
 * is not permitted, setting up or managing billing while it is off is
 * unavailable, and a refusal of Stripe's is an upstream error.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  BILLING_QUERY,
  billingSessionAnswerSchema,
  billingSessionRequestSchema,
  billingStatusAnswerSchema,
} from "../billing-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { workspaceIdSchema } from "../task-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A request carries a workspace id alone. */
const SESSION_BODY_BYTES = 1_024;

const billingQuerySchema = EffectSchema.Struct({
  [BILLING_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

const SESSION_REFUSALS = [
  HOSTED_API_ERROR.NOT_FOUND,
  HOSTED_API_ERROR.NOT_PERMITTED,
  HOSTED_API_ERROR.UNAVAILABLE,
  HOSTED_API_ERROR.UPSTREAM_ERROR,
] as const;

export const billingContract = {
  status: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.BILLING_STATUS }))
    .input(billingQuerySchema)
    .output(EffectSchema.flip(billingStatusAnswerSchema)),
  setup: declaredProcedure
    .errors(refuses(...SESSION_REFUSALS))
    .meta(bodyCap(SESSION_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.BILLING_SETUP }))
    .input(exactInput(billingSessionRequestSchema))
    .output(EffectSchema.flip(billingSessionAnswerSchema)),
  portal: declaredProcedure
    .errors(refuses(...SESSION_REFUSALS))
    .meta(bodyCap(SESSION_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.BILLING_PORTAL }))
    .input(exactInput(billingSessionRequestSchema))
    .output(EffectSchema.flip(billingSessionAnswerSchema)),
};
