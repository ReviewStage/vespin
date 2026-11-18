/**
 * sandbox-session-charges.ts -- ended sessions of the sandboxes we opened for a workspace charged to it in the usage ledger, at what Vercel bills us for them.
 *
 * Vercel forgets a deleted sandbox's sessions, and a resume deletes the
 * stopped sandbox it makes again on its own drive, so most sessions are
 * charged as their sandbox is deleted: the adapter reads them just before
 * and hands them to `EndedSessionsOnDelete`. The rest are charged by the
 * check each open of a sandbox books (`usage-queues.ts`), which reads that
 * sandbox's sessions once it must have stopped. Both come here: each
 * session's workspace and member are named through the record written as
 * its sandbox was opened (`@repo/database/models/sandbox-owners`), it is
 * priced (`sandbox-session-price.ts`) and recorded in the ledger
 * (`@repo/database/models/usage-charges`), where a session already charged
 * is left as it stood, and the ledger's ids of those not yet sent on are
 * answered for the send. A session whose sandbox no record names, as a
 * Preview deployment's or one opened before the records were kept, or one
 * in a region with no rate, is logged and passed by. It always runs, whether
 * or not billing is live.
 */

import { sandboxOwnersNamed } from "@repo/database/models/sandbox-owners";
import {
  recordUsageCharges,
  type UsageCharge,
  unsentChargeIdsOf,
} from "@repo/database/models/usage-charges";
import { USAGE_KIND } from "@repo/database/usage-vocabulary";
import { type SandboxSession, SESSION_END } from "@repo/sandbox";
import { Effect } from "effect";
import { pricedSession } from "./sandbox-session-price.js";

/** How many of the sandbox names passed by a log line names. */
const NAMED_IN_LOG = 5;

/** What a charge did: how many ended sessions it was handed, how many it newly charged, how many it passed by, with no owner or no rate, and the ledger's ids of its sessions' charges not yet sent on. */
interface SandboxSessionChargeRun {
  readonly ended: number;
  readonly charged: number;
  readonly unowned: number;
  readonly unpriced: number;
  readonly unsentIds: readonly string[];
}

/**
 * The ended sessions given charged to their sandboxes' workspaces, those
 * already charged left be; one with no owner or no rate is logged and passed
 * by. Note that the ids answered are every unsent charge of these sessions,
 * not only those recorded now, so a send whose publish failed is published
 * again by the next charge of the same sessions.
 */
export const chargedSessions = Effect.fn("web/chargedSandboxSessions")(function* (
  sessions: readonly SandboxSession[],
) {
  const ended = sessions.filter((session) => session.ended !== undefined);
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

  const unsentIds = yield* unsentChargeIdsOf(
    USAGE_KIND.SANDBOX_SESSION,
    charges.map((charge) => charge.sourceId),
  );

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

  const run: SandboxSessionChargeRun = {
    ended: ended.length,
    charged,
    unowned: unowned.length,
    unpriced,
    unsentIds,
  };

  return run;
});

/**
 * Whether a session stopped but Vercel has not yet answered what it used:
 * its CPU time or its transfer, which a stopped session carries once its
 * figures are whole. One that failed or was aborted answers neither, ever.
 * Note that such a session is not charged yet, because a charge is taken
 * once and a zero taken now would stand.
 */
export function figuresAwaited(session: SandboxSession): boolean {
  return (
    session.ended === SESSION_END.STOPPED &&
    (session.activeCpuMs === undefined || session.networkTransfer === undefined)
  );
}
