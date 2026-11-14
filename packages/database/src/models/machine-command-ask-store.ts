import {
  MACHINE_ASK_BOUNDS,
  MACHINE_ASK_DECISION,
  MACHINE_ASK_KIND,
  type MachineAskDecision,
  type MachineAskKind,
  type MachineAskSubject,
  machineAskDecisionSchema,
} from "@repo/features/machine-ask-wire";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { TXID_RETURNING, TxidRowSchema } from "../core/txid.js";
import { device } from "../schemas/device.js";
import { machineCommand } from "../schemas/machine-command.js";
import { machineCommandAsk } from "../schemas/machine-command-ask.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * machine-command-ask-store.ts -- the asks an account's machines hold for its answer: posted by the machine, answered once from any of its devices, and taken down.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account posts, answers, or takes down another's asks, and
 * the account's read of them (`packages/service/src/live/reads/machine-asks.ts`)
 * reads its own alone. A machine posts an ask only for a command of its
 * account's it claimed, as a device of that account, so no ask stands for a
 * command it does not hold. The first answer written stands: the update
 * that writes one takes only an ask still waiting, so of two answers given
 * at once the database keeps one, and the other is answered with it.
 */

const AskKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

/** One ask as its machine posts it, flattened onto the row's columns. */
const PostedRowSchema = Schema.Struct({
  ...AskKeySchema.fields,
  deviceId: Schema.String,
  kind: Schema.Literals(Object.values(MACHINE_ASK_KIND)),
  command: Schema.NullOr(Schema.String),
  appName: Schema.NullOr(Schema.String),
  appBundleId: Schema.NullOr(Schema.String),
  appIconPng: Schema.NullOr(Schema.String),
  now: Schema.Date,
  expiresAt: Schema.Date,
});

/**
 * Writes the ask, where the account holds the command claimed and the
 * device is the account's and not removed, and the command was queued for
 * that device or for none; the agent is the command's. An ask posted again
 * under its id writes nothing.
 */
const insertAsk = SqlSchema.findAll({
  Request: PostedRowSchema,
  Result: TxidRowSchema,
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
              kind: sql<MachineAskKind>`${row.kind}`.as("kind"),
              command: sql<string | null>`${row.command}::text`.as("command"),
              appName: sql<string | null>`${row.appName}::text`.as("app_name"),
              appBundleId: sql<string | null>`${row.appBundleId}::text`.as("app_bundle_id"),
              appIconPng: sql<string | null>`${row.appIconPng}::text`.as("app_icon_png"),
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
        .returning(TXID_RETURNING),
    ),
});

/** The answer that stands on an ask. */
const StandingSchema = Schema.Struct({
  decision: machineAskDecisionSchema,
  note: Schema.NullOr(Schema.String),
});

/** Writes the answer on the account's ask, where none stands yet; the answer written and its transaction, or none. */
const writeAnswer = SqlSchema.findAll({
  Request: Schema.Struct({
    ...AskKeySchema.fields,
    decision: machineAskDecisionSchema,
    note: Schema.NullOr(Schema.String),
  }),
  Result: Schema.Struct({ ...StandingSchema.fields, txid: Schema.String }),
  execute: ({ userId, id, decision, note }) =>
    Database.use((db) =>
      db
        .update(machineCommandAsk)
        .set({ decision, note })
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
          ...TXID_RETURNING,
        }),
    ),
});

/** The answer standing on the account's ask, null while it waits; none where the account holds no such ask. */
const findAnswer = SqlSchema.findOneOption({
  Request: AskKeySchema,
  Result: Schema.Struct({
    decision: Schema.NullOr(machineAskDecisionSchema),
    note: Schema.NullOr(Schema.String),
  }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ decision: machineCommandAsk.decision, note: machineCommandAsk.note })
        .from(machineCommandAsk)
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

/** An ask's subject flattened onto the row's columns. */
function columnsOf(subject: MachineAskSubject) {
  if ("command" in subject) {
    return {
      kind: MACHINE_ASK_KIND.SHELL,
      command: subject.command,
      appName: null,
      appBundleId: null,
      appIconPng: null,
    };
  }

  return {
    kind: MACHINE_ASK_KIND.APP,
    command: null,
    appName: subject.app.name,
    appBundleId: subject.app.bundleId ?? null,
    appIconPng: subject.app.iconPng ?? null,
  };
}

/** One ask a machine posts: the claimed command's id, the device that claimed it, what it asks, and how long its window runs from now. */
export interface PostedMachineAsk {
  readonly id: string;
  readonly deviceId: string;
  readonly subject: MachineAskSubject;
  readonly windowSeconds: number;
}

/**
 * Posts the ask a machine shows for a command it claimed, its window
 * closing `windowSeconds` from now, on the service's clock; answers the
 * transaction it stands in, or none where the account holds no such
 * command claimed or the device is not its own and standing.
 */
export function postMachineAsk(
  userId: string,
  ask: PostedMachineAsk,
): TaskStoreEffect<string | undefined> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      insertAsk({
        userId,
        id: ask.id,
        deviceId: ask.deviceId,
        ...columnsOf(ask.subject),
        now,
        expiresAt: new Date(now.getTime() + ask.windowSeconds * 1000),
      }),
      ([posted]) => posted?.txid,
    ),
  );
}

/** The answer that stands on an ask once one was given: the decision, a denial's words, whether it was this answer, and the transaction this one was written in. */
export interface MachineAskStanding {
  readonly decision: MachineAskDecision;
  readonly note?: string;
  readonly first: boolean;
  readonly txid?: string;
}

/**
 * Answers the account's ask, as any of its devices may: the first answer
 * written stands, and a later one is answered with it, written nowhere. A
 * note is kept only with a denial. Answers none where the account holds no
 * such ask, as one taken down, or another account's.
 */
export function answerMachineAsk(
  userId: string,
  answer: { readonly id: string; readonly decision: MachineAskDecision; readonly note?: string },
): TaskStoreEffect<MachineAskStanding | undefined> {
  return Effect.gen(function* () {
    const note = answer.decision === MACHINE_ASK_DECISION.DENY ? (answer.note ?? null) : null;

    const [written] = yield* writeAnswer({
      userId,
      id: answer.id,
      decision: answer.decision,
      note,
    });

    if (written !== undefined) {
      return {
        decision: written.decision,
        ...(written.note === null ? undefined : { note: written.note }),
        first: true,
        txid: written.txid,
      };
    }

    const standing = Option.getOrUndefined(yield* findAnswer({ userId, id: answer.id }));

    if (standing === undefined || standing.decision === null) return undefined;

    return {
      decision: standing.decision,
      ...(standing.note === null ? undefined : { note: standing.note }),
      first: false,
    };
  });
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
