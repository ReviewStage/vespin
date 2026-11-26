/**
 * manager-chat-reactions.ts -- the reactions on a Manager's chat: give one to a message or take it off, as a member or as the Manager, and read who gave each.
 *
 * Every read and write is made as an account that reaches the Manager
 * (`agentReachableBy`), a Manager standing on no task, as the chat's own
 * messages are (`manager-chat-messages.ts`), so no account reads or reacts
 * on another's chat. A member reacts as their own account and no other;
 * the Manager reacts as itself, through its starter's account, which
 * reaches its chat. A reaction is given or taken off as the caller asks
 * rather than flipped, so one sent again lands as the first did. The
 * message is held for the write, so a rewind deleting it waits for the
 * write rather than failing it.
 */

import { AGENT_KIND } from "@repo/features/agent-wire";
import {
  MANAGER_CHAT_AUTHOR,
  MANAGER_CHAT_REACTION,
  type ManagerChatAuthor,
  type ManagerChatReaction,
} from "@repo/features/manager-chat-live";
import { and, asc, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { user } from "../schemas/auth.js";
import { managerChatMessage } from "../schemas/manager-chat-message.js";
import { managerChatReaction } from "../schemas/manager-chat-reaction.js";
import type { AgentStoreEffect } from "./agent-store.js";
import { agentReachableBy } from "./workspace-store.js";

/** What a reaction's write came to: done, saying whether it changed what stood, or no message of a Manager's chat the account reaches under the id. */
export const MANAGER_CHAT_REACTION_OUTCOME = {
  DONE: "done",
  NO_MESSAGE: "no-message",
} as const;

/** A reaction to give a message of a Manager's chat, or take off it: whose chat and which message, who gives it, a member as the account or the Manager, its kind, and whether it stands after. */
export interface ManagerChatReactionWrite {
  readonly agentId: string;
  readonly messageId: string;
  readonly by: ManagerChatAuthor;
  readonly kind: ManagerChatReaction;
  readonly reacted: boolean;
  readonly now: Date;
}

export type ManagerChatReactionOutcome =
  | { readonly status: typeof MANAGER_CHAT_REACTION_OUTCOME.DONE; readonly changed: boolean }
  | { readonly status: typeof MANAGER_CHAT_REACTION_OUTCOME.NO_MESSAGE };

const ManagerChatReactionGivenSchema = Schema.Struct({
  messageId: Schema.String,
  kind: Schema.Literals(Object.values(MANAGER_CHAT_REACTION)),
  reactorKind: Schema.Literals(Object.values(MANAGER_CHAT_AUTHOR)),
  reactorUserId: Schema.NullOr(Schema.String),
  /** The member's name as their account holds it now; null for the Manager's own. */
  reactorName: Schema.NullOr(Schema.String),
});

/** One reaction given a message, and who gave it. */
export type ManagerChatReactionGiven = typeof ManagerChatReactionGivenSchema.Type;

const MessageKeySchema = Schema.Struct({
  userId: Schema.String,
  agentId: Schema.String,
  messageId: Schema.String,
});

const ReactionKeySchema = Schema.Struct({
  agentId: Schema.String,
  messageId: Schema.String,
  kind: Schema.Literals(Object.values(MANAGER_CHAT_REACTION)),
  reactorUserId: Schema.NullOr(Schema.String),
});

/** The condition that the Manager's row is one the account reaches. */
function reachedManager(userId: string, agentId: string, ...rest: (SQL | undefined)[]) {
  return and(
    eq(agentTable.id, agentId),
    eq(agentTable.kind, AGENT_KIND.MANAGER),
    agentReachableBy(userId),
    ...rest,
  );
}

/** The message of the Manager's chat under the id, held against its delete until the write commits, as the account reaches the chat; none where it does not, or no message holds the id. */
const holdMessage = SqlSchema.findAll({
  Request: MessageKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId, messageId }) =>
    Database.use((db) =>
      db
        .select({ id: managerChatMessage.id })
        .from(managerChatMessage)
        .innerJoin(agentTable, eq(agentTable.id, managerChatMessage.agentId))
        .where(
          reachedManager(
            userId,
            agentId,
            eq(managerChatMessage.agentId, agentId),
            eq(managerChatMessage.id, messageId),
          ),
        )
        .limit(1)
        .for("key share", { of: managerChatMessage }),
    ),
});

const insertReaction = SqlSchema.findAll({
  Request: Schema.Struct({
    ...ReactionKeySchema.fields,
    reactorKind: Schema.Literals(Object.values(MANAGER_CHAT_AUTHOR)),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ messageId: Schema.String }),
  execute: ({ now, ...row }) =>
    Database.use((db) =>
      db
        .insert(managerChatReaction)
        .values({ ...row, createdAt: now })
        .onConflictDoNothing()
        .returning({ messageId: managerChatReaction.messageId }),
    ),
});

const deleteReaction = SqlSchema.findAll({
  Request: ReactionKeySchema,
  Result: Schema.Struct({ messageId: Schema.String }),
  execute: ({ agentId, messageId, kind, reactorUserId }) =>
    Database.use((db) =>
      db
        .delete(managerChatReaction)
        .where(
          and(
            eq(managerChatReaction.agentId, agentId),
            eq(managerChatReaction.messageId, messageId),
            eq(managerChatReaction.kind, kind),
            reactorUserId === null
              ? isNull(managerChatReaction.reactorUserId)
              : eq(managerChatReaction.reactorUserId, reactorUserId),
          ),
        )
        .returning({ messageId: managerChatReaction.messageId }),
    ),
});

const findReactions = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    messageIds: Schema.Array(Schema.String),
  }),
  Result: ManagerChatReactionGivenSchema,
  execute: ({ userId, agentId, messageIds }) =>
    Database.use((db) =>
      db
        .select({
          messageId: managerChatReaction.messageId,
          kind: managerChatReaction.kind,
          reactorKind: managerChatReaction.reactorKind,
          reactorUserId: managerChatReaction.reactorUserId,
          reactorName: user.name,
        })
        .from(managerChatReaction)
        .innerJoin(agentTable, eq(agentTable.id, managerChatReaction.agentId))
        .leftJoin(user, eq(user.id, managerChatReaction.reactorUserId))
        .where(
          reachedManager(
            userId,
            agentId,
            eq(managerChatReaction.agentId, agentId),
            inArray(managerChatReaction.messageId, [...messageIds]),
          ),
        )
        .orderBy(asc(managerChatReaction.createdAt)),
    ),
});

/**
 * The reaction given the message of the Manager's chat, or taken off it,
 * as the account reaches the chat: a member's as the account itself, the
 * Manager's as the Manager. Answers whether it changed what stood, so a
 * reaction given twice, or taken off one never given, changes nothing.
 */
export function reactManagerChat(
  userId: string,
  write: ManagerChatReactionWrite,
): AgentStoreEffect<ManagerChatReactionOutcome> {
  const { agentId, messageId, by, kind, reacted, now } = write;

  const key = {
    agentId,
    messageId,
    kind,
    reactorUserId: by === MANAGER_CHAT_AUTHOR.PERSON ? userId : null,
  };

  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const [held] = yield* holdMessage({ userId, agentId, messageId });

        if (held === undefined)
          return { status: MANAGER_CHAT_REACTION_OUTCOME.NO_MESSAGE } as const;

        const written = reacted
          ? yield* insertReaction({ ...key, reactorKind: by, now })
          : yield* deleteReaction(key);

        return { status: MANAGER_CHAT_REACTION_OUTCOME.DONE, changed: written.length > 0 } as const;
      }),
    ),
  );
}

/** The reactions given each of these messages of the Manager's chat, by message, the first given first, as the account reaches the chat; a message given none is absent. */
export function readManagerChatReactions(
  userId: string,
  agentId: string,
  messageIds: readonly string[],
): AgentStoreEffect<ReadonlyMap<string, readonly ManagerChatReactionGiven[]>> {
  if (messageIds.length === 0) return Effect.succeed(new Map());

  return Effect.map(findReactions({ userId, agentId, messageIds }), (rows) => {
    const byMessage = new Map<string, ManagerChatReactionGiven[]>();

    for (const row of rows) {
      const given = byMessage.get(row.messageId) ?? [];
      given.push(row);
      byMessage.set(row.messageId, given);
    }

    return byMessage;
  });
}
