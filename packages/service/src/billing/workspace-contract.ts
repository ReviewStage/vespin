/**
 * workspace-contract.ts -- a workspace's Metronome customer and contract, made the first time they are needed and kept in `workspace_billing`.
 *
 * The usage send needs them before a workspace's first usage is sent
 * (`usage-sending.ts`), and setting billing up needs them before the
 * contract is linked to Stripe (`stripe-webhook-app.ts`), which can come
 * first for a workspace that has used nothing yet. The customer is recorded
 * before its contract is made, so a contract that failed to be made is made
 * on the next call on the same customer. The contract runs from the 1st of
 * the UTC month the caller names: the month of the workspace's earliest
 * unsent charge for the usage send, and the current month for a setup.
 */

import {
  recordMetronomeContract,
  recordMetronomeCustomer,
  type WorkspaceBilling,
} from "@repo/database/models/workspace-billing";
import { Effect } from "effect";
import type { MetronomeAccount } from "./billing-environment.js";
import { createMetronomeContract, createMetronomeCustomer } from "./metronome.js";

/** The first instant of the UTC month the instant falls in. */
function utcMonthStart(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), 1));
}

/** The workspace's Metronome customer and contract, each made where it was missing from the row standing for it; a contract made here starts on the 1st of the UTC month `startingIn` falls in. */
export const workspaceContract = Effect.fn("web/workspaceContract")(function* (
  account: MetronomeAccount,
  organizationId: string,
  standing: WorkspaceBilling | undefined,
  startingIn: Date,
) {
  const customerId =
    standing?.metronomeCustomerId ??
    (yield* recordMetronomeCustomer(
      organizationId,
      yield* createMetronomeCustomer(account, organizationId),
    )).metronomeCustomerId;

  if (standing?.metronomeContractId != null) {
    return { customerId, contractId: standing.metronomeContractId };
  }

  const contractId = yield* createMetronomeContract(account, {
    organizationId,
    customerId,
    startingAt: utcMonthStart(startingIn),
  });

  yield* recordMetronomeContract(organizationId, contractId);

  return { customerId, contractId };
});
