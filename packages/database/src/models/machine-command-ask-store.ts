import {
  MACHINE_ASK_BOUNDS,
  MACHINE_ASK_DECISION,
  type MachineAskDecision,
  type MachineAskStandingAnswer,
  type MachineAskSubject,
  machineAskAppKey,
  machineAskDecisionSchema,
  machineAskSubjectSchema,
} from "@repo/features/machine-ask-wire";
import { MACHINE_COMMAND_MODE } from "@repo/features/machine-command-wire";
import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, or, type SQL, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { TXID_RETURNING } from "../core/txid.js";
import { device } from "../schemas/device.js";
import { machineCommand } from "../schemas/machine-command.js";
import { machineCommandAsk } from "../schemas/machine-command-ask.js";
import { changeMachine } from "./device-store.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * machine-command-ask-store.ts -- the asks an account's machines hold for its answer: posted by the machine, answered once from any of its devices, said closed as the window runs out, and taken down.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account posts, answers, or takes down another's asks, and
 * the account's read of them (`packages/service/src/live/reads/machine-asks.ts`)
 * reads its own alone. A machine posts an ask only for a command of its
 * account's it claimed, as a device of that account, so no ask stands for a
 * command it does not hold. The first answer written stands: the update
 * that writes one takes only an ask still waiting, so of two answers given
 * at once, or an answer and the machine saying the window closed, the
 * database keeps one, and the other is answered with it.
 *
 * An ask its machine said closed, or one past its window and a grace whose
 * machine never said, is late. A late Allow once stands as a grant, which
 * the same agent's next ask of the same on the same machine takes as its
 * answer, until the sweep takes it down with the rest; a late Always allow
 * is written to the machine's own settings, which it follows, and a late
 * Deny only takes the ask down, since nothing waits on it.
 */

const AskKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

const DecisionSchema = Schema.NullOr(machineAskDecisionSchema);

/** One ask as its machine posts it. */
const PostedRowSchema = Schema.Struct({
  ...AskKeySchema.fields,
  deviceId: Schema.String,
  subject: machineAskSubjectSchema,
  now: Schema.Date,
  expiresAt: Schema.Date,
});

/** The app an ask's subject names, by the key its machine allows it by, as the column holds it. */
const SUBJECT_APP = sql`coalesce(${machineCommandAsk.subject} -> 'app' ->> 'bundleId', ${machineCommandAsk.subject} -> 'app' ->> 'name')`;

/** Whether an ask asks the same as `subject`: the same command's words, or the same app by its key, never by how it is drawn. */
function sameSubject(subject: MachineAskSubject): SQL {
  return "command" in subject
    ? sql`${machineCommandAsk.subject} ->> 'command' = ${subject.command}`
    : sql`${SUBJECT_APP} = ${machineAskAppKey(subject.app)}`;
}

/**
 * Writes the ask, where the account holds the command claimed and the
 * device is the account's and not removed, and the command was queued for
 * that device or for none; the agent is the command's. An ask posted again
 * under its id writes nothing.
 */
const insertAsk = SqlSchema.findAll({
  Request: PostedRowSchema,
  Result: Schema.Struct({ agentId: Schema.NullOr(Schema.String) }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(machineCommandAsk)
        .select((qb) =>
          qb
            .select({
              id: sql<string>`${machineCommand.id}`.as("id"),
              userId: sql<string>`${machineCommand.userId}`.as("user_id"),
              deviceId: sql<string>`${device.id}`.as("device_id"),
              agentId: sql<string | null>`${machineCommand.agentId}`.as("agent_id"),
              subject: sql<MachineAskSubject>`${JSON.stringify(row.subject)}::jsonb`.as("subject"),
              askedAt: sql<Date>`${row.now}::timestamptz`.as("asked_at"),
              expiresAt: sql<Date>`${row.expiresAt}::timestamptz`.as("expires_at"),
            })
            .from(machineCommand)
            .innerJoin(device, eq(device.id, row.deviceId))
            .where(
              and(
                eq(machineCommand.id, row.id),
                eq(machineCommand.userId, row.userId),
                isNotNull(machineCommand.claimedAt),
                or(isNull(machineCommand.deviceId), eq(machineCommand.deviceId, device.id)),
                eq(device.userId, row.userId),
                isNull(device.removedAt),
              ),
            ),
        )
        .onConflictDoNothing({ target: machineCommandAsk.id })
        .returning({ agentId: machineCommandAsk.agentId }),
    ),
});

/**
 * Takes the oldest grant a late Allow once left for the same agent's ask of
 * the same on the same machine, the new ask itself aside, leaving any other
 * for a later ask; the row it took. Note that a grant is deleted as it is
 * taken, and one another post holds is passed over, so of two asks posted at
 * once each takes its own or none.
 */
const takeGrant = SqlSchema.findAll({
  Request: Schema.Struct({
    ...AskKeySchema.fields,
    deviceId: Schema.String,
    agentId: Schema.String,
    subject: machineAskSubjectSchema,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, deviceId, agentId, subject }) =>
    Database.use((db) =>
      db
        .delete(machineCommandAsk)
        .where(
          inArray(
            machineCommandAsk.id,
            db
              .select({ id: machineCommandAsk.id })
              .from(machineCommandAsk)
              .where(
                and(
                  eq(machineCommandAsk.userId, userId),
                  eq(machineCommandAsk.deviceId, deviceId),
                  eq(machineCommandAsk.agentId, agentId),
                  ne(machineCommandAsk.id, id),
                  isNotNull(machineCommandAsk.lapsedAt),
                  eq(machineCommandAsk.decision, MACHINE_ASK_DECISION.ALLOW_ONCE),
                  sameSubject(subject),
                ),
              )
              .orderBy(asc(machineCommandAsk.askedAt))
              .limit(1)
              .for("update", { skipLocked: true }),
          ),
        )
        .returning({ id: machineCommandAsk.id }),
    ),
});

/** Writes the answer on the account's ask, where none stands yet; the answer written, whether the ask was late, and the transaction, or none. */
const writeAnswer = SqlSchema.findAll({
  Request: Schema.Struct({
    ...AskKeySchema.fields,
    decision: machineAskDecisionSchema,
    note: Schema.NullOr(Schema.String),
    now: Schema.Date,
    lateBefore: Schema.Date,
  }),
  Result: Schema.Struct({
    decision: machineAskDecisionSchema,
    note: Schema.NullOr(Schema.String),
    deviceId: Schema.String,
    agentId: Schema.NullOr(Schema.String),
    subject: machineAskSubjectSchema,
    late: Schema.Boolean,
    txid: Schema.String,
  }),
  execute: ({ userId, id, decision, note, now, lateBefore }) =>
    Database.use((db) =>
      db
        .update(machineCommandAsk)
        // Note that an ask past its window and the grace is said closed as its late answer is written, where its machine never said, so a grant it leaves is one a retry can take.
        .set({
          decision,
          note,
          lapsedAt: sql`coalesce(${machineCommandAsk.lapsedAt}, case when ${machineCommandAsk.expiresAt} < ${lateBefore}::timestamptz then ${now}::timestamptz end)`,
        })
        .where(
          and(
            eq(machineCommandAsk.id, id),
            eq(machineCommandAsk.userId, userId),
            isNull(machineCommandAsk.decision),
          ),
        )
        .returning({
          decision: machineCommandAsk.decision,
          note: machineCommandAsk.note,
          deviceId: machineCommandAsk.deviceId,
          agentId: machineCommandAsk.agentId,
          subject: machineCommandAsk.subject,
          late: sql<boolean>`${machineCommandAsk.lapsedAt} is not null`,
          ...TXID_RETURNING,
        }),
    ),
});

/** Says the account's ask closed, where no answer stands on it yet; the rows it said so of. */
const writeLapse = SqlSchema.findAll({
  Request: Schema.Struct({ ...AskKeySchema.fields, now: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, now }) =>
    Database.use((db) =>
      db
        .update(machineCommandAsk)
        .set({ lapsedAt: now })
        .where(
          and(
            eq(machineCommandAsk.id, id),
            eq(machineCommandAsk.userId, userId),
            isNull(machineCommandAsk.decision),
          ),
        )
        .returning({ id: machineCommandAsk.id }),
    ),
});

/** The answer standing on the account's ask, null while it waits; none where the account holds no such ask. */
const findAnswer = SqlSchema.findOneOption({
  Request: AskKeySchema,
  Result: Schema.Struct({ decision: DecisionSchema, note: Schema.NullOr(Schema.String) }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ decision: machineCommandAsk.decision, note: machineCommandAsk.note })
        .from(machineCommandAsk)
        .where(and(eq(machineCommandAsk.id, id), eq(machineCommandAsk.userId, userId))),
    ),
});

/** The answer that stood on the account's ask before its window was said closed; none for one given after, which is a grant, not this ask's answer. */
const findAnswerInTime = SqlSchema.findOneOption({
  Request: AskKeySchema,
  Result: Schema.Struct({ decision: DecisionSchema, note: Schema.NullOr(Schema.String) }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ decision: machineCommandAsk.decision, note: machineCommandAsk.note })
        .from(machineCommandAsk)
        .where(
          and(
            eq(machineCommandAsk.id, id),
            eq(machineCommandAsk.userId, userId),
            isNull(machineCommandAsk.lapsedAt),
          ),
        ),
    ),
});

/** Writes the answer a grant carried onto the new ask. */
const writeGranted = SqlSchema.void({
  Request: Schema.Struct({ ...AskKeySchema.fields, decision: machineAskDecisionSchema }),
  execute: ({ userId, id, decision }) =>
    Database.use((db) =>
      db
        .update(machineCommandAsk)
        .set({ decision })
        .where(and(eq(machineCommandAsk.id, id), eq(machineCommandAsk.userId, userId))),
    ),
});

const deleteAsk = SqlSchema.void({
  Request: AskKeySchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .delete(machineCommandAsk)
        .where(and(eq(machineCommandAsk.id, id), eq(machineCommandAsk.userId, userId))),
    ),
});

const deleteStale = SqlSchema.findAll({
  Request: Schema.Struct({ askedBefore: Schema.Date }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ askedBefore }) =>
    Database.use((db) =>
      db
        .delete(machineCommandAsk)
        .where(lt(machineCommandAsk.askedAt, askedBefore))
        .returning({ id: machineCommandAsk.id }),
    ),
});

/** An answer as a row holds it, as the wire carries it; none while the row waits. */
function standingOf(row: {
  readonly decision: MachineAskDecision | null;
  readonly note: string | null;
}): MachineAskStandingAnswer | undefined {
  if (row.decision === null) return undefined;

  return row.note === null
    ? { decision: row.decision }
    : { decision: row.decision, note: row.note };
}

/** The answer standing on the account's ask; none while it waits, or where the account holds no such ask. */
const standingAnswer = (userId: string, id: string) =>
  Effect.map(findAnswer({ userId, id }), (found) =>
    Option.isNone(found) ? undefined : standingOf(found.value),
  );

/** One ask a machine posts: the claimed command's id, the device that claimed it, what it asks, and how long its window runs from now. */
export interface PostedMachineAsk {
  readonly id: string;
  readonly deviceId: string;
  readonly subject: MachineAskSubject;
  readonly windowSeconds: number;
}

/** What a post or a window's close found: whether the ask stands, and the answer that stands on it already, where one does. */
export interface MachineAskStands {
  readonly stands: boolean;
  readonly answer?: MachineAskStandingAnswer;
}

/**
 * Posts the ask a machine shows for a command it claimed, its window
 * closing `windowSeconds` from now, on the service's clock, and answers it
 * at once where a late Allow left a grant for the same agent's ask of the
 * same on that machine, which it takes. An ask posted again answers as it
 * stands. Stands not where the account holds no such command claimed or
 * the device is not its own and standing.
 */
export function postMachineAsk(
  userId: string,
  ask: PostedMachineAsk,
): TaskStoreEffect<MachineAskStands> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;

        const [posted] = yield* insertAsk({
          userId,
          id: ask.id,
          deviceId: ask.deviceId,
          subject: ask.subject,
          now,
          expiresAt: new Date(now.getTime() + ask.windowSeconds * 1000),
        });

        if (posted === undefined) {
          const found = yield* findAnswer({ userId, id: ask.id });

          if (Option.isNone(found)) return { stands: false };
          const answer = standingOf(found.value);

          return answer === undefined ? { stands: true } : { stands: true, answer };
        }

        if (posted.agentId === null) return { stands: true };

        const taken = yield* takeGrant({
          userId,
          id: ask.id,
          deviceId: ask.deviceId,
          agentId: posted.agentId,
          subject: ask.subject,
        });

        if (taken.length === 0) return { stands: true };
        const answer = { decision: MACHINE_ASK_DECISION.ALLOW_ONCE };
        yield* writeGranted({ userId, id: ask.id, decision: answer.decision });

        return { stands: true, answer };
      }),
    ),
  );
}

/**
 * Says the account's ask closed as its machine's window ran out with no
 * answer, so an answer given after it is late; answers the answer that beat
 * it, where one did, which the machine takes as given in time.
 */
export function lapseMachineAsk(
  userId: string,
  id: string,
): TaskStoreEffect<MachineAskStandingAnswer | undefined> {
  return Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const [lapsed] = yield* writeLapse({ userId, id, now });

    if (lapsed !== undefined) return undefined;

    // Note that a close said again, as a retried request is, never answers with an answer given after the first.
    const found = yield* findAnswerInTime({ userId, id });

    return Option.isNone(found) ? undefined : standingOf(found.value);
  });
}

/**
 * The answer that stands on an ask once one was given, and the transaction
 * this one was written in; and where this answer was the first and came
 * after the ask's window closed, what it asked and the agent it was for,
 * where it names one.
 */
export interface MachineAskStanding {
  readonly answer: MachineAskStandingAnswer;
  readonly txid?: string;
  readonly late?: { readonly agentId?: string; readonly subject: MachineAskSubject };
}

/** A late Always allow written to the machine's own settings: every command run without asking, or the app used without asking. */
const allowedAlways = (userId: string, deviceId: string, subject: MachineAskSubject) =>
  changeMachine(
    userId,
    deviceId,
    "command" in subject
      ? { commandMode: MACHINE_COMMAND_MODE.ALWAYS }
      : { addApp: machineAskAppKey(subject.app) },
  );

/** An answer written as `answerMachineAsk` writes it, inside its transaction, so a late Always allow's settings stand or fall with the answer. */
const answered = (
  userId: string,
  answer: { readonly id: string; readonly decision: MachineAskDecision; readonly note?: string },
) =>
  Effect.gen(function* () {
    const now = yield* DateTime.nowAsDate;
    const note = answer.decision === MACHINE_ASK_DECISION.DENY ? (answer.note ?? null) : null;
    const lateBefore = new Date(now.getTime() - MACHINE_ASK_BOUNDS.LAPSE_GRACE_SECONDS * 1000);

    const [written] = yield* writeAnswer({
      userId,
      id: answer.id,
      decision: answer.decision,
      note,
      now,
      lateBefore,
    });

    if (written === undefined) {
      const standing = yield* standingAnswer(userId, answer.id);

      return standing === undefined ? undefined : { answer: standing };
    }

    const given = standingOf(written) ?? { decision: written.decision };

    if (!written.late) return { answer: given, txid: written.txid };

    if (written.decision === MACHINE_ASK_DECISION.ALLOW_ALWAYS) {
      yield* allowedAlways(userId, written.deviceId, written.subject);
    }

    if (written.decision !== MACHINE_ASK_DECISION.ALLOW_ONCE) {
      yield* deleteAsk({ userId, id: answer.id });
    }

    return {
      answer: given,
      txid: written.txid,
      late: {
        subject: written.subject,
        ...(written.agentId === null ? undefined : { agentId: written.agentId }),
      },
    };
  });

/**
 * Answers the account's ask, as any of its devices may: the first answer
 * written stands, and a later one is answered with it, written nowhere. A
 * note is kept only with a denial. A late Allow once stays as a grant; a
 * late Always allow is written to the machine's settings and a late Deny
 * changes nothing, and both take the ask down, since no machine waits on it.
 * Answers none where the account holds no such ask, as one taken down, or
 * another account's.
 */
export function answerMachineAsk(
  userId: string,
  answer: { readonly id: string; readonly decision: MachineAskDecision; readonly note?: string },
): TaskStoreEffect<MachineAskStanding | undefined> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(answered(userId, answer)),
  );
}

/** Takes down the account's ask, whether or not it still stood, which takes it down on every device. */
export function closeMachineAsk(userId: string, id: string): TaskStoreEffect<void> {
  return deleteAsk({ userId, id });
}

/** Takes down every ask asked longer ago than `MACHINE_ASK_BOUNDS.STANDS_SECONDS` before `now`, answering how many; the scheduled sweep runs it. */
export function pruneMachineAsks(now: number): TaskStoreEffect<number> {
  return Effect.map(
    deleteStale({ askedBefore: new Date(now - MACHINE_ASK_BOUNDS.STANDS_SECONDS * 1000) }),
    (rows) => rows.length,
  );
}
