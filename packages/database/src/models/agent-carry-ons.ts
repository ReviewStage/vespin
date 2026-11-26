/**
 * agent-carry-ons.ts -- how many carry-ons a coding agent answered nothing after, which caps how often a cut-off turn is carried on.
 *
 * A turn cut off by its runner going away is carried on by a line the
 * service sends the agent on the `carry_on` channel (`@repo/service`'s
 * `agents/coder-host/carry-on.ts`), and only while few such lines stand
 * since the agent last answered: since the newest message one of its turns
 * wrote, which a turn writes only once it reports its first part
 * (`writer.ts`'s journal), so a runner that dies before it says anything
 * answers nothing. A withdrawn line, which no turn took and whose hand-over
 * failed, counts for nothing.
 */

import { MESSAGE_CHANNEL, MESSAGE_ROLE } from "@repo/wire";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { messages } from "../schemas/storage.js";
import type { ConversationTarget } from "./writer.js";

/** The agent's own messages, read beside the carry-on lines they answer. */
const answers = alias(messages, "answers");

/** The channel a line says carried it. */
const LINE_CHANNEL = sql<string | null>`${messages.metadata} ->> 'channel'`;

const countUnanswered = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ count: Schema.Number }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) => {
      // The newest message one of the agent's turns wrote; none reads as before every line.
      const answered = db
        .select({ seq: sql<number>`coalesce(max(${answers.seq}), -1)` })
        .from(answers)
        .where(
          and(
            eq(answers.conversationId, conversationId),
            eq(answers.role, MESSAGE_ROLE.ASSISTANT),
            isNotNull(answers.turnId),
          ),
        );

      return db
        .select({ count: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          and(
            eq(messages.userId, userId),
            eq(messages.conversationId, conversationId),
            eq(messages.role, MESSAGE_ROLE.USER),
            eq(LINE_CHANNEL, MESSAGE_CHANNEL.CARRY_ON),
            isNull(messages.withdrawnAt),
            sql`${messages.seq} > (${answered})`,
          ),
        );
    }),
});

/** How many carry-on lines stand in the agent's conversation since the agent last answered, as the header says. */
export function carryOnsUnanswered(
  target: ConversationTarget,
): Effect.Effect<number, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.map(countUnanswered(target), (row) =>
    Option.match(row, { onNone: () => 0, onSome: ({ count }) => count }),
  );
}
