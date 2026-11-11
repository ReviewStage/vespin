/**
 * agent-boot-store.ts -- the one writer of an agent's first launch: its boot begun with its first message queued, its phases moved on, failed with its queue paused, booted again, and gone once its first turn settles.
 *
 * Every write holds the agent's queue lock (`underAgentQueueLock`), the same
 * lock a send diverted into the queue and the queue's hand-off take, so a
 * line sent while the boot moves either reads the boot as it stood before
 * or as it stands after, never between: a send that read the boot under way
 * is in the queue before the boot's end hands it on. Each write that moves
 * the queue (a line queued, a pause written or lifted) moves its revision
 * on as every queue write does.
 *
 * The phases (`@repo/features/agent-boot`'s `BOOT_PHASE`), and nothing else:
 *
 *   (none)      -> STARTING     beginAgentBoot, its first line queued
 *   STARTING    -> HANDING_OFF  agentBootRunnerUp, its queue holding a
 *                               message; READY where none
 *   HANDING_OFF -> READY        agentBootHandedOff
 *   STARTING    -> FAILED       failAgentBoot, its queue paused
 *   FAILED      -> STARTING     rebootAgent, the pause lifted
 *   READY       -> (none)       endAgentBoot, once the first turn settles
 *
 * A failure may name the attempt it was begun under, so a delivery or a
 * sweep of a boot Retry has since replaced moves nothing; the runner coming
 * up names none, as its caller reads the machine as it stands. Nothing here reads the clock: each
 * write is handed its instant.
 */

import {
  BOOT_BOUNDS,
  BOOT_FAILURE,
  BOOT_PHASE,
  BOOTING_PHASES,
  type BootFailure,
  type BootPhase,
} from "@repo/features/agent-boot";
import { QUEUE_PAUSE } from "@repo/features/agent-queue-wire";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentBootTable } from "../schemas/agent-boot.js";
import {
  pauseInLock,
  type QueuedLine,
  queueHoldsInLock,
  queueLineInLock,
  resumeInLock,
  underAgentQueueLock,
} from "./agent-queue-store.js";

type AgentBootEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const PHASES: readonly BootPhase[] = Object.values(BOOT_PHASE);
const FAILURES: readonly BootFailure[] = Object.values(BOOT_FAILURE);

/** An agent's first launch as its row keeps it. */
export interface AgentBootRow {
  readonly agentId: string;
  readonly attempt: number;
  readonly phase: BootPhase;
  readonly phaseAt: Date;
  readonly deadlineAt: Date;
  readonly failure: BootFailure | undefined;
}

const BootRowSchema = Schema.Struct({
  agentId: Schema.String,
  attempt: Schema.Number,
  phase: Schema.Literals(PHASES),
  phaseAt: Schema.Date,
  deadlineAt: Schema.Date,
  failure: Schema.NullOr(Schema.Literals(FAILURES)),
});

const BOOT_COLUMNS = {
  agentId: agentBootTable.agentId,
  attempt: agentBootTable.attempt,
  phase: agentBootTable.phase,
  phaseAt: agentBootTable.phaseAt,
  deadlineAt: agentBootTable.deadlineAt,
  failure: agentBootTable.failure,
};

function bootOf(row: typeof BootRowSchema.Type): AgentBootRow {
  return {
    ...row,
    failure: row.failure ?? undefined,
  };
}

/** When a boot entered under way at `at` is failed by the minute sweep. */
const deadlineFrom = (at: Date) => new Date(at.getTime() + BOOT_BOUNDS.DEADLINE_MS);

const findBoots = SqlSchema.findAll({
  Request: Schema.Struct({ agentIds: Schema.Array(Schema.String) }),
  Result: BootRowSchema,
  execute: ({ agentIds }) =>
    Database.use((db) =>
      db.select(BOOT_COLUMNS).from(agentBootTable).where(inArray(agentBootTable.agentId, agentIds)),
    ),
});

const upsertStarting = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String, at: Schema.Date }),
  execute: ({ agentId, at }) =>
    Database.use((db) =>
      db
        .insert(agentBootTable)
        .values({
          agentId,
          phase: BOOT_PHASE.STARTING,
          phaseAt: at,
          deadlineAt: deadlineFrom(at),
        })
        // Note that a Start repeated keeps the boot it began first.
        .onConflictDoNothing({ target: agentBootTable.agentId }),
    ),
});

/** A boot moved from one of `from` to `to` at `at`, under `attempt` where one is named; answers it where it moved. */
const updatePhase = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    attempt: Schema.NullOr(Schema.Number),
    from: Schema.Array(Schema.Literals(PHASES)),
    to: Schema.Literals(PHASES),
    at: Schema.Date,
    failure: Schema.NullOr(Schema.Literals(FAILURES)),
    nextAttempt: Schema.Boolean,
  }),
  Result: BootRowSchema,
  execute: ({ agentId, attempt, from, to, at, failure, nextAttempt }) =>
    Database.use((db) =>
      db
        .update(agentBootTable)
        .set({
          phase: to,
          phaseAt: at,
          deadlineAt: deadlineFrom(at),
          ...(failure === null ? undefined : { failure }),
          // Note that a next attempt keeps nothing of the last, its failure among it.
          ...(nextAttempt
            ? { attempt: sql`${agentBootTable.attempt} + 1`, failure: null }
            : undefined),
        })
        .where(
          and(
            eq(agentBootTable.agentId, agentId),
            inArray(agentBootTable.phase, from),
            attempt === null ? undefined : eq(agentBootTable.attempt, attempt),
          ),
        )
        .returning(BOOT_COLUMNS),
    ),
});

const deleteReady = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) =>
      db
        .delete(agentBootTable)
        .where(
          and(eq(agentBootTable.agentId, agentId), eq(agentBootTable.phase, BOOT_PHASE.READY)),
        ),
    ),
});

const findLapsed = SqlSchema.findAll({
  Request: Schema.Struct({ now: Schema.Date, limit: Schema.Number }),
  Result: BootRowSchema,
  execute: ({ now, limit }) =>
    Database.use((db) =>
      db
        .select(BOOT_COLUMNS)
        .from(agentBootTable)
        .where(
          and(inArray(agentBootTable.phase, BOOTING_PHASES), lte(agentBootTable.deadlineAt, now)),
        )
        .orderBy(asc(agentBootTable.deadlineAt))
        .limit(limit),
    ),
});

/** One phase move, answered as the boot it moved, none where the boot stood elsewhere. */
function moved(
  agentId: string,
  move: {
    readonly attempt?: number | undefined;
    readonly from: readonly BootPhase[];
    readonly to: BootPhase;
    readonly at: Date;
    readonly failure?: BootFailure | undefined;
    readonly nextAttempt?: boolean | undefined;
  },
): AgentBootEffect<Option.Option<AgentBootRow>> {
  return Effect.map(
    updatePhase({
      agentId,
      attempt: move.attempt ?? null,
      from: move.from,
      to: move.to,
      at: move.at,
      failure: move.failure ?? null,
      nextAttempt: move.nextAttempt === true,
    }),
    ([row]) => Option.map(Option.fromNullishOr(row), bootOf),
  );
}

/** The agents' first launches, by agent, where a boot record stands. */
export function agentBootsOf(
  agentIds: readonly string[],
): AgentBootEffect<ReadonlyMap<string, AgentBootRow>> {
  if (agentIds.length === 0) return Effect.succeed(new Map());
  return Effect.map(
    findBoots({ agentIds }),
    (rows) => new Map(rows.map((row) => [row.agentId, bootOf(row)])),
  );
}

/** The agent's first launch, where a boot record stands. */
export function agentBootOf(agentId: string): AgentBootEffect<Option.Option<AgentBootRow>> {
  return Effect.map(agentBootsOf([agentId]), (boots) => Option.fromNullishOr(boots.get(agentId)));
}

/**
 * The agent's first launch begun at `at` ((none) -> STARTING), its first
 * line queued as `userId`'s in the same transaction, so the line waits for
 * the machine before any send can overtake it. A Start repeated keeps the
 * boot and the line it began first.
 */
export function beginAgentBoot(
  agentId: string,
  at: Date,
  first:
    | {
        readonly userId: string;
        readonly id: string;
        readonly sendKey: string;
        readonly text: string;
        readonly attachments?: readonly AgentAttachment[] | undefined;
        readonly line: QueuedLine;
      }
    | undefined,
): AgentBootEffect<void> {
  let inserted = false;
  return Effect.asVoid(
    underAgentQueueLock(
      agentId,
      Effect.gen(function* () {
        yield* upsertStarting({ agentId, at });
        if (first === undefined) return;
        const queued = yield* queueLineInLock(agentId, first.userId, first);
        inserted = queued.inserted;
      }),
      () => inserted,
    ),
  );
}

/**
 * The agent's runner up (STARTING -> HANDING_OFF), so its queue's head goes
 * next; straight to READY where nothing stands queued. Answers the boot
 * where it moved, none where it stood elsewhere: an earlier poll moved it.
 */
export function agentBootRunnerUp(
  agentId: string,
  at: Date,
): AgentBootEffect<Option.Option<AgentBootRow>> {
  return underAgentQueueLock(
    agentId,
    Effect.gen(function* () {
      const holds = yield* queueHoldsInLock(agentId);
      return yield* moved(agentId, {
        from: BOOTING_PHASES,
        to: holds ? BOOT_PHASE.HANDING_OFF : BOOT_PHASE.READY,
        at,
      });
    }),
    () => false,
  );
}

/** The queue's head handed off to the agent's runner (HANDING_OFF -> READY). */
export function agentBootHandedOff(agentId: string, at: Date): AgentBootEffect<void> {
  return Effect.asVoid(
    underAgentQueueLock(
      agentId,
      moved(agentId, { from: [BOOT_PHASE.HANDING_OFF], to: BOOT_PHASE.READY, at }),
      () => false,
    ),
  );
}

/**
 * The agent's first launch failed (STARTING -> FAILED) for `failure`,
 * under `attempt` where one is named, and its queue paused in
 * the same transaction, its messages kept for Retry. Answers whether it
 * moved.
 */
export function failAgentBoot(
  agentId: string,
  failure: BootFailure,
  at: Date,
  attempt?: number,
): AgentBootEffect<boolean> {
  let paused = false;
  return underAgentQueueLock(
    agentId,
    Effect.gen(function* () {
      const failed = yield* moved(agentId, {
        attempt,
        from: BOOTING_PHASES,
        to: BOOT_PHASE.FAILED,
        at,
        failure,
      });
      if (Option.isNone(failed)) return false;
      paused = yield* pauseInLock(agentId, QUEUE_PAUSE.BOOT_FAILED);
      return true;
    }),
    () => paused,
  );
}

/**
 * A failed first launch begun again (FAILED -> STARTING) under the next
 * attempt, the queue's boot pause lifted, so its messages go once this one
 * is up. Answers the boot where it stood failed.
 */
export function rebootAgent(
  agentId: string,
  at: Date,
): AgentBootEffect<Option.Option<AgentBootRow>> {
  let resumed = false;
  return underAgentQueueLock(
    agentId,
    Effect.gen(function* () {
      const boot = yield* moved(agentId, {
        from: [BOOT_PHASE.FAILED],
        to: BOOT_PHASE.STARTING,
        at,
        nextAttempt: true,
      });
      if (Option.isSome(boot)) resumed = yield* resumeInLock(agentId, QUEUE_PAUSE.BOOT_FAILED);
      return boot;
    }),
    () => resumed,
  );
}

/** The boots still under way past their deadline at `now`, the longest past first. */
export function lapsedAgentBoots(
  now: Date,
  limit: number,
): AgentBootEffect<readonly AgentBootRow[]> {
  return Effect.map(findLapsed({ now, limit }), (rows) => rows.map(bootOf));
}

/** The agent's boot record gone once its first message went and its first turn settled (READY -> (none)), so a later cold start reads as it always has. */
export function endAgentBoot(agentId: string): AgentBootEffect<void> {
  return deleteReady({ agentId });
}
