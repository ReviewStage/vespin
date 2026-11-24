/**
 * manager-chat-tools.ts -- a Manager's own chat as its tools read it: `read_chat_messages`, `read_chat_thread`, and `search_chat`, as Slack's tools read a channel.
 *
 * A Manager's chat is its rows (`@repo/database/models/manager-chat-messages`):
 * people's messages and the Manager's own, each going by a short id the
 * Manager names (`message_id`), and each reply standing in its thread's
 * root's thread. These tools read it as Slack's own tools read a channel:
 * the newest messages at the chat's top, one thread whole, or the messages
 * a search finds, each with its id and, for a reply, its thread's root's id
 * (`thread_ts`), so the Manager answers in the right thread with
 * `send_to_user`.
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
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { MANAGER_CHAT_AUTHOR } from "@repo/features/manager-chat-live";
import type { WireRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
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
  BAD_CURSOR: "Not read: cursor is not one a previous read returned as next_cursor.",
  BAD_TIME: (field: string) => `Not read: ${field} is not a time in ISO 8601.`,
  UNKNOWN: (id: string) =>
    `No message in your chat has the id ${id}. Use read_chat_messages or search_chat to find message ids.`,
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

/** `read_chat_messages` as a Manager is offered it. */
export const READ_CHAT_MESSAGES_TOOL = {
  name: AGENT_TOOL.READ_CHAT_MESSAGES,
  description:
    "Read your chat's messages, newest first. Detailed format includes thread info (reply count, " +
    "latest reply). Use read_chat_thread with message_id to read thread replies. Use search_chat " +
    "to search.",
  inputSchema: READ_CHAT_INPUT,
} as const;

/** `read_chat_thread` as a Manager is offered it. */
export const READ_CHAT_THREAD_TOOL = {
  name: AGENT_TOOL.READ_CHAT_THREAD,
  description:
    "Read a thread of your chat: its parent message and all replies, oldest first. Use " +
    "read_chat_messages or search_chat to find message ids. Use send_to_user with thread_ts to " +
    "reply to a thread.",
  inputSchema: READ_THREAD_INPUT,
} as const;

/** `search_chat` as a Manager is offered it. */
export const SEARCH_CHAT_TOOL = {
  name: AGENT_TOOL.SEARCH_CHAT,
  description:
    "Search your chat's messages, thread replies included, by keywords and filters. Use " +
    "read_chat_thread with message_id to read a result's thread.",
  inputSchema: SEARCH_CHAT_INPUT,
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

/** A message as a read answers it, in the format asked: its id, sender, words, and thread's root where it is a reply; and, detailed, when it was sent and its thread's replies where it is a root. */
function shown(
  message: ManagerChatMessage,
  format: string | undefined,
  replies: ManagerChatReplies | undefined,
): WireRecord {
  const from = message.authorKind === MANAGER_CHAT_AUTHOR.AGENT ? YOU : message.authorName;
  const thread = message.threadRoot === null ? undefined : { thread_ts: message.threadRoot };
  const concise = { message_id: message.id, from, text: message.text, ...thread };

  if (format === RESPONSE_FORMAT.CONCISE) return concise;

  return {
    ...concise,
    at: message.createdAt.toISOString(),
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

/** The messages a read answers, each with its thread's replies where it is a root, and the cursor of the next page where one may stand. */
const answered = (
  owner: ChatOwner,
  messages: readonly ManagerChatMessage[],
  format: string | undefined,
  next: string | undefined,
) =>
  Effect.map(
    readManagerChatReplies(
      owner.userId,
      owner.agentId,
      messages.flatMap((message) => (message.threadRoot === null ? [message.id] : [])),
    ),
    (replies): WireRecord => ({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      messages: messages.map((message) => shown(message, format, replies.get(message.id))),
      ...(next === undefined ? undefined : { next_cursor: next }),
    }),
  );

/** One call of `read_chat_messages`: the messages at the chat's top, newest first, a page at a time. */
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

/** One call of `read_chat_thread`: the thread's root, then its replies oldest first, a page at a time; the thread a reply stands in where its id names a reply. */
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

/** One call of `search_chat`: the chat's messages, replies included, that hold every keyword and pass the filters, the best matches or the newest first, a page at a time. */
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
