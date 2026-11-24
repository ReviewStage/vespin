import { MESSAGE_ROLE } from "@repo/wire";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { member } from "../schemas/auth.js";
import { conversations, messages, turns } from "../schemas/storage.js";
import { MESSAGE_SENDER } from "../storage-vocabulary.js";
import type { ConversationTarget } from "./writer.js";

/**
 * turn-asker.ts -- who asked for an agent's turn under way: the member whose line opened it, its starter standing in.
 *
 * The asker is read from the rows alone, never from what a model says: the
 * first of the developer's lines the agent's newest started turn took, read
 * through a worker's conversation to the agent it was delegated from, where
 * a member sent it (`messages.sender_user_id`) and is still a member of the
 * agent's workspace. A turn an automation, an agent, GitHub, or the app
 * opened, a line from before lines named their sender, and a member who
 * since left the workspace have no asker, so the agent's starter, its
 * owner, stands in. Every place that acts for whoever asked reads this one
 * read, so "who asked" means one thing everywhere.
 */

/** The conversation a worker was delegated from, through which its own agent is read. */
const parent = alias(conversations, "parent");

/** The line that opened the agent's turn under way. */
const opener = alias(messages, "opener");

const findAsker = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({ starter: Schema.String, asker: Schema.NullOr(Schema.String) }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) => {
      const newestTurn = db
        .select({ id: turns.id })
        .from(turns)
        .where(and(eq(turns.conversationId, agentTable.conversationId), isNotNull(turns.startedAt)))
        .orderBy(desc(turns.startedAt), desc(turns.queuedAt))
        .limit(1);

      const openingLine = db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, agentTable.conversationId),
            eq(messages.turnId, sql`(${newestTurn})`),
            eq(messages.role, MESSAGE_ROLE.USER),
          ),
        )
        .orderBy(asc(messages.seq))
        .limit(1);

      return (
        db
          .select({ starter: agentTable.userId, asker: member.userId })
          .from(conversations)
          .leftJoin(parent, eq(parent.id, conversations.parentConversationId))
          .innerJoin(
            agentTable,
            eq(agentTable.conversationId, sql`coalesce(${parent.id}, ${conversations.id})`),
          )
          .leftJoin(opener, eq(opener.id, sql`(${openingLine})`))
          // Note that a former member asks nothing, so their line hands the turn to the starter rather than to an account outside the workspace.
          .leftJoin(
            member,
            and(
              eq(opener.sender, MESSAGE_SENDER.MEMBER),
              eq(member.userId, opener.senderUserId),
              eq(member.organizationId, agentTable.organizationId),
            ),
          )
          .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
          .limit(1)
      );
    }),
});

/**
 * Who asked for the turn under way in the conversation given, as the module
 * says: the member whose line opened it, else the agent's starter; the
 * conversation's own account where it is no agent's.
 */
export function turnAsker(
  target: ConversationTarget,
): Effect.Effect<string, StoreFailure, DatabaseServices> {
  return Effect.map(
    findAsker(target),
    Option.match({
      onNone: () => target.userId,
      onSome: ({ starter, asker }) => asker ?? starter,
    }),
  );
}
