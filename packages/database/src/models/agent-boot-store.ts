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
 *   STARTING    -> BUILDING     agentBootBuilding, its workspace's drive
 *                               to be built first, under the longer
 *                               building deadline
 *   BUILDING    -> STARTING     agentBootBuilt, the drive built, under a
 *                               fresh deadline
 *   STARTING    -> HANDING_OFF  agentBootRunnerUp, its queue holding a
 *                               message, keeping the instant its attempt
 *                               began; READY where none
 *   HANDING_OFF -> READY        agentBootHandedOff
 *   STARTING | BUILDING | HANDING_OFF -> FAILED  failAgentBoot, its
 *                               queue paused
 *   FAILED      -> STARTING     rebootAgent, the pause lifted
 *   READY       -> (none)       endAgentBoot, once the first turn settles
 *
 * The runner coming up names the attempt its machine was begun under, and a
 * failure may, so a delivery or a sweep of a boot Retry has since replaced
 * moves nothing. Nothing here reads the clock: each write is handed its
 * instant.
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
import { agentTable } from "../schemas/agent.js";
import { agentBootTable } from "../schemas/agent-boot.js";
import { queuedMessage } from "../schemas/agent-queue.js";
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

/**
 * The phases a boot can fail from and lapse in: under way, waiting on its
 * workspace's drive, or handing its first message off, so a hand-off whose
 * queue read failed, or a build whose function died, and which nothing
 * would move on again, is failed by the minute sweep past its deadline and
 * booted again by Retry rather than standing for good. A hand-off stopped at
 * a first message a member is editing never lapses, since it waits on them,
 * and one whose first message moved within a deadline, as their save or
 * cancel moves it and the claim that sends it does, lapses only a deadline
 * after that.
 */
const UNSETTLED_PHASES: readonly BootPhase[] = [
  ...BOOTING_PHASES,
  BOOT_PHASE.BUILDING,
  BOOT_PHASE.HANDING_OFF,
];

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

/** When a boot that entered its phase at `at` is failed by the minute sweep, `bound` later: under way's deadline where none is named. */
const deadlineFrom = (at: Date, bound: number = BOOT_BOUNDS.DEADLINE_MS) =>
  new Date(at.getTime() + bound);

/** The earliest a hand-off's first message may have moved and still keep it from lapsing at `now`: a deadline back. */
const movedSince = (now: Date) => new Date(now.getTime() - BOOT_BOUNDS.DEADLINE_MS);

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
    keepsPhaseAt: Schema.Boolean,
    deadlineMs: Schema.Number,
  }),
  Result: BootRowSchema,
  execute: ({ agentId, attempt, from, to, at, failure, nextAttempt, keepsPhaseAt, deadlineMs }) =>
    Database.use((db) =>
      db
        .update(agentBootTable)
        .set({
          phase: to,
          ...(keepsPhaseAt ? undefined : { phaseAt: at }),
          deadlineAt: deadlineFrom(at, deadlineMs),
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
          and(
            inArray(agentBootTable.phase, UNSETTLED_PHASES),
            lte(agentBootTable.deadlineAt, now),
            // Note that a hand-off whose first message a member is editing waits on them, not on its machine, and one whose first message moved within a deadline (an edit saved, a hold let go, a claim to send) is under way again, so neither lapses.
            sql`not (${agentBootTable.phase} = ${BOOT_PHASE.HANDING_OFF} and coalesce((select ${queuedMessage.editing} or ${queuedMessage.updatedAt} > ${movedSince(now).toISOString()}::timestamptz from ${queuedMessage} where ${queuedMessage.agentId} = ${agentBootTable.agentId} order by ${queuedMessage.position} asc limit 1), false))`,
          ),
        )
        .orderBy(asc(agentBootTable.deadlineAt))
        .limit(limit),
    ),
});

/** A boot waiting on its workspace's drive, with what resuming it reads: its agent's account, its attempt, and the repository its agent starts in. */
export interface BuildingAgentBoot {
  readonly agentId: string;
  readonly userId: string;
  readonly attempt: number;
  readonly repository: string | null;
}

const BuildingBootSchema = Schema.Struct({
  agentId: Schema.String,
  userId: Schema.String,
  attempt: Schema.Number,
  repository: Schema.NullOr(Schema.String),
});

const findBuilding = SqlSchema.findAll({
  Request: Schema.String,
  Result: BuildingBootSchema,
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          agentId: agentBootTable.agentId,
          userId: agentTable.userId,
          attempt: agentBootTable.attempt,
          repository: agentTable.repository,
        })
        .from(agentBootTable)
        .innerJoin(agentTable, eq(agentTable.id, agentBootTable.agentId))
        .where(
          and(
            eq(agentTable.organizationId, organizationId),
            eq(agentBootTable.phase, BOOT_PHASE.BUILDING),
          ),
        )
        .orderBy(asc(agentBootTable.phaseAt)),
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
    /** Whether the move keeps the instant the boot entered the phase it leaves, as a hand-off still says the boot is starting. */
    readonly keepsPhaseAt?: boolean | undefined;
    /** How long past `at` the sweep fails the boot: under way's deadline where none is named. */
    readonly deadlineMs?: number | undefined;
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
      keepsPhaseAt: move.keepsPhaseAt === true,
      deadlineMs: move.deadlineMs ?? BOOT_BOUNDS.DEADLINE_MS,
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
 * The agent's runner up (STARTING -> HANDING_OFF) under `attempt`, so its
 * queue's head goes next, still counted from when its attempt began, since
 * the transcript says it is starting until the hand-off ends; straight to
 * READY where nothing stands queued.
 * Answers the boot where it moved, none where it stood elsewhere or under
 * another attempt: an earlier poll moved it, or Retry replaced the machine
 * that came up.
 */
export function agentBootRunnerUp(
  agentId: string,
  at: Date,
  attempt: number,
): AgentBootEffect<Option.Option<AgentBootRow>> {
  return underAgentQueueLock(
    agentId,
    Effect.gen(function* () {
      const holds = yield* queueHoldsInLock(agentId);

      return yield* moved(agentId, {
        attempt,
        from: BOOTING_PHASES,
        to: holds ? BOOT_PHASE.HANDING_OFF : BOOT_PHASE.READY,
        at,
        keepsPhaseAt: holds,
      });
    }),
    () => false,
  );
}

/**
 * The agent's first launch held for its workspace's drive to be built
 * (STARTING -> BUILDING) under `attempt` where one is named, failed by the
 * sweep only past the building deadline, since that lapses only where the
 * build's function died. It keeps the instant it began starting, since the
 * wire still says it is starting. Answers the boot where it moved.
 */
export function agentBootBuilding(
  agentId: string,
  at: Date,
  attempt?: number,
): AgentBootEffect<Option.Option<AgentBootRow>> {
  return underAgentQueueLock(
    agentId,
    moved(agentId, {
      attempt,
      from: [BOOT_PHASE.STARTING],
      to: BOOT_PHASE.BUILDING,
      at,
      keepsPhaseAt: true,
      deadlineMs: BOOT_BOUNDS.BUILDING_DEADLINE_MS,
    }),
    () => false,
  );
}

/**
 * The agent's workspace drive built (BUILDING -> STARTING) under `attempt`
 * where one is named, so its machine boots under a fresh deadline, still
 * counted from when it began starting. Answers the boot where it moved,
 * none where it stood elsewhere: the sweep failed it meanwhile.
 */
export function agentBootBuilt(
  agentId: string,
  at: Date,
  attempt?: number,
): AgentBootEffect<Option.Option<AgentBootRow>> {
  return underAgentQueueLock(
    agentId,
    moved(agentId, {
      attempt,
      from: [BOOT_PHASE.BUILDING],
      to: BOOT_PHASE.STARTING,
      at,
      keepsPhaseAt: true,
    }),
    () => false,
  );
}

/** The workspace's boots waiting on its drive (BUILDING), the longest waiting first. */
export function buildingAgentBootsOf(
  organizationId: string,
): AgentBootEffect<readonly BuildingAgentBoot[]> {
  return findBuilding(organizationId);
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
 * The agent's first launch failed (STARTING | BUILDING | HANDING_OFF -> FAILED) for `failure`,
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
        from: UNSETTLED_PHASES,
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

/** The boots still under way, building, or handing off past their deadline at `now`, the longest past first, bar a hand-off held for an edit to its first message or whose first message moved within a deadline. */
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
