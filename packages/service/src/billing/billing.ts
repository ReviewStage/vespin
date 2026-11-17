/**
 * billing.ts -- a workspace's billing as its owners and admins see it: whether billing is on, set up, and blocked, and the Stripe pages they set it up and manage it on.
 *
 * Every operation is an owner's or admin's (`managedWorkspace`): a workspace
 * the caller is not in is not found, and a member who is neither is not
 * permitted. The status is the one way a client learns whether billing is on
 * (`BILLING_LIVE`, `billing-environment.ts`). Setting billing up and managing
 * it touch Stripe, so both are unavailable while billing is off or the
 * deployment holds no Stripe key; a workspace whose billing is not set up
 * has nothing to manage, which is not found. A refusal of Stripe's is logged
 * by its path and status and answered as an upstream error.
 *
 * Both pages return the member to the app (`deploymentOrigin`), where the
 * Billing page reads the status again: the webhook records the setup
 * (`stripe-webhook-app.ts`), not the return.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { workspaceMonthTotals } from "@repo/database/models/usage-charges";
import { workspaceBilling } from "@repo/database/models/workspace-billing";
import { billableMicroUsd, INCLUDED_USAGE_MICRO_USD } from "@repo/database/usage-vocabulary";
import type { BillingSessionAnswer, BillingStatusAnswer } from "@repo/features/billing-wire";
import { Clock, Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { managedWorkspace } from "../accounts/workspace-access.js";
import { deploymentOrigin } from "../deployment-origin.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { BillingEnvironment } from "./billing-environment.js";
import { createPortalSession, createSetupCheckout, type StripeCallFailed } from "./stripe.js";

/** Where Stripe's pages send the member back to: the app. */
const RETURN_PATH = "/app";

/** Stripe's refusal, logged by its path and status alone, answered as an upstream error. */
function upstreamRefusal(failure: StripeCallFailed) {
  return Effect.as(
    Effect.logError(
      `Stripe refused a billing call: ${failure.path} answered ${failure.status ?? "nothing"}: ${failure.message}`,
    ),
    HOSTED_REFUSAL.UPSTREAM_ERROR,
  ).pipe(Effect.flip);
}

/** The Stripe key and the address to return to, where billing is on and both are held; unavailable otherwise. */
const liveStripe = Effect.fn("web/liveStripe")(function* () {
  const { live, stripeSecretKey } = yield* BillingEnvironment;
  const origin = deploymentOrigin();

  if (!live || stripeSecretKey === undefined || origin === undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }

  return { key: stripeSecretKey, returnUrl: `${origin}${RETURN_PATH}` };
});

/** Whether billing is on, whether the workspace has set it up and is blocked, and what this month's usage stands at against the included allowance. */
export const billingStatus = Effect.fn("web/billingStatus")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<BillingStatusAnswer, HostedRefusal, DatabaseServices | BillingEnvironment> {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const { live } = yield* BillingEnvironment;

  const billing = Option.getOrUndefined(
    yield* hostedStoreOrUnavailable(workspaceBilling(workspace.id)),
  );

  const now = yield* Clock.currentTimeMillis;
  const usage = yield* hostedStoreOrUnavailable(workspaceMonthTotals(workspace.id, new Date(now)));
  const totalMicroUsd = usage.reduce((sum, each) => sum + each.amountMicroUsd, 0);

  return {
    live,
    setUp: billing?.stripeCustomerId != null,
    blocked: billing?.blockedAt != null,
    usage,
    includedMicroUsd: INCLUDED_USAGE_MICRO_USD,
    owedMicroUsd: billableMicroUsd(totalMicroUsd),
  };
});

/** A Stripe Checkout page in setup mode where the workspace's card is saved. */
export const billingSetup = Effect.fn("web/billingSetup")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<
  BillingSessionAnswer,
  HostedRefusal,
  DatabaseServices | BillingEnvironment | HttpClient.HttpClient
> {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const stripe = yield* liveStripe();

  const billing = Option.getOrUndefined(
    yield* hostedStoreOrUnavailable(workspaceBilling(workspace.id)),
  );

  const url = yield* createSetupCheckout(stripe.key, {
    workspaceId: workspace.id,
    stripeCustomerId: billing?.stripeCustomerId ?? null,
    returnUrl: stripe.returnUrl,
  }).pipe(Effect.catchTag("StripeCallFailed", upstreamRefusal));

  return { url };
});

/** A Stripe Customer Portal page where the workspace's card is changed and its invoices read. */
export const billingPortal = Effect.fn("web/billingPortal")(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<
  BillingSessionAnswer,
  HostedRefusal,
  DatabaseServices | BillingEnvironment | HttpClient.HttpClient
> {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const stripe = yield* liveStripe();

  const billing = Option.getOrUndefined(
    yield* hostedStoreOrUnavailable(workspaceBilling(workspace.id)),
  );

  if (billing?.stripeCustomerId == null) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  const url = yield* createPortalSession(
    stripe.key,
    billing.stripeCustomerId,
    stripe.returnUrl,
  ).pipe(Effect.catchTag("StripeCallFailed", upstreamRefusal));

  return { url };
});
