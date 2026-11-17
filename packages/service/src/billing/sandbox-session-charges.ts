/**
 * sandbox-session-charges.ts -- once a day, every ended session of a sandbox we opened for a workspace charged to it in the usage ledger, at what Vercel bills us for it.
 *
 * Vercel's scheduler calls this once a day (the root `vercel.json`;
 * `maintenance/usage-ledger-app.ts`). It reads every session the project's
 * sandboxes ran that was created within `READ_BACK`, keeps those that ended
 * (stopped, failed, or aborted), names each one's workspace and member
 * through the record written as its sandbox was opened
 * (`@repo/database/models/sandbox-owners`), prices it
 * (`sandbox-session-price.ts`), and records it in the ledger
 * (`@repo/database/models/usage-charges`), where a session already charged
 * is left as it stood. So no cursor is kept: a run reads again what the last
 * read, and a day's run that failed is made up by the next. A session whose
 * sandbox no record names, as a Preview deployment's or one opened before
 * the records were kept, or one in a region with no rate, is logged and
 * passed by. It always runs, whether or not billing is live.
 */

import { sandboxOwnersNamed } from "@repo/database/models/sandbox-owners";
import { recordUsageCharges, type UsageCharge } from "@repo/database/models/usage-charges";
import { USAGE_KIND } from "@repo/database/usage-vocabulary";
import { Sandbox } from "@repo/sandbox";
import { Clock, Duration, Effect } from "effect";
import { pricedSession } from "./sandbox-session-price.js";

/**
 * How far back each run reads, by when a session was created: twice the 24
 * hours a session runs at most, so a session that ended since the last run
 * is read whenever it began, and a run missed is read over by the next.
 */
const READ_BACK = Duration.hours(48);

/** How many of the sandbox names passed by a log line names. */
const NAMED_IN_LOG = 5;

/** What a run did: how many ended sessions it read, how many it newly charged, and how many it passed by, with no owner or no rate. */
interface SandboxSessionChargeRun {
  readonly ended: number;
  readonly charged: number;
  readonly unowned: number;
  readonly unpriced: number;
}

/** Every ended session read within `READ_BACK` charged to its sandbox's workspace, those already charged left be. */
export const chargeEndedSandboxSessions = Effect.fn("web/chargeEndedSandboxSessions")(function* () {
  const now = yield* Clock.currentTimeMillis;
  const sandbox = yield* Sandbox;
  const read = yield* sandbox.sessionsSince(now - Duration.toMillis(READ_BACK));
  const ended = read.filter((session) => session.ended !== undefined);
  const names = new Set(ended.flatMap((session) => session.sandboxName ?? []));
  const owners = yield* sandboxOwnersNamed([...names]);
  const charges: UsageCharge[] = [];
  const unowned: string[] = [];
  const unpricedRegions = new Set<string>();
  let unpriced = 0;

  for (const session of ended) {
    const owner = owners.get(session.sandboxName ?? "");
    const priced = pricedSession(session);

    if (owner === undefined) {
      unowned.push(session.sandboxName ?? session.id);
    } else if (priced === undefined) {
      unpriced += 1;
      unpricedRegions.add(session.region);
    } else {
      charges.push({
        organizationId: owner.organizationId,
        userId: owner.userId,
        kind: USAGE_KIND.SANDBOX_SESSION,
        sourceId: session.id,
        figures: { sandboxName: owner.sandboxName, ...priced.figures },
        amountMicroUsd: priced.amountMicroUsd,
        occurredAt: new Date(session.stoppedAt ?? session.createdAt),
      });
    }
  }

  const charged = yield* recordUsageCharges(charges);

  if (unowned.length > 0) {
    yield* Effect.logWarning(
      `sandbox sessions with no owner passed by: ${unowned.length}, such as ${unowned.slice(0, NAMED_IN_LOG).join(", ")}`,
    );
  }

  if (unpriced > 0) {
    yield* Effect.logWarning(
      `sandbox sessions in a region with no rate passed by: ${unpriced}, in ${[...unpricedRegions].join(", ")}`,
    );
  }

  yield* Effect.logInfo(`sandbox sessions charged: ${charged} of ${ended.length} ended`);

  const run: SandboxSessionChargeRun = {
    ended: ended.length,
    charged,
    unowned: unowned.length,
    unpriced,
  };

  return run;
});
