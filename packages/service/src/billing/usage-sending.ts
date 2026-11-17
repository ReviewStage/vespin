/**
 * usage-sending.ts -- every charge in the usage ledger not yet sent on, sent to Metronome as one usage event of its workspace and stamped sent, once a day after the ledger is read.
 *
 * The daily job (`maintenance/usage-ledger-app.ts`) runs this after it
 * charges the day's sessions. It reads the unsent charges a page at a time,
 * makes each workspace's Metronome customer and contract the first time it
 * has usage to send (`@repo/database/models/workspace-billing`), and sends
 * its charges `METRONOME.INGEST_BATCH` to a request, each as an event whose
 * transaction id is the charge's own id, so a charge sent twice, as one whose
 * stamp failed to be written is, is counted once
 * (https://docs.metronome.com/api-reference/usage/ingest-events). A batch
 * Metronome took is stamped sent; one it refused, and a workspace whose
 * customer or contract could not be made, is logged and left unsent for the
 * next day's run.
 *
 * Only charges whose usage happened within `METRONOME_BACKDATING` are read,
 * the furthest back Metronome takes an event. Where no Metronome account is
 * configured (`billing-environment.ts`), nothing is sent: the ledger is
 * written all the same, and its charges are sent once one is. It runs
 * whether or not billing is live.
 */

import {
  earliestUnsentUsage,
  markUsageChargesSent,
  type UnsentUsageCharge,
  unsentUsageCharges,
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

/** How far back Metronome takes a usage event; a charge older than this is never read. */
const METRONOME_BACKDATING = Duration.days(34);

/** How many unsent charges one page reads. */
const PAGE = 1000;

/** What a run did: how many charges it sent, how many it left unsent for a refusal, and whether it sent at all. */
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
 * The workspaces among those named whose contract stands, each made where it
 * was missing; one that could not be made is logged and left out. A contract
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
      Effect.catchTag("MetronomeCallFailed", (failure) =>
        Effect.as(
          Effect.logError(
            `a workspace's Metronome contract was not made, its usage left unsent: ${described(failure)}`,
          ),
          false,
        ),
      ),
    );

    if (made) contracted.add(organizationId);
  }

  return contracted;
});

/** One page of unsent charges sent, those of a workspace with no contract left unsent; how many were sent and how many were not. */
const sentPage = Effect.fn("web/sentUsagePage")(function* (
  account: MetronomeAccount,
  page: readonly UnsentUsageCharge[],
  since: Date,
  now: Date,
) {
  const workspaces = [...new Set(page.map((charge) => charge.organizationId))];
  const contracted = yield* contractedWorkspaces(account, workspaces, since, now);
  const sendable = page.filter((charge) => contracted.has(charge.organizationId));
  let sent = 0;

  for (const batch of Arr.chunksOf(sendable, METRONOME.INGEST_BATCH)) {
    const taken = yield* ingestMetronomeEvents(account, batch.map(eventOf)).pipe(
      Effect.as(true),
      Effect.catchTag("MetronomeCallFailed", (failure) =>
        Effect.as(
          Effect.logError(`usage events were not sent, left unsent: ${described(failure)}`),
          false,
        ),
      ),
    );

    if (taken) {
      yield* markUsageChargesSent(
        batch.map((charge) => charge.id),
        now,
      );
      sent += batch.length;
    }
  }

  return { sent, unsent: page.length - sent };
});

/** Every charge not yet sent, within what Metronome takes, sent to its workspace's contract and stamped sent; nothing where no Metronome account is configured. */
export const sendUnsentUsage = Effect.fn("web/sendUnsentUsage")(function* () {
  const { metronome } = yield* BillingEnvironment;

  if (metronome === undefined) {
    yield* Effect.logInfo("no Metronome account is configured; usage is left unsent");
    const idle: UsageSendRun = { configured: false, sent: 0, unsent: 0 };

    return idle;
  }

  const now = new Date(yield* Clock.currentTimeMillis);
  const since = new Date(now.getTime() - Duration.toMillis(METRONOME_BACKDATING));
  let after: string | null = null;
  let sent = 0;
  let unsent = 0;

  for (;;) {
    const page: readonly UnsentUsageCharge[] = yield* unsentUsageCharges({
      since,
      after,
      limit: PAGE,
    });

    const last = page.at(-1);

    if (last === undefined) break;
    const run = yield* sentPage(metronome, page, since, now);
    sent += run.sent;
    unsent += run.unsent;
    after = last.id;
  }

  yield* Effect.logInfo(`usage sent to Metronome: ${sent}, left unsent: ${unsent}`);
  const run: UsageSendRun = { configured: true, sent, unsent };

  return run;
});
