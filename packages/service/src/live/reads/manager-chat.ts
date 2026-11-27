/**
 * manager-chat.ts -- one page of a Manager's chat, bound: its statement, the tables it reads, the topics that wake it, and who it admits.
 *
 * The statement reads what `readManagerChatPage` reads for one page, one
 * row past it: the messages of the chat of a Manager the account reaches
 * (`agentReachableBy`), newest first, before the `seq` the read names where
 * it names one. The account's membership of the Manager's workspace is
 * joined, so a member taken out of the workspace stops hearing the chat at
 * once rather than at the next seal. Each message carries its reactions as
 * lists of one length, each kind given, 👍 and 👎 first and the rest as
 * first given, how many gave it, whether the account did, and its emoji. It reads no clock, as a live read must
 * (`live-statement.ts`).
 *
 * It is woken by a message written, edited, or deleted, a reaction given
 * or taken off, and by the Manager's own row, all of which name the agent, and by the account's
 * membership, which names the account.
 */

import { queryBuilder } from "@repo/database/core/query";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import { agentReachableBy } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { member } from "@repo/database/schemas/auth";
import { managerChatMessage } from "@repo/database/schemas/manager-chat-message";
import { managerChatReaction } from "@repo/database/schemas/manager-chat-reaction";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  managerChatMessageSync,
  managerChatReactionSync,
  memberSync,
} from "@repo/database/sync/tables";
import { AGENT_KIND } from "@repo/features/agent-wire";
import {
  MANAGER_CHAT_PAGE,
  MANAGER_CHAT_REACTION,
  MANAGER_CHAT_READ,
  type ManagerChatAttachment,
} from "@repo/features/manager-chat-live";
import { and, desc, eq, lt, type SQL, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement, ownOrder } from "../live-read-binding.js";

/** A `seq` as its query spells it: a whole number, which the chat's identity never passes the safe range of. */
const SEQ = /^\d{1,15}$/u;

/** The condition the page stands before: none where the read names no `before`, the messages older than it where it spells a `seq`, and none at all where it spells something else. */
function beforeOf(before: string): SQL | undefined {
  if (before === "") return undefined;

  return SEQ.test(before) ? lt(managerChatMessage.seq, Number(before)) : sql`false`;
}

/** The kinds of reaction offered first, in the order a message carries them first, written into the statement as SQL, which an order takes no array parameter for. */
const REACTION_ORDER = sql`array[${sql.join(
  Object.values(MANAGER_CHAT_REACTION).map((kind) => sql.raw(`'${kind}'`)),
  sql`, `,
)}]`;

/** The lists a message's reactions are delivered in, by the column of its grouped read each takes. */
const REACTION_LIST = {
  KINDS: "kind",
  COUNTS: "count",
  REACTED: "reacted",
  EMOJI: "emoji",
} as const;

/**
 * One list of the message's reactions, a kind's `field` at each place:
 * the kinds given, how many gave each, whether the account did, or each
 * kind's emoji, each in `withReaction`'s order, 👍 and 👎 first in
 * `REACTION_ORDER` and every other kind after them as it was first given,
 * so the lists line up; none given is an empty
 * list. Note that each is an `array(...)` of a grouped read rather than a
 * JSON aggregate, which Postgres marks only stable.
 */
function reactionListOf<Value>(
  userId: string,
  field: (typeof REACTION_LIST)[keyof typeof REACTION_LIST],
) {
  return sql<Value[]>`array(
    select ${sql.identifier(field)}
    from (
      select
        ${managerChatReaction.kind} as kind,
        count(*)::int as count,
        coalesce(bool_or(${managerChatReaction.reactorUserId} = ${userId}), false) as reacted,
        coalesce(min(${managerChatReaction.emoji}), '') as emoji,
        min(${managerChatReaction.createdAt}) as given_at
      from ${managerChatReaction}
      where ${managerChatReaction.agentId} = ${managerChatMessage.agentId}
        and ${managerChatReaction.messageId} = ${managerChatMessage.id}
      group by ${managerChatReaction.kind}
    ) as given
    order by array_position(${REACTION_ORDER}, given.kind), given.given_at, given.kind
  )`;
}

/** The page's messages, one past the page, as `readManagerChatPage` reads them, each with its reactions. */
function messagesStatement(userId: string, agentId: string, before: string) {
  return liveRowsStatement(
    MANAGER_CHAT_READ.parts.messages,
    {
      ordered: false,
      columns: {
        id: managerChatMessage.id,
        // Note that `seq` is a `bigint`, which Postgres answers as text, so it is read as a number.
        seq: sql<number>`(${managerChatMessage.seq})::float8`,
        clientKey: managerChatMessage.clientKey,
        authorKind: managerChatMessage.authorKind,
        authorUserId: managerChatMessage.authorUserId,
        authorName: managerChatMessage.authorName,
        text: managerChatMessage.text,
        attachments: sql<readonly ManagerChatAttachment[]>`${managerChatMessage.attachments}`,
        threadRoot: managerChatMessage.threadRoot,
        broadcast: managerChatMessage.broadcast,
        turnId: sql<string | null>`${managerChatMessage.turnId}`,
        lineId: sql<string | null>`${managerChatMessage.lineId}`,
        reactionKinds: reactionListOf<string>(userId, REACTION_LIST.KINDS),
        reactionCounts: reactionListOf<number>(userId, REACTION_LIST.COUNTS),
        reactionsReacted: reactionListOf<boolean>(userId, REACTION_LIST.REACTED),
        reactionEmoji: reactionListOf<string>(userId, REACTION_LIST.EMOJI),
      },
      instants: { createdAt: managerChatMessage.createdAt, editedAt: managerChatMessage.editedAt },
    },
    (selection) =>
      ownOrder(
        queryBuilder
          .select(selection)
          .from(managerChatMessage)
          .innerJoin(agentTable, eq(agentTable.id, managerChatMessage.agentId))
          .innerJoin(
            member,
            and(eq(member.organizationId, agentTable.organizationId), eq(member.userId, userId)),
          )
          .where(
            and(
              eq(managerChatMessage.agentId, agentId),
              eq(agentTable.kind, AGENT_KIND.MANAGER),
              agentReachableBy(userId),
              beforeOf(before),
            ),
          )
          // Note that the page is taken by an order of its own, which the reader's declared order matches, and one row past it says an older page stands.
          .orderBy(desc(managerChatMessage.seq))
          .limit(MANAGER_CHAT_PAGE + 1),
      ),
  );
}

export const managerChatRead = bindLiveRead(MANAGER_CHAT_READ, {
  reads: [
    managerChatMessageSync,
    managerChatReactionSync,
    agentSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, id }) => [
    [TOPIC.AGENT, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id, before }) => ({ messages: messagesStatement(userId, id, before) }),
  admit: ({ userId, id }) =>
    Effect.flatMap(hostedStoreOrUnavailable(readVisibleAgent(userId, id)), (agent) =>
      Option.isSome(agent) && agent.value.kind === AGENT_KIND.MANAGER
        ? Effect.void
        : Effect.fail(HOSTED_REFUSAL.NOT_FOUND),
    ),
});
