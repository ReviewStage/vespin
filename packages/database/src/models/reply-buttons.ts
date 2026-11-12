/**
 * reply-buttons.ts -- the buttons coding agents put in their replies: make one, read one as a member may, and claim, settle, or release its one press.
 *
 * A button is read and claimed only by a member who can reach its agent's
 * task, so no account reads or presses a button of a workspace it is not in,
 * or of a task kept from it. Its press runs once: the claim writes who
 * pressed it only where no one has, or where a press that has not landed is
 * the same member's own or one whose presser's account is gone, so a
 * second press from anyone else reads the first rather than running again,
 * and the presser's retry runs again under the same key, which the start or
 * the send it runs answers once (`@repo/service`'s `reply-buttons/press.ts`).
 * Each claim is its own attempt, which alone releases it, so an attempt
 * refused after its presser's retry claimed again leaves the retry's claim
 * standing. A press that landed keeps the agent it reached, and an attempt
 * that ran lands even where a later attempt of the same member's was refused
 * and released the claim; one refused is released, so the button may be
 * pressed again.
 */

import { type ReplyButtonAction, replyButtonActionSchema } from "@repo/features/reply-button-wire";
import { and, eq, exists, isNull, or, sql } from "drizzle-orm";
import { Effect, type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { replyButtonTable as button } from "../schemas/reply-button.js";
import { task } from "../schemas/task.js";
import { taskReachableBy } from "./workspace-store.js";

type ButtonEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

const ReplyButtonSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  taskId: Schema.String,
  organizationId: Schema.String,
  label: Schema.String,
  action: replyButtonActionSchema,
  pressedBy: Schema.NullOr(Schema.String),
  pressedAt: Schema.NullOr(Schema.Date),
  landedAt: Schema.NullOr(Schema.Date),
  reachedAgentId: Schema.NullOr(Schema.String),
});

/** A button as a member reads it: the agent that made it, that agent's task and workspace, its label, what it does, and how its press stands. */
export type ReplyButton = typeof ReplyButtonSchema.Type;

const findButton = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, buttonId: Schema.String }),
  Result: ReplyButtonSchema,
  execute: ({ userId, buttonId }) =>
    Database.use((db) =>
      db
        .select({
          id: button.id,
          agentId: button.agentId,
          taskId: agentTable.taskId,
          organizationId: agentTable.organizationId,
          label: button.label,
          action: button.action,
          pressedBy: button.pressedBy,
          pressedAt: button.pressedAt,
          landedAt: button.landedAt,
          reachedAgentId: button.reachedAgentId,
        })
        .from(button)
        .innerJoin(agentTable, eq(agentTable.id, button.agentId))
        .innerJoin(task, eq(task.id, agentTable.taskId))
        .where(and(eq(button.id, buttonId), taskReachableBy(userId))),
    ),
});

const insertButton = SqlSchema.findOne({
  Request: Schema.Struct({
    agentId: Schema.String,
    label: Schema.String,
    action: replyButtonActionSchema,
    now: Schema.Date,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ agentId, label, action, now }) =>
    Database.use((db) =>
      db
        .insert(button)
        .values({ agentId, label, action, createdAt: now })
        .returning({ id: button.id }),
    ),
});

const PressSchema = Schema.Struct({ buttonId: Schema.String, userId: Schema.String });

const claimPress = SqlSchema.findAll({
  Request: Schema.Struct({ ...PressSchema.fields, now: Schema.Date }),
  Result: Schema.Struct({ attempt: Schema.String }),
  execute: ({ buttonId, userId, now }) =>
    Database.use((db) =>
      db
        .update(button)
        .set({ pressedBy: userId, pressedAt: now, pressAttempt: sql`gen_random_uuid()` })
        .where(
          and(
            eq(button.id, buttonId),
            isNull(button.landedAt),
            or(
              isNull(button.pressedAt),
              or(eq(button.pressedBy, userId), isNull(button.pressedBy)),
            ),
            // Note that a member presses only a button whose agent's task they reach, as they read one.
            exists(
              db
                .select({ id: agentTable.id })
                .from(agentTable)
                .innerJoin(task, eq(task.id, agentTable.taskId))
                .where(and(eq(agentTable.id, button.agentId), taskReachableBy(userId))),
            ),
          ),
        )
        .returning({ attempt: sql<string>`${button.pressAttempt}::text` }),
    ),
});

const settlePress = SqlSchema.void({
  Request: Schema.Struct({
    ...PressSchema.fields,
    reachedAgentId: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ buttonId, userId, reachedAgentId, now }) =>
    Database.use((db) =>
      db
        .update(button)
        .set({
          pressedBy: userId,
          pressedAt: sql`coalesce(${button.pressedAt}, ${now})`,
          reachedAgentId,
          landedAt: now,
        })
        .where(
          and(
            eq(button.id, buttonId),
            // Note that a press landed is kept as it landed, so a late settle of the same press changes nothing.
            isNull(button.landedAt),
            // Note that a claim a later attempt of the member's released still lands, since this attempt ran.
            or(eq(button.pressedBy, userId), isNull(button.pressedBy)),
          ),
        ),
    ),
});

const releasePress = SqlSchema.void({
  Request: Schema.Struct({ buttonId: Schema.String, attempt: Schema.String }),
  execute: ({ buttonId, attempt }) =>
    Database.use((db) =>
      db
        .update(button)
        .set({ pressedBy: null, pressedAt: null, pressAttempt: null })
        .where(
          and(
            eq(button.id, buttonId),
            // Note that only the attempt holding the claim releases it, never one a retry has claimed past.
            eq(button.pressAttempt, attempt),
            // A press that landed is never released, whatever its presser's later retry met.
            isNull(button.landedAt),
          ),
        ),
    ),
});

/** A button the agent made in its reply, labeled and doing what it was made to do; answers its id. */
export function makeReplyButton(
  agentId: string,
  label: string,
  action: ReplyButtonAction,
  now: Date,
): ButtonEffect<string> {
  return insertButton({ agentId, label, action, now }).pipe(
    Effect.map((row) => row.id),
    // Note that an insert answers the row it wrote, so one answering none is a defect, never a refusal.
    Effect.catchTag("NoSuchElementError", (missing) => Effect.die(missing)),
  );
}

/** The button under this id, where the member can reach its agent's task; any other reads as none. */
export function readReplyButton(
  userId: string,
  buttonId: string,
): ButtonEffect<Option.Option<ReplyButton>> {
  return findButton({ userId, buttonId });
}

/**
 * The button's press claimed for the member, where they reach its agent's
 * task, answering the attempt that holds the claim: where no one had
 * pressed it, where the member's own earlier press has not landed, which
 * runs again under the same key, or where one that has not landed is of an
 * account since gone; none where another member's press stands, any press
 * landed, or the member reaches no such button.
 */
export function claimReplyButtonPress(
  buttonId: string,
  userId: string,
  now: Date,
): ButtonEffect<string | undefined> {
  return Effect.map(claimPress({ buttonId, userId, now }), (rows) => rows[0]?.attempt);
}

/** The member's press settled on the agent it started or sent to, landed for good, where it has not landed and no other member's press holds it. */
export function settleReplyButtonPress(
  buttonId: string,
  userId: string,
  reachedAgentId: string,
  now: Date,
): ButtonEffect<void> {
  return settlePress({ buttonId, userId, reachedAgentId, now });
}

/** The attempt's claim released where it still holds it and the press never landed, so the button may be pressed again. */
export function releaseReplyButtonPress(buttonId: string, attempt: string): ButtonEffect<void> {
  return releasePress({ buttonId, attempt });
}
