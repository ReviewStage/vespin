/**
 * manager-chat-messages.ts -- a Manager's chat: write a message, grow a call's line in place, read one by its id, its key, or its line, a page of the chat, a thread, or what matches words, and delete what a rewind dropped.
 *
 * Every read and write is made as an account that reaches the Manager
 * (`agentReachableBy`), a Manager standing on no task, so no account reads
 * or writes another's chat; a chat is a Manager's alone, so an agent of any
 * other kind keeps none. A write takes the Manager's row's lock first, so
 * the chat's `seq` stands in the order its writes committed, and a reader
 * paging past the newest it read misses none. A write is keyed by its
 * client key: one sent again answers the message the first landed as. Its
 * id is the caller's, which a clash with another message's id refuses, for
 * the caller to write again under the next. A reply names a message of the
 * chat, kept as that message's thread root, so a reply to a reply stands in
 * the same thread.
 *
 * A line of a voice call is written once under its key and grown in place
 * after, as more of its words arrive (`growManagerChatLine`): the words
 * given are the line's whole words as they now stand, so a record that
 * arrives after a later one of the same line, its words a start of those
 * standing, is a repeat, and the line is never cut back.
 */

import { createHash } from "node:crypto";
import { AGENT_KIND } from "@repo/features/agent-wire";
import {
  MANAGER_CHAT_AUTHOR,
  type ManagerChatAttachment,
  managerChatAttachmentSchema,
} from "@repo/features/manager-chat-live";
import { agentName } from "@repo/features/model-label";
import { and, asc, desc, eq, exists, inArray, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { user } from "../schemas/auth.js";
import { managerChatMessage } from "../schemas/manager-chat-message.js";
import { agentAutomationNameSql } from "./agent-name.js";
import { type AgentStoreEffect, containing } from "./agent-store.js";
import { InstantColumnSchema } from "./columns.js";
import { agentReachableBy } from "./workspace-store.js";

/** What a write to a Manager's chat came to: done, with the message it landed as, or no Manager's chat the account reaches, no message of it to reply to, or an id another message holds. */
export const MANAGER_CHAT_OUTCOME = {
  DONE: "done",
  NO_CHAT: "no-chat",
  NO_THREAD: "no-thread",
  ID_TAKEN: "id-taken",
} as const;

/** How many hex digits a message's id holds: few enough for the model to repeat, enough that a chat's messages seldom share one. */
const MESSAGE_ID_DIGITS = 8;

const ManagerChatMessageSchema = Schema.Struct({
  id: Schema.String,
  seq: Schema.Number,
  authorKind: Schema.Literals(Object.values(MANAGER_CHAT_AUTHOR)),
  authorUserId: Schema.NullOr(Schema.String),
  authorName: Schema.String,
  text: Schema.String,
  attachments: Schema.Array(managerChatAttachmentSchema),
  threadRoot: Schema.NullOr(Schema.String),
  broadcast: Schema.Boolean,
  turnId: Schema.NullOr(Schema.String),
  lineId: Schema.NullOr(Schema.String),
  createdAt: InstantColumnSchema,
  editedAt: Schema.NullOr(InstantColumnSchema),
});

/** One message of a Manager's chat, as a read answers it. */
export type ManagerChatMessage = typeof ManagerChatMessageSchema.Type;

/** A message to write to a Manager's chat: its id and key, who wrote it, what it says, the message it replies to, and the turn and line it stands with. */
export interface ManagerChatWrite {
  readonly agentId: string;
  readonly id: string;
  readonly clientKey: string;
  readonly authorKind: ManagerChatMessage["authorKind"];
  readonly authorUserId: string | null;
  readonly authorName: string;
  readonly text: string;
  readonly attachments: readonly ManagerChatAttachment[];
  /** The message it replies to, a root or a reply; null for a message of the chat itself. */
  readonly inReplyTo: string | null;
  readonly broadcast: boolean;
  readonly turnId: string | null;
  readonly lineId: string | null;
  readonly now: Date;
}

export type ManagerChatOutcome =
  | {
      readonly status: typeof MANAGER_CHAT_OUTCOME.DONE;
      readonly message: ManagerChatMessage;
      /** Set where the write was a retry of one under the same key, which wrote nothing this time. */
      readonly repeated?: true;
    }
  | { readonly status: typeof MANAGER_CHAT_OUTCOME.NO_CHAT }
  | { readonly status: typeof MANAGER_CHAT_OUTCOME.NO_THREAD }
  | { readonly status: typeof MANAGER_CHAT_OUTCOME.ID_TAKEN };

/** A line of a voice call to write to the chat of the Manager whose conversation it was said in, or to grow there: its key, who said it, and its whole words as they now stand. */
export interface ManagerChatLineWrite {
  readonly conversationId: string;
  readonly clientKey: string;
  /** The caller who said it, whose message it is; null for the voice's line, which is the Manager's own. */
  readonly callerId: string | null;
  readonly text: string;
  readonly now: Date;
}

/** Which page of a chat a read takes: the newest messages before a `seq`, or the newest of all, at most `limit`. */
export interface ManagerChatPage {
  readonly before?: number;
  readonly limit: number;
}

/** What a rewind dropped of a Manager's conversation: the turns, and the person's lines. */
export interface ManagerChatDropped {
  readonly turnIds: readonly string[];
  readonly lineIds: readonly string[];
}

const MESSAGE_COLUMNS = {
  id: managerChatMessage.id,
  seq: managerChatMessage.seq,
  authorKind: managerChatMessage.authorKind,
  authorUserId: managerChatMessage.authorUserId,
  authorName: managerChatMessage.authorName,
  text: managerChatMessage.text,
  attachments: managerChatMessage.attachments,
  threadRoot: managerChatMessage.threadRoot,
  broadcast: managerChatMessage.broadcast,
  turnId: managerChatMessage.turnId,
  lineId: managerChatMessage.lineId,
  createdAt: managerChatMessage.createdAt,
  editedAt: managerChatMessage.editedAt,
};

const ChatKeySchema = Schema.Struct({ userId: Schema.String, agentId: Schema.String });

/** The condition that the row is a message of the chat of this Manager the account reaches. */
function ofReachedChat(userId: string, agentId: string, ...rest: (SQL | undefined)[]) {
  return and(
    eq(managerChatMessage.agentId, agentId),
    eq(agentTable.kind, AGENT_KIND.MANAGER),
    agentReachableBy(userId),
    ...rest,
  );
}

/** The Manager's row under its lock, as the account reaches it; none where it does not, or the agent is no Manager. */
const lockChat = SqlSchema.findOneOption({
  Request: ChatKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.id, agentId),
            eq(agentTable.kind, AGENT_KIND.MANAGER),
            agentReachableBy(userId),
          ),
        )
        .limit(1)
        .for("no key update", { of: agentTable }),
    ),
});

const ChatOfConversationSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.NullOr(Schema.String),
  model: Schema.String,
  automationName: Schema.NullOr(Schema.String),
});

/** The Manager standing on the conversation, under its row's lock, as the account reaches it, with what names it; none where no Manager the account reaches stands on it. */
const lockChatOfConversation = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: ChatOfConversationSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({
          id: agentTable.id,
          title: agentTable.title,
          model: agentTable.model,
          automationName: agentAutomationNameSql(agentTable),
        })
        .from(agentTable)
        .where(
          and(
            eq(agentTable.conversationId, conversationId),
            eq(agentTable.kind, AGENT_KIND.MANAGER),
            agentReachableBy(userId),
          ),
        )
        .limit(1)
        .for("no key update", { of: agentTable }),
    ),
});

const findUserName = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: Schema.Struct({ name: Schema.String }),
  execute: (userId) =>
    Database.use((db) =>
      db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1),
    ),
});

const findMessages = SqlSchema.findAll({
  Request: Schema.Struct({
    ...ChatKeySchema.fields,
    ids: Schema.optionalKey(Schema.Array(Schema.String)),
    clientKey: Schema.optionalKey(Schema.String),
    lineId: Schema.optionalKey(Schema.String),
    root: Schema.optionalKey(Schema.String),
    before: Schema.optional(Schema.Number),
    words: Schema.optionalKey(Schema.Array(Schema.String)),
    limit: Schema.optionalKey(Schema.Number),
  }),
  Result: ManagerChatMessageSchema,
  execute: ({ userId, agentId, ids, clientKey, lineId, root, before, words, limit }) =>
    Database.use((db) => {
      const query = db
        .select(MESSAGE_COLUMNS)
        .from(managerChatMessage)
        .innerJoin(agentTable, eq(agentTable.id, managerChatMessage.agentId))
        .where(
          ofReachedChat(
            userId,
            agentId,
            ids === undefined ? undefined : inArray(managerChatMessage.id, ids),
            clientKey === undefined ? undefined : eq(managerChatMessage.clientKey, clientKey),
            lineId === undefined ? undefined : eq(managerChatMessage.lineId, lineId),
            root === undefined
              ? undefined
              : or(
                  and(eq(managerChatMessage.id, root), isNull(managerChatMessage.threadRoot)),
                  eq(managerChatMessage.threadRoot, root),
                ),
            before === undefined ? undefined : lt(managerChatMessage.seq, before),
            ...(words ?? []).map(
              (word) => sql`${managerChatMessage.text} ilike ${containing(word)}`,
            ),
          ),
        )
        // Note that a thread reads oldest first, as it is read down, and every other read newest first.
        .orderBy(root === undefined ? desc(managerChatMessage.seq) : asc(managerChatMessage.seq));

      return limit === undefined ? query : query.limit(limit);
    }),
});

const insertMessage = SqlSchema.findAll({
  Request: Schema.Struct({
    agentId: Schema.String,
    id: Schema.String,
    clientKey: Schema.String,
    authorKind: Schema.Literals(Object.values(MANAGER_CHAT_AUTHOR)),
    authorUserId: Schema.NullOr(Schema.String),
    authorName: Schema.String,
    text: Schema.String,
    attachments: Schema.Array(managerChatAttachmentSchema),
    threadRoot: Schema.NullOr(Schema.String),
    broadcast: Schema.Boolean,
    turnId: Schema.NullOr(Schema.String),
    lineId: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  Result: ManagerChatMessageSchema,
  execute: ({ now, ...row }) =>
    Database.use((db) =>
      db
        .insert(managerChatMessage)
        .values({ ...row, createdAt: now })
        .onConflictDoNothing()
        .returning(MESSAGE_COLUMNS),
    ),
});

const growMessageText = SqlSchema.findAll({
  Request: Schema.Struct({ agentId: Schema.String, id: Schema.String, text: Schema.String }),
  Result: ManagerChatMessageSchema,
  execute: ({ agentId, id, text }) =>
    Database.use((db) =>
      db
        .update(managerChatMessage)
        .set({ text })
        .where(and(eq(managerChatMessage.agentId, agentId), eq(managerChatMessage.id, id)))
        .returning(MESSAGE_COLUMNS),
    ),
});

const deleteDropped = SqlSchema.void({
  Request: Schema.Struct({
    ...ChatKeySchema.fields,
    turnIds: Schema.Array(Schema.String),
    lineIds: Schema.Array(Schema.String),
  }),
  execute: ({ userId, agentId, turnIds, lineIds }) =>
    Database.use((db) =>
      db.delete(managerChatMessage).where(
        and(
          eq(managerChatMessage.agentId, agentId),
          or(
            turnIds.length === 0 ? undefined : inArray(managerChatMessage.turnId, turnIds),
            lineIds.length === 0 ? undefined : inArray(managerChatMessage.lineId, lineIds),
          ),
          exists(
            queryBuilder
              .select({ one: agentTable.id })
              .from(agentTable)
              .where(
                and(
                  eq(agentTable.id, managerChatMessage.agentId),
                  eq(agentTable.kind, AGENT_KIND.MANAGER),
                  agentReachableBy(userId),
                ),
              ),
          ),
        ),
      ),
    ),
});

/** Whether words given for a line are a repeat of its standing words: those words, or a start of them, which a record arriving late or run again carries. */
function repeatOf(standing: string, given: string): boolean {
  return standing.startsWith(given);
}

/** A line of a call inserted in the Manager's chat on first sight, its author named as they now stand, under the first id of its key's digest no message holds; none free is refused. */
const insertedLine = Effect.fnUntraced(function* (
  manager: typeof ChatOfConversationSchema.Type,
  line: ManagerChatLineWrite,
) {
  const { clientKey, callerId, text, now } = line;

  const authorName =
    callerId === null
      ? agentName(manager)
      : Option.match(yield* findUserName(callerId), {
          onNone: () => "",
          onSome: (found) => found.name,
        });

  for (const id of managerChatIdsOf(clientKey)) {
    const [inserted] = yield* insertMessage({
      agentId: manager.id,
      id,
      clientKey,
      authorKind: callerId === null ? MANAGER_CHAT_AUTHOR.AGENT : MANAGER_CHAT_AUTHOR.PERSON,
      authorUserId: callerId,
      authorName,
      text,
      attachments: [],
      threadRoot: null,
      broadcast: false,
      turnId: null,
      lineId: null,
      now,
    });

    // Note that the key was read under the lock, so a conflict here is the id's alone, and the next is tried.
    if (inserted !== undefined) {
      return { status: MANAGER_CHAT_OUTCOME.DONE, message: inserted } as const;
    }
  }

  return { status: MANAGER_CHAT_OUTCOME.ID_TAKEN } as const;
});

/**
 * The message written to the Manager's chat as the account, under the
 * Manager's lock, and answered as it landed: the one a write under the same
 * key landed as where there was one, with nothing written again. A reply
 * stands in the thread of the message it names.
 */
export function writeManagerChatMessage(
  userId: string,
  write: ManagerChatWrite,
): AgentStoreEffect<ManagerChatOutcome> {
  const { agentId, inReplyTo, now, ...row } = write;

  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (Option.isNone(yield* lockChat({ userId, agentId }))) {
          return { status: MANAGER_CHAT_OUTCOME.NO_CHAT } as const;
        }

        const landed = yield* findMessages({ userId, agentId, clientKey: write.clientKey });

        if (landed[0] !== undefined) {
          return { status: MANAGER_CHAT_OUTCOME.DONE, message: landed[0], repeated: true } as const;
        }

        let threadRoot: string | null = null;

        if (inReplyTo !== null) {
          const [parent] = yield* findMessages({ userId, agentId, ids: [inReplyTo] });

          if (parent === undefined) return { status: MANAGER_CHAT_OUTCOME.NO_THREAD } as const;
          threadRoot = parent.threadRoot ?? parent.id;
        }

        // Note that the key was read under the lock, so a conflict here is the id's alone.
        const [inserted] = yield* insertMessage({ ...row, agentId, threadRoot, now });

        return inserted === undefined
          ? ({ status: MANAGER_CHAT_OUTCOME.ID_TAKEN } as const)
          : ({ status: MANAGER_CHAT_OUTCOME.DONE, message: inserted } as const);
      }),
    ),
  );
}

/** The ids a message keyed so may go by, in the order tried: the key's digest cut into runs of the id's digits, so a write run again under its key tries the same ids. */
export function managerChatIdsOf(clientKey: string): readonly string[] {
  const digest = createHash("sha256").update(clientKey).digest("hex");

  return Array.from({ length: digest.length / MESSAGE_ID_DIGITS }, (_, index) =>
    digest.slice(index * MESSAGE_ID_DIGITS, (index + 1) * MESSAGE_ID_DIGITS),
  );
}

/**
 * The line of a call written to the chat of the Manager whose conversation
 * it was said in, as the account reaches the chat, under the Manager's
 * lock: inserted under its key on first sight, under the first free id of
 * the key's digest, its author named as they now stand; grown in place
 * after, keeping its place in the chat; and found as it stood where the
 * words given are its words or a start of them. Answers that no chat
 * stands for a conversation no Manager the account reaches stands on.
 */
export function growManagerChatLine(
  userId: string,
  line: ManagerChatLineWrite,
): AgentStoreEffect<ManagerChatOutcome> {
  const { conversationId, clientKey, text } = line;

  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const chat = yield* lockChatOfConversation({ userId, conversationId });

        if (Option.isNone(chat)) return { status: MANAGER_CHAT_OUTCOME.NO_CHAT } as const;
        const manager = chat.value;
        const [standing] = yield* findMessages({ userId, agentId: manager.id, clientKey });

        if (standing !== undefined) {
          if (repeatOf(standing.text, text)) {
            return {
              status: MANAGER_CHAT_OUTCOME.DONE,
              message: standing,
              repeated: true,
            } as const;
          }

          const [grown] = yield* growMessageText({ agentId: manager.id, id: standing.id, text });

          return { status: MANAGER_CHAT_OUTCOME.DONE, message: grown ?? standing } as const;
        }

        return yield* insertedLine(manager, line);
      }),
    ),
  );
}

/** The message of the Manager's chat under this id, as the account reaches the chat; none where it does not, or no message holds the id. */
export function readManagerChatMessage(
  userId: string,
  agentId: string,
  id: string,
): AgentStoreEffect<Option.Option<ManagerChatMessage>> {
  return Effect.map(findMessages({ userId, agentId, ids: [id] }), (rows) =>
    Option.fromNullishOr(rows[0]),
  );
}

/** The message of the Manager's chat written under this client key, as the account reaches the chat; none where it does not, or no write under the key landed. */
export function readManagerChatMessageByKey(
  userId: string,
  agentId: string,
  clientKey: string,
): AgentStoreEffect<Option.Option<ManagerChatMessage>> {
  return Effect.map(findMessages({ userId, agentId, clientKey }), (rows) =>
    Option.fromNullishOr(rows[0]),
  );
}

/** The person's message of the Manager's chat written beside this line of its transcript, as the account reaches the chat; none where it does not, or the line is no chat message. */
export function readManagerChatMessageOfLine(
  userId: string,
  agentId: string,
  lineId: string,
): AgentStoreEffect<Option.Option<ManagerChatMessage>> {
  return Effect.map(findMessages({ userId, agentId, lineId }), (rows) =>
    Option.fromNullishOr(rows[0]),
  );
}

/** A page of the Manager's chat, replies included, newest first, as the account reaches the chat. */
export function readManagerChatPage(
  userId: string,
  agentId: string,
  page: ManagerChatPage,
): AgentStoreEffect<readonly ManagerChatMessage[]> {
  return findMessages({ userId, agentId, limit: page.limit, before: page.before });
}

/** A thread of the Manager's chat, its root then its replies, oldest first, as the account reaches the chat; none where the id names no root. */
export function readManagerChatThread(
  userId: string,
  agentId: string,
  root: string,
): AgentStoreEffect<readonly ManagerChatMessage[]> {
  return findMessages({ userId, agentId, root });
}

/** The messages of the Manager's chat holding every word of the query, whatever its case, newest first, at most `limit`; none for a query of no words. */
export function searchManagerChat(
  userId: string,
  agentId: string,
  query: string,
  limit: number,
): AgentStoreEffect<readonly ManagerChatMessage[]> {
  const words = query.split(/\s+/u).filter(Boolean);

  if (words.length === 0) return Effect.succeed([]);

  return findMessages({ userId, agentId, words, limit });
}

/** The messages of the Manager's chat a rewind dropped deleted, as the account reaches the chat: those sent in a dropped turn, and a person's on a dropped line, with the threads they root. */
export function deleteDroppedManagerChat(
  userId: string,
  agentId: string,
  dropped: ManagerChatDropped,
): AgentStoreEffect<void> {
  if (dropped.turnIds.length === 0 && dropped.lineIds.length === 0) return Effect.void;

  return deleteDropped({ userId, agentId, ...dropped });
}
