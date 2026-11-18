/**
 * usage-sending.ts -- the usage ledger's charges named, those not yet sent on, sent to Metronome as one usage event each of its workspace and stamped sent.
 *
 * The usage-sends queue's consumer (`usage-queues.ts`) runs this for the
 * charges a message names, as they are recorded. It makes each workspace's
 * Metronome customer and contract the first time it has usage to send
 * (`@repo/database/models/workspace-billing`), and sends its charges
 * `METRONOME.INGEST_BATCH` to a request, each as an event whose transaction
 * id is the charge's own id, so a charge sent twice, as one whose stamp
 * failed to be written or whose message came twice is, is counted once
 * (https://docs.metronome.com/api-reference/usage/ingest-events). A batch
 * Metronome took is stamped sent. What Metronome may answer otherwise later,
 * a 429, a 5xx, or no answer in time, fails the send, so the queue delivers
 * its message again, which reads only what is still unsent; any other
 * refusal is logged and its charges left unsent in the ledger, as
 * Metronome's guide asks of a 4xx.
 *
 * Where no Metronome account is configured (`billing-environment.ts`),
 * nothing is sent: the ledger is written all the same. It runs whether or
 * not billing is live.
 */

import {
  earliestUnsentUsage,
  markUsageChargesSent,
  type UnsentUsageCharge,
  unsentUsageChargesOf,
} from "@repo/database/models/usage-charges";
import { workspaceBillings } from "@repo/database/models/workspace-billing";
import { Array as Arr, Clock, Duration, Effect } from "effect";
import { BillingEnvironment, type MetronomeAccount } from "./billing-environment.js";
import {
  ingestMetronomeEvents,
  METRONOME,
  METRONOME_USAGE,
  type MetronomeCallFailed,
  type MetronomeEvent,
} from "./metronome.js";
import { workspaceContract } from "./workspace-contract.js";

/** How far back Metronome takes a usage event, and so how far back a contract's start is read from a workspace's unsent charges. */
const METRONOME_BACKDATING = Duration.days(34);

/** What a send did: how many charges it sent, how many it left unsent for a refusal, and whether it sent at all. */
interface UsageSendRun {
  readonly configured: boolean;
  readonly sent: number;
  readonly unsent: number;
}

/** The charge as the event Metronome is sent: the workspace's id as its customer, its cost in micro-dollars as a string. */
function eventOf(charge: UnsentUsageCharge): MetronomeEvent {
  const usage = METRONOME_USAGE[charge.kind];

  return {
    transaction_id: charge.id,
    customer_id: charge.organizationId,
    event_type: usage.eventType,
    timestamp: charge.occurredAt.toISOString(),
    properties: { [usage.costProperty]: String(charge.amountMicroUsd) },
  };
}

/** A refusal as a log line names it: the path, the status, and Metronome's own words, never the token. */
function described(failure: MetronomeCallFailed): string {
  return `${failure.path} answered ${failure.status ?? "nothing"}: ${failure.message}`;
}

/**
 * A call's failure handed on where Metronome may answer otherwise later, so
 * the send fails and its message comes again; any other refusal logged in
 * the words given and answered as false, its charges left unsent.
 */
function setAside(words: string) {
  return (failure: MetronomeCallFailed) =>
    failure.retryable
      ? Effect.fail(failure)
      : Effect.as(Effect.logError(`${words}: ${described(failure)}`), false);
}

/**
 * The workspaces among those named whose contract stands, each made where it
 * was missing; one Metronome refused to make is logged and left out, and one
 * it may make later fails the send. A contract
 * made here starts on the 1st of the month of the workspace's earliest
 * unsent charge, so every charge it then sends falls within it. Note that a
 * charge in a month whose invoice Metronome has already finalized is counted
 * in no invoice, whenever its contract was made.
 */
const contractedWorkspaces = Effect.fn("web/contractedWorkspaces")(function* (
  account: MetronomeAccount,
  organizationIds: readonly string[],
  since: Date,
  now: Date,
) {
  const billings = yield* workspaceBillings(organizationIds);

  const uncontracted = organizationIds.filter(
    (organizationId) => billings.get(organizationId)?.metronomeContractId == null,
  );

  const earliest = yield* earliestUnsentUsage(uncontracted, since);
  const contracted = new Set<string>();

  for (const organizationId of organizationIds) {
    const made = yield* workspaceContract(
      account,
      organizationId,
      billings.get(organizationId),
      earliest.get(organizationId) ?? now,
    ).pipe(
      Effect.as(true),
      Effect.catchTag(
        "MetronomeCallFailed",
        setAside("a workspace's Metronome contract was not made, its usage left unsent"),
      ),
    );

    if (made) contracted.add(organizationId);
  }

  return contracted;
});

/** The unsent charges sent, those of a workspace with no contract left unsent; how many were sent and how many were not. */
const sentCharges = Effect.fn("web/sentUsageCharges")(function* (
  account: MetronomeAccount,
  charges: readonly UnsentUsageCharge[],
  since: Date,
  now: Date,
) {
  const workspaces = [...new Set(charges.map((charge) => charge.organizationId))];
  const contracted = yield* contractedWorkspaces(account, workspaces, since, now);
  const sendable = charges.filter((charge) => contracted.has(charge.organizationId));
  let sent = 0;

  for (const batch of Arr.chunksOf(sendable, METRONOME.INGEST_BATCH)) {
    const taken = yield* ingestMetronomeEvents(account, batch.map(eventOf)).pipe(
      Effect.as(true),
      Effect.catchTag("MetronomeCallFailed", setAside("usage events were not sent, left unsent")),
    );

    if (taken) {
      yield* markUsageChargesSent(
        batch.map((charge) => charge.id),
        now,
      );
      sent += batch.length;
    }
  }

  return { sent, unsent: charges.length - sent };
});

/** The charges named that are not yet sent, sent to their workspaces' contracts and stamped sent; nothing where no Metronome account is configured. */
export const sendUsageCharges = Effect.fn("web/sendUsageCharges")(function* (
  chargeIds: readonly string[],
) {
  const { metronome } = yield* BillingEnvironment;

  if (metronome === undefined) {
    yield* Effect.logInfo("no Metronome account is configured; usage is left unsent");
    const idle: UsageSendRun = { configured: false, sent: 0, unsent: 0 };

    return idle;
  }

  const now = new Date(yield* Clock.currentTimeMillis);
  const since = new Date(now.getTime() - Duration.toMillis(METRONOME_BACKDATING));
  const unsent = yield* unsentUsageChargesOf(chargeIds);

  const run: UsageSendRun = {
    configured: true,
    ...(unsent.length === 0
      ? { sent: 0, unsent: 0 }
      : yield* sentCharges(metronome, unsent, since, now)),
  };

  yield* Effect.logInfo(`usage sent to Metronome: ${run.sent}, left unsent: ${run.unsent}`);

  return run;
});
