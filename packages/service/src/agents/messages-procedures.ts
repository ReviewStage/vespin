/**
 * messages-procedures.ts -- the held message reads, and the writes on the same paths, as the hosted oRPC router answers them.
 *
 * Two reads the desktop holds open while nothing it reads has moved: one
 * agent's transcript (`GET /api/agents/{id}/messages`) and its worker's
 * (`GET /api/agents/{id}/subagents/{call}/messages`), held while the agent
 * or the worker runs (`coder-host/transcript.ts`). Each is a long-held JSON
 * procedure, its hold the store's own, unchanged: the handler adds no
 * deadline of its own, and the hold ends when the store's does, answering
 * the page as it stands. Beside them, the write the same path takes: a
 * message to an agent (`POST /api/agents/{id}/messages`), handed to its
 * session through the one steer path (`coder-host/steer.ts`), its typed
 * words to a Manager written to its chat as the chat's own send writes them, and a line of
 * a call into it recorded as it stands (`POST /api/agents/{id}/voice-lines`),
 * a person's message to a Manager's chat (`POST /api/agents/{id}/chat-messages`),
 * written to the chat beside the line the same steer hands the Manager,
 * under the same reach a message takes, which opens no turn: a delegation's
 * message names the caller's lines it is, and starts its turn on them. And a
 * member's reaction given a message of a Manager's chat, or taken off it
 * (`POST /api/agents/{id}/chat-messages/{message}/reactions`), under the
 * reach a message to the chat takes, which opens no turn either.
 *
 * Every row a read touches is one of a workspace the caller is a member of:
 * an agent or a task of any other workspace answers exactly as one that
 * names nothing, and an id that is no UUID names no row. A title, the
 * agent's or a worker's, is read after the page, since it can land after a
 * turn ends, which a held read may span. An agent's or a worker's
 * transcript read with `wait=none` is answered at once rather than held,
 * with whether the held read would have held on it and how soon the clock
 * alone may end that hold, for a reader following
 * its live statements (`live-wire.ts`). A transcript read with `parts=cut`
 * carries each heavy part cut to its two ends (`coder-host/part-cut.ts`), and
 * the part reads beside them answer one such part whole, under the same
 * reach as the transcript it stands in.
 *
 * Beside them, the same two transcripts read back from their end, at once
 * (`GET /api/agents/{id}/messages/newest`, and its worker's under
 * `subagents/{call}`): the newest page, with the cursor a reader follows
 * on from past it, or, where `before` names the oldest row a reader holds,
 * the page below it, so a desktop opening a long transcript draws its end
 * first and reads back only as far as it is scrolled.
 */

import { middlewareGen } from "@orpc/experimental-effect";
import { ORPCError } from "@orpc/server";
import { type Agent, readAgent, readVisibleAgent } from "@repo/database/models/agent-store";
import { childTitlesOf } from "@repo/database/models/child-titles";
import { readRewoundRevision } from "@repo/database/models/conversation-rewind";
import { childConversationId } from "@repo/database/models/ids";
import { readManagerChatMessageByKey } from "@repo/database/models/manager-chat-messages";
import {
  MANAGER_CHAT_REACTION_OUTCOME,
  reactManagerChat,
} from "@repo/database/models/manager-chat-reactions";
import { listProviderKeyRows } from "@repo/database/models/provider-key-store";
import { listStandingVoiceCalls } from "@repo/database/models/voice-calls";
import {
  type ConversationTarget,
  STORE_WRITE_REFUSAL,
  storeWriter,
} from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import {
  AGENT_BOUNDS,
  AGENT_CURSOR_START,
  AGENT_KIND,
  AGENT_STATUS,
  type AgentMessagesAnswer,
  type AgentNewestAnswer,
  type AgentOlderAnswer,
  type AgentPartAnswer,
  type AgentTranscriptMessage,
  agentBeforeSchema,
  agentCallIdSchema,
  agentCursorSchema,
  TRANSCRIPT_PARTS_QUERY,
} from "@repo/features/agent-wire";
import { TRANSCRIPT_NOW_QUERY } from "@repo/features/live-wire";
import { MANAGER_CHAT_AUTHOR } from "@repo/features/manager-chat-live";
import { PROVIDER_KEY_KIND } from "@repo/features/provider-key-wire";
import { isRecord } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { DateTime, Effect, Option, Result, Schema } from "effect";
import { unparsedWire } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  pathUuid,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, type HostedContext, heldReadMiddleware, hosted } from "../orpc/base.js";
import { admitsPlanWriter, controlsAgent } from "./agent-reach.js";
import { queueOnPage } from "./coder-host/agent-queue.js";
import { chatOfLine } from "./coder-host/manager-chat-line.js";
import { cutMessage, wholePartOf } from "./coder-host/part-cut.js";
import { changeAgentQueue } from "./coder-host/queue-change.js";
import { spokenLineMetadata } from "./coder-host/spoken-line.js";
import { startedBlank } from "./coder-host/status.js";
import { STEER_OUTCOME, type SteerWritten, steerMemberWords } from "./coder-host/steer.js";
import { summaryOf } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import {
  cursorOfWire,
  cursorToWire,
  delegationNow,
  delegationPast,
  NO_TITLE_AWAITED,
  NO_TITLE_EDGE,
  type ReadGate,
  type TitleAwaited,
  type TitleEdge,
  type TranscriptNewest,
  type TranscriptOlder,
  type TranscriptPage,
  titleMayLand,
  titleWindowEdge,
  transcriptBefore,
  transcriptNewest,
  transcriptNow,
  transcriptPast,
} from "./coder-host/transcript.js";

/** oRPC's own code for an input its schema refused. */
const ORPC_BAD_REQUEST = "BAD_REQUEST";

export interface MessagesProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The agent the path names, where the account is a member of its workspace, its conversation targeted under the member who started it; not found otherwise. */
const reachedAgent = /* @__PURE__ */ Effect.fnUntraced(function* (userId: string, id: string) {
  const agentId = yield* pathUuid(id);
  const agent = yield* hostedStoreOrUnavailable(readVisibleAgent(userId, agentId));

  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  const target: ConversationTarget = {
    userId: agent.value.userId,
    conversationId: agent.value.conversationId,
  };

  return { agent: agent.value, target };
});

/** The delegation call the path names, or not found for one that is no call id. */
const callNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  call: string,
): Effect.fn.Return<string, HostedRefusal> {
  const read = readEither(agentCallIdSchema)(unparsedWire(call));

  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return read.success;
});

/** The cursor a read names, or none; refused where it names something else. */
const cursorNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  after: string | undefined,
): Effect.fn.Return<string | undefined, HostedRefusal> {
  if (after === undefined) return undefined;
  const read = readEither(agentCursorSchema)(unparsedWire(after));

  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

  return read.success;
});

/** Where a read back from the end names it reads below, or none for the newest page; refused where it names something else. */
const beforeNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  before: string | undefined,
): Effect.fn.Return<number | undefined, HostedRefusal> {
  if (before === undefined) return undefined;
  const read = readEither(agentBeforeSchema)(unparsedWire(before));
  const seq = Result.isFailure(read) ? Number.NaN : Number(read.success);

  if (!Number.isSafeInteger(seq)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

  return seq;
});

/**
 * Whether the agent's owner's titles are told by a model, which may land
 * after its turn ends: only where the owner saved an API key, which the
 * title model runs on (`coder-host/model.ts`). Without one a title is the
 * opening's first words, written as the words are received, so no read
 * waits on it.
 */
const titledByModel = (parent: ConversationTarget) =>
  Effect.map(
    listProviderKeyRows(parent.userId, PROVIDER_KEY_KIND.API_KEY),
    (rows) => rows.length > 0,
  );

/**
 * What a read of an ended agent, or of its worker, waits on for a title:
 * the worker named, or the agent's own or any of its workers' where none
 * is; nothing for an owner whose titles no model tells (`titledByModel`).
 */
function titleAwaitedOf(parent: ConversationTarget, childConversationId?: string): TitleAwaited {
  return Effect.flatMap(titledByModel(parent), (byModel) =>
    byModel ? titleMayLand(parent, childConversationId) : NO_TITLE_AWAITED,
  );
}

/**
 * A page's messages as the wire declares them: each part the stored JSON
 * the row holds, which the SDK's own types describe more narrowly than the
 * wire's verbatim JSON does.
 */
function wireMessages(
  messages: TranscriptPage["messages"] | readonly AgentTranscriptMessage[],
  cut: boolean,
): AgentMessagesAnswer["messages"] {
  // SAFETY: every part and metadata is the JSON its row stored (`storedObjectSchema`), which the SDK's part types only name more narrowly.
  const stored = messages as AgentMessagesAnswer["messages"];

  return cut ? stored.map(cutMessage) : stored;
}

/** Whether a transcript read asks its heavy parts cut (`TRANSCRIPT_PARTS_QUERY`). */
function readsCut(parts: string | undefined): boolean {
  return parts === TRANSCRIPT_PARTS_QUERY.CUT;
}

/** A part's index as its path segment spells it, or not found for one that is no index. */
const indexNamed = /* @__PURE__ */ Effect.fnUntraced(function* (
  index: string,
): Effect.fn.Return<number, HostedRefusal> {
  if (!/^\d{1,6}$/u.test(index)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  return Number(index);
});

/** One part of a message of the conversation, whole, or not found where none stands at the index. */
const partAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  target: ConversationTarget,
  message: string,
  index: string,
) {
  const messageId = yield* pathUuid(message);
  const at = yield* indexNamed(index);
  const part = yield* hostedStoreOrUnavailable(wholePartOf(target, CODER_TOOL_SET, messageId, at));

  if (Option.isNone(part) || !isRecord(part.value)) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }

  const answer: AgentPartAnswer = { part: part.value };

  return answer;
});

/** When the window of every title `titleAwaitedOf` waits on closes, on the same terms: none where no model tells the owner's titles. */
function titleEdgeOf(parent: ConversationTarget, childConversationId?: string): TitleEdge {
  return Effect.flatMap(titledByModel(parent), (byModel) =>
    byModel ? titleWindowEdge(parent, childConversationId) : NO_TITLE_EDGE,
  );
}

/** Whether a transcript read asks for the page at once rather than held, as a reader following its live statements does (`live-wire.ts`). */
function readsNow(wait: string | undefined): boolean {
  return wait === TRANSCRIPT_NOW_QUERY.NONE;
}

/** A page of an agent's or a worker's transcript as the wire answers it, with whether the held read would have held on it where it was read at once, and how soon the clock alone may end that hold. */
function transcriptAnswer(
  page: TranscriptPage,
  title: string | null,
  cut: boolean,
  holds?: boolean,
  wakeIn?: number,
): AgentMessagesAnswer & { readonly holds?: boolean; readonly wakeIn?: number } {
  return {
    ...(holds === undefined ? undefined : { holds }),
    ...(wakeIn === undefined ? undefined : { wakeIn }),
    messages: wireMessages(page.messages, cut),
    cursor: cursorToWire(page.cursor),
    status: page.status,
    ...(page.runStartedAt === undefined ? undefined : { runStartedAt: page.runStartedAt }),
    ...(page.delegations === undefined ? undefined : { delegations: page.delegations }),
    ...(page.subagentTitles === undefined ? undefined : { subagentTitles: page.subagentTitles }),
    ...(page.subagents === undefined ? undefined : { subagents: page.subagents }),
    title,
    ...(page.failureReason === undefined ? undefined : { failureReason: page.failureReason }),
    ...(page.hostLost === undefined ? undefined : { hostLost: page.hostLost }),
    ...(page.usage === undefined ? undefined : { usage: page.usage }),
    ...(page.context === undefined ? undefined : { context: page.context }),
    ...(page.queue === undefined ? undefined : { queue: page.queue }),
    ...(page.launch === undefined ? undefined : { launch: page.launch }),
    ...(page.launchUnstarted === undefined ? undefined : { launchUnstarted: page.launchUnstarted }),
    ...(page.boot === undefined ? undefined : { boot: page.boot }),
  };
}

/**
 * The voice calls standing on the agent as its own page names them, read for
 * the member reading it, after the page, so a call that opened while a held
 * read waited is named on the page that ends the hold; nothing while none
 * stands.
 */
const standingCallsOf = (userId: string, agentId: string) =>
  Effect.map(listStandingVoiceCalls(userId, agentId), (rows) =>
    rows.length === 0
      ? undefined
      : {
          calls: rows.map((row) => ({
            callId: row.id,
            callerId: row.callerId,
            startedAt: row.startedAt.getTime(),
          })),
        },
  );

/** A transcript's newest page as the wire answers it, with where the page before it is read below. */
function newestAnswer(
  newest: TranscriptNewest,
  title: string | null,
  cut: boolean,
): AgentNewestAnswer {
  return {
    ...transcriptAnswer(newest.page, title, cut),
    ...(newest.before === undefined ? undefined : { before: String(newest.before) }),
  };
}

/** An older page of a transcript as the wire answers it. */
function olderAnswer(older: TranscriptOlder, cut: boolean): AgentOlderAnswer {
  return {
    messages: wireMessages(older.messages, cut),
    ...(older.before === undefined ? undefined : { before: String(older.before) }),
  };
}

/**
 * The id a chat send's message stands under: the one minted for it where
 * this send wrote it or queued it, or, for a send repeated under its key,
 * the one the chat holds under that key. A key a send of no chat message
 * wrote holds none, which the send is refused for.
 */
const chatMessageIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agentId: string,
  clientKey: string,
  sent: { readonly outcome: SteerWritten["outcome"]; readonly minted: string },
) {
  if (sent.outcome !== STEER_OUTCOME.REPEATED) return sent.minted;

  const landed = yield* hostedStoreOrUnavailable(
    readManagerChatMessageByKey(userId, agentId, clientKey),
  );

  if (Option.isNone(landed)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

  return landed.value.id;
});

/** A detailed input whose body's words run past the bound, whatever else it carries: refused as too long rather than as a body that does not read. */
const isTooLong = Schema.is(
  Schema.Struct({
    body: Schema.Struct({
      text: Schema.String.check(
        Schema.makeFilter((text: string) => text.trim().length > AGENT_BOUNDS.MAX_MESSAGE_CHARS),
      ),
    }),
  }),
);

/**
 * A message its schema refused because its words run past the bound is
 * refused as too long; any other refusal of
 * its shape stands. Note that this runs before the input is validated, so
 * it sees the refusal and the body as it came.
 */
const tooLongMiddleware = middlewareGen<HostedContext>(function* ({ next }, input) {
  return yield* next().pipe(
    Effect.catchIf(
      (failure) =>
        failure instanceof ORPCError && failure.code === ORPC_BAD_REQUEST && isTooLong(input),
      () => Effect.fail(HOSTED_REFUSAL.MESSAGE_TOO_LONG),
    ),
  );
});

/** The messages resource: its five held reads, the two transcripts read back from their end, the two writes on their paths, and the two part reads, each to a signed-in caller. */
export function messagesProcedures(seams: MessagesProcedureSeams) {
  const signedIn = hosted.messages.use(accountMiddleware(seams.resolveUserId));
  // The two transcript reads that hold on `wait` read the session as a held read (`heldReadMiddleware`).
  const held = hosted.messages.use(heldReadMiddleware).use(accountMiddleware(seams.resolveUserId));
  const writer = storeWriter({ tools: CODER_TOOL_SET });

  return {
    agent: held.agent.effect(function* ({ input, context }) {
      const after = (yield* cursorNamed(input.after)) ?? AGENT_CURSOR_START;
      const { agent, target } = yield* reachedAgent(context.userId, input.id);
      const titleAwaited = titleAwaitedOf(target);
      const cursor = cursorOfWire(after);
      const standing = { createdAt: agent.createdAt, blank: startedBlank(agent) };
      // Note that a cursor read before the transcript's last rewind is answered at once, never held, since its reader reads afresh.
      const rewound = yield* hostedStoreOrUnavailable(readRewoundRevision(target));
      const stale = rewound !== undefined && cursor.revision < rewound;

      const { page, holds, wakeIn } =
        readsNow(input.wait) || stale
          ? yield* hostedStoreOrUnavailable(
              transcriptNow(
                target,
                CODER_TOOL_SET,
                cursor,
                standing,
                agent,
                titleAwaited,
                titleEdgeOf(target),
              ),
            )
          : {
              page: yield* hostedStoreOrUnavailable(
                transcriptPast(
                  target,
                  CODER_TOOL_SET,
                  cursor,
                  standing,
                  agent,
                  titleAwaited,
                  titleEdgeOf(target),
                ),
              ),
              holds: undefined,
              wakeIn: undefined,
            };

      // The title is read after the page, since it lands after a turn ends, which a held read may span.
      const titled = yield* hostedStoreOrUnavailable(readAgent(context.userId, agent.id));
      const calls = yield* hostedStoreOrUnavailable(standingCallsOf(context.userId, agent.id));

      return {
        ...transcriptAnswer(
          page,
          Option.match(titled, {
            onNone: () => agent.title,
            onSome: (now: Agent) => now.title,
          }),
          readsCut(input.parts),
          holds,
          wakeIn,
        ),
        ...calls,
        ...(rewound === undefined ? undefined : { rewound }),
      };
    }),

    send: hosted.messages
      .use(accountMiddleware(seams.resolveUserId))
      .use(tooLongMiddleware)
      .send.effect(function* ({ input, context }) {
        const { agent } = yield* reachedAgent(context.userId, input.params.id);
        const { retry, channel, delegationId, lines, ...words } = input.body;
        const metadata = spokenLineMetadata({ channel, delegationId });
        const spoken = metadata === undefined ? words : { ...words, metadata };
        // A delegation starts its turn on the caller's lines already recorded, rather than writing its words again.
        const line = lines === undefined ? spoken : { ...spoken, adopts: lines };

        const { txid, outcome } = yield* steerMemberWords(
          writer,
          context.userId,
          agent,
          line,
          retry === true,
        );

        const summary = yield* summaryOf(context.userId, agent);

        // A message the agent's first launch holds waits in its queue, which the host draws it in at once.
        if (outcome === STEER_OUTCOME.QUEUED) {
          return { agent: summary, queued: yield* hostedStoreOrUnavailable(queueOnPage(agent.id)) };
        }

        // The transaction that wrote the line, which the host waits to see live before it confirms the send.
        return txid === undefined ? { agent: summary } : { agent: summary, txid };
      }),

    chatSend: hosted.messages
      .use(accountMiddleware(seams.resolveUserId))
      .use(tooLongMiddleware)
      .chatSend.effect(function* ({ input, context }) {
        const { agent } = yield* reachedAgent(context.userId, input.params.id);
        const { retry, threadRoot, ...words } = input.body;
        const sender = { kind: MESSAGE_SENDER.MEMBER, userId: context.userId } as const;
        const chat = yield* chatOfLine(context.userId, agent, { sender }, threadRoot);

        // Note that only a Manager keeps a chat, so any other agent names none.
        if (chat === undefined) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

        const { txid, outcome } = yield* steerMemberWords(
          writer,
          context.userId,
          agent,
          { ...words, chat },
          retry === true,
        );

        const messageId = yield* chatMessageIdOf(context.userId, agent.id, words.clientKey, {
          outcome,
          minted: chat.id,
        });

        const summary = yield* summaryOf(context.userId, agent);

        // A message the Manager's first launch holds waits in its queue, and lands in the chat as the queue hands it on.
        if (outcome === STEER_OUTCOME.QUEUED) {
          const queued = yield* hostedStoreOrUnavailable(queueOnPage(agent.id));

          return { agent: summary, queued, messageId };
        }

        return txid === undefined
          ? { agent: summary, messageId }
          : { agent: summary, txid, messageId };
      }),

    chatReact: hosted.messages
      .use(accountMiddleware(seams.resolveUserId))
      .chatReact.effect(function* ({ input, context }) {
        const { agent } = yield* reachedAgent(context.userId, input.params.id);

        // Note that a reaction takes the reach a message to the chat takes, though it opens no turn: the member writes to the agent its payer funds.
        if (agent.kind !== AGENT_KIND.MANAGER) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

        if (!controlsAgent(context.userId, agent)) {
          return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
        }

        yield* admitsPlanWriter(context.userId, agent);

        const outcome = yield* hostedStoreOrUnavailable(
          reactManagerChat(context.userId, {
            agentId: agent.id,
            messageId: input.params.message,
            by: MANAGER_CHAT_AUTHOR.PERSON,
            kind: input.body.kind,
            reacted: input.body.reacted,
            now: yield* DateTime.nowAsDate,
          }),
        );

        if (outcome.status === MANAGER_CHAT_REACTION_OUTCOME.NO_MESSAGE) {
          return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
        }

        return { changed: outcome.changed };
      }),

    recordVoiceLine: hosted.messages
      .use(accountMiddleware(seams.resolveUserId))
      .recordVoiceLine.effect(function* ({ input, context }) {
        const { agent, target } = yield* reachedAgent(context.userId, input.params.id);

        // A line of a call is the caller's words to the agent, so it takes the reach a typed message takes:
        // an agent on its starter's own GitHub token, or on its starter's Mac, takes words from its starter alone.
        if (!controlsAgent(context.userId, agent)) {
          return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
        }

        yield* admitsPlanWriter(context.userId, agent);
        const { id, callId, speaker, text } = input.body;

        const written = yield* hostedStoreOrUnavailable(
          Effect.flatMap(writer, (write) =>
            write.recordVoiceLine(target, {
              key: id,
              callId,
              speaker,
              text,
              sender: { kind: MESSAGE_SENDER.MEMBER, userId: context.userId },
            }),
          ),
        );

        if (Result.isFailure(written)) {
          return yield* Effect.fail(
            written.failure.refusal === STORE_WRITE_REFUSAL.NO_CONVERSATION
              ? HOSTED_REFUSAL.NOT_FOUND
              : HOSTED_REFUSAL.INVALID_REQUEST,
          );
        }

        const { txid } = written.success;

        return txid === undefined ? {} : { txid };
      }),

    queue: hosted.messages.use(accountMiddleware(seams.resolveUserId)).queue.effect(function* ({
      input,
      context,
    }) {
      const { agent } = yield* reachedAgent(context.userId, input.params.id);

      return { queue: yield* changeAgentQueue(context.userId, agent, input.body) };
    }),

    agentWorker: held.agentWorker.effect(function* ({ input, context }) {
      const after = (yield* cursorNamed(input.after)) ?? AGENT_CURSOR_START;
      const callId = yield* callNamed(input.call);
      const now = readsNow(input.wait);
      const { agent, target } = yield* reachedAgent(context.userId, input.id);
      const conversationId = childConversationId(agent.conversationId, callId);

      const read = yield* hostedStoreOrUnavailable(
        (now ? delegationNow : delegationPast)(target, conversationId, agent),
      );

      if (read.delegation === undefined) {
        if (!read.agentRuns) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

        return transcriptAnswer(
          { messages: [], cursor: cursorOfWire(after), status: AGENT_STATUS.STARTING },
          null,
          false,
          now ? true : undefined,
        );
      }

      const titleAwaited = titleAwaitedOf(target, conversationId);
      const worker = { userId: agent.userId, conversationId };
      const cursor = cursorOfWire(after);
      const started = { createdAt: read.delegation.createdAt };

      const { page, holds, wakeIn } = now
        ? yield* hostedStoreOrUnavailable(
            transcriptNow(
              worker,
              CODER_TOOL_SET,
              cursor,
              started,
              undefined,
              titleAwaited,
              titleEdgeOf(target, conversationId),
            ),
          )
        : {
            page: yield* hostedStoreOrUnavailable(
              transcriptPast(
                worker,
                CODER_TOOL_SET,
                cursor,
                started,
                undefined,
                titleAwaited,
                titleEdgeOf(target, conversationId),
              ),
            ),
            holds: undefined,
            wakeIn: undefined,
          };

      // The title is read after the page, since it lands beside the worker's start, which a held read may span.
      const titles = yield* hostedStoreOrUnavailable(childTitlesOf(target, [conversationId]));

      return transcriptAnswer(
        page,
        titles.get(conversationId) ?? null,
        readsCut(input.parts),
        holds,
        wakeIn,
      );
    }),

    agentPart: signedIn.agentPart.effect(function* ({ input, context }) {
      const { target } = yield* reachedAgent(context.userId, input.id);

      return yield* partAnswer(target, input.message, input.index);
    }),

    agentWorkerPart: signedIn.agentWorkerPart.effect(function* ({ input, context }) {
      const callId = yield* callNamed(input.call);
      const { agent } = yield* reachedAgent(context.userId, input.id);

      const worker = {
        userId: agent.userId,
        conversationId: childConversationId(agent.conversationId, callId),
      };

      return yield* partAnswer(worker, input.message, input.index);
    }),

    agentNewest: signedIn.agentNewest.effect(function* ({ input, context }) {
      const before = yield* beforeNamed(input.before);
      const { agent, target } = yield* reachedAgent(context.userId, input.id);

      if (before !== undefined) {
        return olderAnswer(
          yield* hostedStoreOrUnavailable(transcriptBefore(target, CODER_TOOL_SET, before)),
          readsCut(input.parts),
        );
      }

      const standing = { createdAt: agent.createdAt, blank: startedBlank(agent) };

      // The title and the calls are read after the page's rows, as the forward read's are, so one that landed while the rows were read is told rather than lost to a follow that starts after it.
      const afterRows = (gate: ReadGate) =>
        Effect.all(
          {
            titled: gate(readAgent(context.userId, agent.id)),
            calls: gate(standingCallsOf(context.userId, agent.id)),
          },
          { concurrency: "unbounded" },
        );

      const newest = yield* hostedStoreOrUnavailable(
        transcriptNewest(target, CODER_TOOL_SET, standing, afterRows, agent),
      );

      const { rewound } = newest;
      const { titled, calls } = newest.afterRows;

      return {
        ...newestAnswer(
          newest,
          Option.match(titled, { onNone: () => agent.title, onSome: (now) => now.title }),
          readsCut(input.parts),
        ),
        ...calls,
        ...(rewound === undefined ? undefined : { rewound }),
      };
    }),

    agentWorkerNewest: signedIn.agentWorkerNewest.effect(function* ({ input, context }) {
      const before = yield* beforeNamed(input.before);
      const callId = yield* callNamed(input.call);
      const { agent, target } = yield* reachedAgent(context.userId, input.id);
      const conversationId = childConversationId(agent.conversationId, callId);
      const read = yield* hostedStoreOrUnavailable(delegationNow(target, conversationId, agent));

      if (read.delegation === undefined) {
        if (!read.agentRuns) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

        // The call's record has not landed yet, so its worker has written nothing.
        if (before !== undefined) return olderAnswer({ messages: [] }, false);

        return newestAnswer(
          {
            page: {
              messages: [],
              cursor: cursorOfWire(AGENT_CURSOR_START),
              status: AGENT_STATUS.STARTING,
            },
          },
          null,
          false,
        );
      }

      const worker = { userId: agent.userId, conversationId };

      if (before !== undefined) {
        return olderAnswer(
          yield* hostedStoreOrUnavailable(transcriptBefore(worker, CODER_TOOL_SET, before)),
          readsCut(input.parts),
        );
      }

      const started = { createdAt: read.delegation.createdAt };

      // The title is read after the page's rows, since it lands beside the worker's start, which the page's reads may span.
      const newest = yield* hostedStoreOrUnavailable(
        transcriptNewest(worker, CODER_TOOL_SET, started, (gate) =>
          gate(childTitlesOf(target, [conversationId])),
        ),
      );

      const title = newest.afterRows.get(conversationId) ?? null;

      return newestAnswer(newest, title, readsCut(input.parts));
    }),
  };
}
