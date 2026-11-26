/**
 * manager-chat-tools.ts -- a Manager's own chat as its tools read it and react on it: `chat_read_messages`, `chat_read_thread`, `chat_search`, and `chat_react`, as Slack's tools read a channel and react in it.
 *
 * A Manager's chat is its rows (`@repo/database/models/manager-chat-messages`):
 * people's messages and the Manager's own, each going by a short id the
 * Manager names (`message_id`), and each reply standing in its thread's
 * root's thread. These tools read it as Slack's own tools read a channel:
 * the newest messages at the chat's top, one thread whole, or the messages
 * a search finds, each with its id and, for a reply, its thread's root's id
 * (`thread_ts`), so the Manager answers in the right thread with
 * `chat_send`, its reactions, each kind with who gave it, and whether its
 * words were edited since it was sent, which a read answers as they now
 * stand, as Slack's `edited` marks a message. The Manager
 * gives a reaction or takes its own off (`chat_react`), as Slack's
 * `reactions.add` and `reactions.remove` do; a reaction, a member's or its
 * own, opens no turn.
 *
 * Every read is the calling Manager's own chat, as its starter reaches it,
 * and nothing of another agent's or another workspace's.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  type ManagerChatMessage,
  type ManagerChatReplies,
  queryManagerChat,
  readManagerChatMessage,
  readManagerChatReplies,
  readManagerChatThread,
} from "@repo/database/models/manager-chat-messages";
import {
  MANAGER_CHAT_REACTION_OUTCOME,
  type ManagerChatReactionGiven,
  reactManagerChat,
  readManagerChatReactions,
} from "@repo/database/models/manager-chat-reactions";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { MANAGER_CHAT_AUTHOR, MANAGER_CHAT_REACTION } from "@repo/features/manager-chat-live";
import type { WireRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, type UnparsedWireValue } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { type AgentCall, agentToolRejected, callerAgent } from "../agent-tools.js";

/** How many messages a read answers where it names no limit, and the most it may name. */
const CHAT_LIMIT = {
  DEFAULT: 20,
  MAX: 100,
} as const;

/** The most matches a search by score ranks, the newest; past them it says so (`SEARCH_POOL_NOTE`). */
const SEARCH_POOL = 500;

/** What a search by score says where more matches stand than it ranked. */
const SEARCH_POOL_NOTE = `Ranked the newest ${SEARCH_POOL} matches only; sort by timestamp to page through every match.`;

/** How much of each message a read answers: everything, or its id, sender, words, and thread alone. */
const RESPONSE_FORMAT = {
  DETAILED: "detailed",
  CONCISE: "concise",
} as const;

/** How a search's results are ordered: by how often they hold the keywords, or newest first. */
const SEARCH_SORT = {
  SCORE: "score",
  TIMESTAMP: "timestamp",
} as const;

/** Who sent the Manager's own messages, as its reads name them, and as `from` names them. */
const YOU = "you";

const ME = "me";

/** Why a read was refused, in words the model can act on. */
const CHAT_REFUSAL = {
  NOT_MANAGER: "Not read: only a Manager has a chat.",
  UNREADABLE: "Not read: the input does not match the tool's schema.",
  UNREAD: "Not read: your chat could not be read; try again.",
  UNREACTED: "Not reacted: your chat could not be written; try again.",
  BAD_CURSOR: "Not read: cursor is not one a previous read returned as next_cursor.",
  BAD_TIME: (field: string) => `Not read: ${field} is not a time in ISO 8601.`,
  UNKNOWN: (id: string) =>
    `No message in your chat has the id ${id}. Use chat_read_messages or chat_search to find message ids.`,
} as const;

const LIMIT = Schema.optionalKey(
  describeWire(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: CHAT_LIMIT.MAX })),
    `How many messages to return, 1 to ${CHAT_LIMIT.MAX}; ${CHAT_LIMIT.DEFAULT} where left out.`,
  ),
);

const CURSOR = Schema.optionalKey(
  describeWire(Schema.String, "The next_cursor a previous read returned, for its next page."),
);

const OLDEST = Schema.optionalKey(
  describeWire(Schema.String, "Only messages sent at or after this time, in ISO 8601."),
);

const LATEST = Schema.optionalKey(
  describeWire(Schema.String, "Only messages sent at or before this time, in ISO 8601."),
);

const FORMAT = Schema.optionalKey(
  describeWire(
    Schema.Literals(Object.values(RESPONSE_FORMAT)),
    "`detailed` (the default) for times and thread info, or `concise` for ids, senders, and words alone.",
  ),
);

const READ_CHAT_INPUT = Schema.Struct({
  limit: LIMIT,
  cursor: CURSOR,
  oldest: OLDEST,
  latest: LATEST,
  response_format: FORMAT,
});

const READ_THREAD_INPUT = Schema.Struct({
  message_id: describeWire(
    Schema.Trim.check(Schema.isNonEmpty()),
    "The id of the thread's parent message.",
  ),
  limit: LIMIT,
  cursor: CURSOR,
  oldest: OLDEST,
  latest: LATEST,
  response_format: FORMAT,
});

const SEARCH_CHAT_INPUT = Schema.Struct({
  keywords: Schema.optionalKey(
    describeWire(Schema.String, "Words every result holds, in any case."),
  ),
  filters: Schema.optionalKey(
    Schema.Struct({
      from: Schema.optionalKey(
        describeWire(Schema.String, "Only messages from this person, by name, or `me` for yours."),
      ),
      before: Schema.optionalKey(
        describeWire(Schema.String, "Only messages sent before this time, in ISO 8601."),
      ),
      after: Schema.optionalKey(
        describeWire(Schema.String, "Only messages sent after this time, in ISO 8601."),
      ),
      is_thread: Schema.optionalKey(
        describeWire(Schema.Boolean, "true for thread replies alone, false for none."),
      ),
    }),
  ),
  limit: LIMIT,
  cursor: CURSOR,
  sort: Schema.optionalKey(
    describeWire(
      Schema.Literals(Object.values(SEARCH_SORT)),
      "`score` (the default) for the best matches first, or `timestamp` for the newest first.",
    ),
  ),
  response_format: FORMAT,
});

const REACT_CHAT_INPUT = Schema.Struct({
  message_id: describeWire(Schema.Trim.check(Schema.isNonEmpty()), "The id of the message."),
  name: describeWire(
    Schema.Literals(Object.values(MANAGER_CHAT_REACTION)),
    "The reaction: `thumbsup` or `thumbsdown`.",
  ),
  remove: Schema.optionalKey(
    describeWire(Schema.Boolean, "true to take your reaction off instead."),
  ),
});

/** `chat_read_messages` as a Manager is offered it. */
export const READ_CHAT_MESSAGES_TOOL = {
  name: AGENT_TOOL.READ_CHAT_MESSAGES,
  description:
    "Read your chat's messages, newest first. Detailed format includes thread info (reply count, " +
    "latest reply). Use chat_read_thread with message_id to read thread replies. Use chat_search " +
    "to search.",
  inputSchema: READ_CHAT_INPUT,
} as const;

/** `chat_read_thread` as a Manager is offered it. */
export const READ_CHAT_THREAD_TOOL = {
  name: AGENT_TOOL.READ_CHAT_THREAD,
  description:
    "Read a thread of your chat: its parent message and all replies, oldest first. Use " +
    "chat_read_messages or chat_search to find message ids. Use chat_send with thread_ts to " +
    "reply to a thread.",
  inputSchema: READ_THREAD_INPUT,
} as const;

/** `chat_search` as a Manager is offered it. */
export const SEARCH_CHAT_TOOL = {
  name: AGENT_TOOL.SEARCH_CHAT,
  description:
    "Search your chat's messages, thread replies included, by keywords and filters. Use " +
    "chat_read_thread with message_id to read a result's thread.",
  inputSchema: SEARCH_CHAT_INPUT,
} as const;

/** `chat_react` as a Manager is offered it. */
export const REACT_CHAT_TOOL = {
  name: AGENT_TOOL.REACT_CHAT,
  description:
    "Add a reaction to a message in your chat, or take yours off with `remove`. React `thumbsup` " +
    "to acknowledge a message where a reply would add nothing.",
  inputSchema: REACT_CHAT_INPUT,
} as const;

/** The Manager whose chat a call reads: its id and its starter's account, which reaches the chat; none for an agent of any other kind. */
interface ChatOwner {
  readonly userId: string;
  readonly agentId: string;
}

function ownerOf(call: AgentCall): ChatOwner | undefined {
  const manager = callerAgent(call.caller);

  return manager?.kind === AGENT_KIND.MANAGER
    ? { userId: manager.userId, agentId: manager.id }
    : undefined;
}

/** A message's reactions as a read answers them, as Slack's do: each kind given, first given first, with how many gave it and who, the Manager as `you`; none where none was given. */
function reactionsShown(given: readonly ManagerChatReactionGiven[] | undefined) {
  if (given === undefined || given.length === 0) return undefined;
  const users = new Map<string, string[]>();

  for (const reaction of given) {
    const named = users.get(reaction.kind) ?? [];
    named.push(
      reaction.reactorKind === MANAGER_CHAT_AUTHOR.AGENT ? YOU : (reaction.reactorName ?? ""),
    );
    users.set(reaction.kind, named);
  }

  return {
    reactions: [...users].map(([name, by]) => ({ name, count: by.length, users: by })),
  };
}

/** A message as a read answers it, in the format asked: its id, sender, words as they now stand, thread's root where it is a reply, whether it was edited, and reactions where it was given any; and, detailed, when it was sent and last edited, and its thread's replies where it is a root. */
function shown(
  message: ManagerChatMessage,
  format: string | undefined,
  replies: ManagerChatReplies | undefined,
  reactions: readonly ManagerChatReactionGiven[] | undefined,
): WireRecord {
  const from = message.authorKind === MANAGER_CHAT_AUTHOR.AGENT ? YOU : message.authorName;
  const thread = message.threadRoot === null ? undefined : { thread_ts: message.threadRoot };

  const concise = {
    message_id: message.id,
    from,
    text: message.text,
    ...thread,
    ...(message.editedAt === null ? undefined : { edited: true }),
    ...reactionsShown(reactions),
  };

  if (format === RESPONSE_FORMAT.CONCISE) return concise;

  return {
    ...concise,
    at: message.createdAt.toISOString(),
    ...(message.editedAt === null ? undefined : { edited_at: message.editedAt.toISOString() }),
    ...(message.threadRoot === null ? { reply_count: replies?.count ?? 0 } : undefined),
    ...(replies === undefined ? undefined : { latest_reply: replies.latestAt.toISOString() }),
  };
}

/** A time a read names, read as a date; none where it names none, and a refusal for one no date reads. */
function timeOf(field: string, value: string | undefined): Result.Result<Date | undefined, string> {
  if (value === undefined) return Result.succeed(undefined);
  const at = new Date(value);

  return Number.isNaN(at.getTime())
    ? Result.fail(CHAT_REFUSAL.BAD_TIME(field))
    : Result.succeed(at);
}

/** A cursor a read names, read as the count of messages before it; none where it names none, and a refusal for one no read answered. */
function cursorOf(cursor: string | undefined): Result.Result<number, string> {
  if (cursor === undefined) return Result.succeed(0);
  const at = Number(cursor);

  return Number.isInteger(at) && at >= 0
    ? Result.succeed(at)
    : Result.fail(CHAT_REFUSAL.BAD_CURSOR);
}

/** The time window a read names, each end read as a date, or the refusal of the first no date reads. */
function windowOf(
  oldest: string | undefined,
  latest: string | undefined,
): Result.Result<{ readonly after?: Date; readonly before?: Date }, string> {
  const after = timeOf("oldest", oldest);

  if (Result.isFailure(after)) return Result.fail(after.failure);
  const before = timeOf("latest", latest);

  if (Result.isFailure(before)) return Result.fail(before.failure);

  return Result.succeed({
    ...(after.success === undefined ? undefined : { after: after.success }),
    ...(before.success === undefined ? undefined : { before: before.success }),
  });
}

/** A read of the caller's own chat with its input, answered as `answer` makes of it, refused with why where the input, the caller, or the store fails it. */
function readChatWith<Input>(
  call: AgentCall,
  input: UnparsedWireValue,
  decode: (input: UnparsedWireValue) => Result.Result<Input, unknown>,
  answer: (
    owner: ChatOwner,
    input: Input,
  ) => Effect.Effect<WireRecord, StoreFailure, DatabaseServices>,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  const read = decode(input);

  if (Result.isFailure(read)) return Effect.succeed(agentToolRejected(CHAT_REFUSAL.UNREADABLE));
  const owner = ownerOf(call);

  if (owner === undefined) return Effect.succeed(agentToolRejected(CHAT_REFUSAL.NOT_MANAGER));

  return answer(owner, read.success).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => agentToolRejected(CHAT_REFUSAL.UNREAD)),
  );
}

/** The messages a read answers, each with its thread's replies where it is a root and its reactions, and the cursor of the next page where one may stand. */
const answered = (
  owner: ChatOwner,
  messages: readonly ManagerChatMessage[],
  format: string | undefined,
  next: string | undefined,
) =>
  Effect.map(
    Effect.all(
      {
        replies: readManagerChatReplies(
          owner.userId,
          owner.agentId,
          messages.flatMap((message) => (message.threadRoot === null ? [message.id] : [])),
        ),
        reactions: readManagerChatReactions(
          owner.userId,
          owner.agentId,
          messages.map((message) => message.id),
        ),
      },
      { concurrency: "unbounded" },
    ),
    ({ replies, reactions }): WireRecord => ({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      messages: messages.map((message) =>
        shown(message, format, replies.get(message.id), reactions.get(message.id)),
      ),
      ...(next === undefined ? undefined : { next_cursor: next }),
    }),
  );

/** One call of `chat_read_messages`: the messages at the chat's top, newest first, a page at a time. */
export function runReadChatMessages(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return readChatWith(call, input, Schema.decodeUnknownResult(READ_CHAT_INPUT), (owner, read) => {
    const window = windowOf(read.oldest, read.latest);
    const from = cursorOf(read.cursor);

    if (Result.isFailure(window)) return Effect.succeed(agentToolRejected(window.failure));

    if (Result.isFailure(from)) return Effect.succeed(agentToolRejected(from.failure));
    const limit = read.limit ?? CHAT_LIMIT.DEFAULT;

    // Note that a cursor is the seq the page before it ended at, so a message written since moves nothing a reader paged past.
    return Effect.flatMap(
      queryManagerChat(owner.userId, owner.agentId, {
        top: true,
        ...(window.success.after === undefined ? undefined : { sentAfter: window.success.after }),
        ...(window.success.before === undefined
          ? undefined
          : { sentBefore: window.success.before }),
        ...(from.success === 0 ? undefined : { beforeSeq: from.success }),
        limit,
      }),
      (messages) => {
        const last = messages.at(-1);
        const next = messages.length === limit && last !== undefined ? String(last.seq) : undefined;

        return answered(owner, messages, read.response_format, next);
      },
    );
  });
}

/** One call of `chat_read_thread`: the thread's root, then its replies oldest first, a page at a time; the thread a reply stands in where its id names a reply. */
export function runReadChatThread(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return readChatWith(call, input, Schema.decodeUnknownResult(READ_THREAD_INPUT), (owner, read) => {
    const window = windowOf(read.oldest, read.latest);
    const from = cursorOf(read.cursor);

    if (Result.isFailure(window)) return Effect.succeed(agentToolRejected(window.failure));

    if (Result.isFailure(from)) return Effect.succeed(agentToolRejected(from.failure));

    return Effect.gen(function* () {
      const named = yield* readManagerChatMessage(owner.userId, owner.agentId, read.message_id);

      if (Option.isNone(named)) return agentToolRejected(CHAT_REFUSAL.UNKNOWN(read.message_id));
      const root = named.value.threadRoot ?? named.value.id;
      const [parent, ...replies] = yield* readManagerChatThread(owner.userId, owner.agentId, root);
      const { after, before } = window.success;

      // Note that the parent always leads the thread, and the window and the page fall on its replies.
      const inWindow = replies.filter(
        (reply) =>
          (after === undefined || reply.createdAt >= after) &&
          (before === undefined || reply.createdAt <= before),
      );

      const limit = read.limit ?? CHAT_LIMIT.DEFAULT;
      const page = inWindow.slice(from.success, from.success + limit);
      const more = from.success + limit < inWindow.length;

      return yield* answered(
        owner,
        [...(parent === undefined || from.success > 0 ? [] : [parent]), ...page],
        read.response_format,
        more ? String(from.success + limit) : undefined,
      );
    });
  });
}

/** How many times a message's words hold the keywords, each counted. */
function scoreOf(message: ManagerChatMessage, keywords: readonly string[]): number {
  const words = message.text.toLowerCase();

  return keywords.reduce((sum, keyword) => sum + words.split(keyword).length - 1, 0);
}

/** One call of `chat_search`: the chat's messages, replies included, that hold every keyword and pass the filters, the best matches or the newest first, a page at a time. */
export function runSearchChat(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return readChatWith(call, input, Schema.decodeUnknownResult(SEARCH_CHAT_INPUT), (owner, read) => {
    const filters = read.filters ?? {};
    const window = windowOf(filters.after, filters.before);
    const from = cursorOf(read.cursor);

    if (Result.isFailure(window)) return Effect.succeed(agentToolRejected(window.failure));

    if (Result.isFailure(from)) return Effect.succeed(agentToolRejected(from.failure));

    const keywords = (read.keywords ?? "")
      .toLowerCase()
      .split(/\s+/u)
      .filter((word) => word !== "");

    const named = filters.from?.trim().toLowerCase();

    const sender =
      named === undefined || named === ""
        ? undefined
        : named === ME || named === YOU
          ? ({ manager: true } as const)
          : ({ manager: false, name: named } as const);

    const limit = read.limit ?? CHAT_LIMIT.DEFAULT;

    const filtered = {
      words: keywords,
      ...(sender === undefined ? undefined : { from: sender }),
      ...(filters.is_thread === undefined ? undefined : { top: !filters.is_thread }),
      ...(window.success.after === undefined ? undefined : { sentAfter: window.success.after }),
      ...(window.success.before === undefined ? undefined : { sentBefore: window.success.before }),
    };

    // Note that newest first pages through every match in the store, one past the page saying whether more stand.
    if (read.sort === SEARCH_SORT.TIMESTAMP || keywords.length === 0) {
      return Effect.flatMap(
        queryManagerChat(owner.userId, owner.agentId, {
          ...filtered,
          offset: from.success,
          limit: limit + 1,
        }),
        (found) =>
          answered(
            owner,
            found.slice(0, limit),
            read.response_format,
            found.length > limit ? String(from.success + limit) : undefined,
          ),
      );
    }

    // Note that a ranking weighs the newest matches up to the pool, and says so where more stand past it.
    return Effect.flatMap(
      queryManagerChat(owner.userId, owner.agentId, { ...filtered, limit: SEARCH_POOL + 1 }),
      (found) => {
        const pool = found.slice(0, SEARCH_POOL);
        const ranked = pool.toSorted((a, b) => scoreOf(b, keywords) - scoreOf(a, keywords));
        const page = ranked.slice(from.success, from.success + limit);
        const more = from.success + limit < ranked.length;

        return Effect.map(
          answered(
            owner,
            page,
            read.response_format,
            more ? String(from.success + limit) : undefined,
          ),
          (answer): WireRecord =>
            found.length > SEARCH_POOL ? { ...answer, note: SEARCH_POOL_NOTE } : answer,
        );
      },
    );
  });
}

/** One call of `chat_react`: the Manager's reaction added to a message of its chat, or taken off it, which a message given it already, or never given it, answers alike. */
export function runReactChat(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return readChatWith(call, input, Schema.decodeUnknownResult(REACT_CHAT_INPUT), (owner, react) =>
    Effect.gen(function* () {
      const outcome = yield* reactManagerChat(owner.userId, {
        agentId: owner.agentId,
        messageId: react.message_id,
        by: MANAGER_CHAT_AUTHOR.AGENT,
        kind: react.name,
        reacted: react.remove !== true,
        now: yield* DateTime.nowAsDate,
      });

      return outcome.status === MANAGER_CHAT_REACTION_OUTCOME.NO_MESSAGE
        ? agentToolRejected(CHAT_REFUSAL.UNKNOWN(react.message_id))
        : { status: ACTION_RESULT_STATUS.ACCEPTED };
    }).pipe(
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed(() => agentToolRejected(CHAT_REFUSAL.UNREACTED)),
    ),
  );
}
