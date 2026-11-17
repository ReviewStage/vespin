/**
 * sandbox-session-charges.ts -- every ended session of a sandbox we opened for a workspace charged to it in the usage ledger, at what Vercel bills us for it: as its sandbox is deleted, and once a day for the rest.
 *
 * Vercel forgets a deleted sandbox's sessions, and a resume deletes the
 * stopped sandbox it makes again on its own drive, so most sessions are
 * charged as their sandbox is deleted: the adapter reads them just before
 * and hands them to `EndedSessionsOnDelete`, which the deployment answers
 * with `endedSessionsChargedOnDelete`.
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

import type { DatabaseServices } from "@repo/database/core/query";
import { sandboxOwnersNamed } from "@repo/database/models/sandbox-owners";
import { recordUsageCharges, type UsageCharge } from "@repo/database/models/usage-charges";
import { USAGE_KIND } from "@repo/database/usage-vocabulary";
import { EndedSessionsOnDelete, Sandbox, type SandboxSession } from "@repo/sandbox";
import { Cause, Clock, Duration, Effect, Layer } from "effect";
import { pricedSession } from "./sandbox-session-price.js";

/**
 * How far back each daily run reads, by when a session was created: the 24
 * hours a session runs at most, and two days past it, so a session that
 * ended since the last run is read whenever it began, even where the run
 * before it was missed.
 */
const READ_BACK = Duration.hours(72);

/** How many of the sandbox names passed by a log line names. */
const NAMED_IN_LOG = 5;

/** What a charge did: how many ended sessions it was handed, how many it newly charged, and how many it passed by, with no owner or no rate. */
interface SandboxSessionChargeRun {
  readonly ended: number;
  readonly charged: number;
  readonly unowned: number;
  readonly unpriced: number;
}

/** The ended sessions given charged to their sandboxes' workspaces, those already charged left be; one with no owner or no rate is logged and passed by. */
const chargedSessions = Effect.fn("web/chargedSandboxSessions")(function* (
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
  };

  return run;
});

/** Every ended session read within `READ_BACK` charged to its sandbox's workspace, those already charged left be: the daily sweep for sandboxes never deleted. */
export const chargeEndedSandboxSessions = Effect.fn("web/chargeEndedSandboxSessions")(function* () {
  const now = yield* Clock.currentTimeMillis;
  const read = yield* (yield* Sandbox).sessionsSince(now - Duration.toMillis(READ_BACK));
  const run = yield* chargedSessions(read);

  yield* Effect.logInfo(`sandbox sessions charged: ${run.charged} of ${run.ended} ended`);

  return run;
});

/**
 * `EndedSessionsOnDelete` as the deployment answers it: the sessions charged
 * over the database the deployment reads, a charge that failed logged and let
 * be, so a delete never waits on more than the ledger's write nor fails for
 * it. A session it missed is charged by the daily sweep only while its
 * sandbox stands, which it no longer does, so it goes uncharged.
 */
export const endedSessionsChargedOnDelete = Layer.effect(
  EndedSessionsOnDelete,
  Effect.gen(function* () {
    const database = yield* Effect.context<DatabaseServices>();

    return (sessions: readonly SandboxSession[]) =>
      chargedSessions(sessions).pipe(
        Effect.provideContext(database),
        Effect.catchCause((cause) =>
          Effect.logWarning(
            `a deleted sandbox's sessions were not charged: ${Cause.pretty(cause)}`,
          ),
        ),
        Effect.asVoid,
      );
  }),
);
