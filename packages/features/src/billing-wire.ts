/**
 * billing-wire.ts -- a workspace's billing on the wire, to its owners and admins: whether billing is on, set up, and blocked; and where to go to set it up or manage it.
 *
 * Billing is on or off for every workspace at once, as the service's
 * deployment says, and the status read is the one way a client learns which,
 * so turning it on needs no client release. Setting billing up and managing
 * it each answer an address on Stripe's own pages (Checkout in setup mode,
 * and the Customer Portal) for the client to open; both refuse while billing
 * is off. An answer reads only the keys it names, so a field a newer service
 * adds never fails an older client's read.
 */

import { Schema as EffectSchema } from "effect";
import { workspaceIdSchema } from "./task-wire.js";

/** The kinds of usage a status answers a total for, as the service names them; a kind a newer service adds has no words here and is read by its own name. */
export const BILLING_USAGE_KIND = { SANDBOX_SESSION: "sandbox_session" } as const;

export const BILLING_QUERY = { WORKSPACE_ID: "workspaceId" } as const;

/** A workspace's billing as its owners and admins read it. */
export const billingStatusAnswerSchema = EffectSchema.Struct({
  /** Whether billing is on, for every workspace. */
  live: EffectSchema.Boolean,
  /** Whether the workspace has a card set up that its invoices are charged to. */
  setUp: EffectSchema.Boolean,
  /** Whether an invoice the workspace owes was given up on, which holds new cloud agents until it is paid. */
  blocked: EffectSchema.Boolean,
  /** What the workspace's usage has cost so far this UTC month, one total per kind of usage, in micro-dollars; a kind with none is left out. */
  usage: EffectSchema.Array(
    EffectSchema.Struct({ kind: EffectSchema.String, amountMicroUsd: EffectSchema.Number }),
  ),
  /** The usage each workspace is given free each month, in micro-dollars. */
  includedMicroUsd: EffectSchema.Number,
  /** What this month's usage is owed past the included allowance, in micro-dollars, never below zero. */
  owedMicroUsd: EffectSchema.Number,
});

export type BillingStatusAnswer = typeof billingStatusAnswerSchema.Type;

/** Asking to set up or manage a workspace's billing (POST). */
export const billingSessionRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

/** Where to go to set billing up or manage it: a page of Stripe's, opened in the browser. */
export const billingSessionAnswerSchema = EffectSchema.Struct({
  url: EffectSchema.String,
});

export type BillingSessionAnswer = typeof billingSessionAnswerSchema.Type;
