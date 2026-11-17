/**
 * billing-gate.ts -- whether a workspace may start a cloud agent now, by its billing and this month's usage, refused only while billing is on.
 *
 * A cloud agent starts where the workspace is chargeable (billing set up and
 * no invoice given up on), or where its usage this UTC month, as the ledger
 * sums it, is still under the included allowance
 * (`@repo/database/usage-vocabulary`). Stage's own workspace
 * (`BILLING_EXEMPT_WORKSPACE_ID`) always starts. The admin Billing screen
 * asks the same question (`admitsCloudStart`), so the two never disagree.
 *
 * The gate is asked on every cloud Start and on no other call, so a Mac's
 * agent is never gated and an agent already running is never stopped. While
 * billing is off (`BILLING_LIVE`) a Start it would refuse goes ahead and is
 * logged as `billing.gate.would_refuse`, by its workspace and month total,
 * so who would be refused is known before it is turned on. A read that fails
 * refuses nothing, nor does one past `GATE_READ_TIMEOUT`: it is logged and
 * the Start goes ahead. The billing
 * environment is read where the runtime provides it, as the service's
 * always does (`runtime.ts`); a Start run without it, as a test of Starts
 * is, meets no gate.
 */

import { workspaceMonthTotals } from "@repo/database/models/usage-charges";
import { workspaceBilling } from "@repo/database/models/workspace-billing";
import { workspaceOf } from "@repo/database/models/workspace-store";
import { withinIncludedUsage } from "@repo/database/usage-vocabulary";
import { BILLING_REFUSAL } from "@repo/features/billing-refusal-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { causeKind, unlessInterrupted } from "@repo/runtime/effect";
import { Clock, Duration, Effect, Option } from "effect";
import { billingRequired, type HostedRefusal } from "../http/http-effect.js";
import { BillingEnvironment } from "./billing-environment.js";

/** The line logged for each Start the gate would refuse while billing is off. */
const WOULD_REFUSE = "billing.gate.would_refuse";

/**
 * How long the gate's reads may take before the Start goes ahead without
 * them. Note that this is short, because every cloud Start waits on it, and
 * the reads are two indexed lookups (`workspace_billing`'s key, and
 * `usage_charge_organization_month` for the month's sum).
 */
const GATE_READ_TIMEOUT = Duration.millis(300);

/** The roles offered Set up billing and Manage billing beside a refusal. */
const BILLING_ROLES: ReadonlySet<string> = new Set([WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]);

/** Where a workspace stands for the gate: its usage this month, whether it is chargeable, and whether it is exempt. */
export interface CloudStartStanding {
  readonly usageMicroUsd: number;
  /** Billing set up and no invoice given up on. */
  readonly chargeable: boolean;
  /** Stage's own workspace. */
  readonly exempt: boolean;
}

/** Whether the workspace may start a cloud agent: exempt, chargeable, or still under the month's included usage. */
export function admitsCloudStart(standing: CloudStartStanding): boolean {
  return standing.exempt || standing.chargeable || withinIncludedUsage(standing.usageMicroUsd);
}

/** Whether the workspace is the one `BILLING_EXEMPT_WORKSPACE_ID` names. */
export function exemptFromBilling(workspaceId: string, exemptWorkspaceId: string | undefined) {
  return exemptWorkspaceId !== undefined && workspaceId === exemptWorkspaceId;
}

/** What the gate reads: the workspace's billing row and this month's ledger total. */
const standingOf = (workspaceId: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;

    const [billing, totals] = yield* Effect.all(
      [workspaceBilling(workspaceId), workspaceMonthTotals(workspaceId, new Date(now))],
      { concurrency: "unbounded" },
    );

    const row = Option.getOrUndefined(billing);

    return {
      usageMicroUsd: totals.reduce((total, kind) => total + kind.amountMicroUsd, 0),
      setUp: row?.stripeCustomerId != null,
      blocked: row?.blockedAt != null,
    };
  });

/** The refusal of a Start for billing, offering its starter the way out where they manage the workspace. */
const refusalOf = (userId: string, workspaceId: string, blocked: boolean) =>
  Effect.map(workspaceOf(userId, workspaceId), (workspace) =>
    billingRequired(
      blocked ? BILLING_REFUSAL.BLOCKED : BILLING_REFUSAL.SET_UP,
      Option.match(workspace, {
        onNone: () => false,
        onSome: (held) => BILLING_ROLES.has(held.role),
      }),
    ),
  );

/**
 * Asks the gate for a cloud agent's Start by the member in the workspace:
 * answers nothing where it may start, and fails with the refusal where
 * billing is on and it may not.
 */
export const cloudStartGate = Effect.fn("web/cloudStartGate")(function* (
  userId: string,
  workspaceId: string,
) {
  const environment = yield* Effect.serviceOption(BillingEnvironment);

  if (Option.isNone(environment)) return undefined;
  const { live, exemptWorkspaceId } = environment.value;

  if (exemptFromBilling(workspaceId, exemptWorkspaceId)) return undefined;

  const refusal: HostedRefusal | undefined = yield* Effect.gen(function* () {
    const standing = yield* standingOf(workspaceId);
    const chargeable = standing.setUp && !standing.blocked;

    if (admitsCloudStart({ usageMicroUsd: standing.usageMicroUsd, chargeable, exempt: false })) {
      return undefined;
    }

    if (!live) {
      yield* Effect.logInfo(WOULD_REFUSE).pipe(
        Effect.annotateLogs({ workspaceId, monthTotalMicroUsd: standing.usageMicroUsd }),
      );

      return undefined;
    }

    return yield* refusalOf(userId, workspaceId, standing.blocked);
  }).pipe(
    Effect.timeout(GATE_READ_TIMEOUT),
    // Note that a read that failed or ran past its time lets the Start go ahead, because the gate guards a bill, not the service.
    Effect.catchCause((cause) =>
      unlessInterrupted(cause, (other) =>
        Effect.as(
          Effect.logWarning(`the billing gate could not be read: ${causeKind(other)}`),
          undefined,
        ),
      ),
    ),
  );

  if (refusal !== undefined) return yield* Effect.fail(refusal);

  return undefined;
});
