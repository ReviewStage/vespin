/**
 * billing-refusal-wire.ts -- a cloud agent's Start refused for billing, on the wire: why, and whether its starter is offered the way out.
 *
 * The gate (`packages/service/src/billing/billing-gate.ts`) refuses a cloud
 * agent's Start (`billing-required`) where its workspace is past the
 * month's included usage with no billing set up, or blocked by an invoice
 * given up on, and only while billing is on. The refusal says which, and
 * whether its starter is an owner or an admin, who alone is offered Set up
 * billing or Manage billing beside it.
 */

import { Schema as EffectSchema } from "effect";

/** Why a cloud agent's Start was refused for billing: past the month's included usage with none set up, or blocked by an invoice given up on. */
export const BILLING_REFUSAL = {
  SET_UP: "set-up",
  BLOCKED: "blocked",
} as const;

export type BillingRefusal = (typeof BILLING_REFUSAL)[keyof typeof BILLING_REFUSAL];

export const billingRefusalSchema = EffectSchema.Literals(Object.values(BILLING_REFUSAL));

/** What a Start refused for billing carries beside its slug: why, and whether its starter is an owner or an admin, who sets billing up and manages it. */
export const billingRequiredDataSchema = EffectSchema.Struct({
  billingRefusal: EffectSchema.optionalKey(billingRefusalSchema),
  billingManager: EffectSchema.optionalKey(EffectSchema.Boolean),
});
