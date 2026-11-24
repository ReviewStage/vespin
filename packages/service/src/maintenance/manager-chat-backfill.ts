/**
 * manager-chat-backfill.ts -- every Manager's chat from before its rows were written, copied once from its transcript into `manager_chat_message`.
 *
 * A Manager's chat is its rows now, written as each message is sent, but
 * the chats from before those writers shipped stand only in transcripts.
 * So each Manager's transcript is read whole and cut into its chat by
 * today's derivation one last time (`managerChatLines`): a person's line
 * becomes their message, on its line and with the turn it opened or
 * steered; each `send_to_user` call and each set `show_media` showed, the
 * Manager's own, with the turn that sent it; and each line said on a call,
 * the caller's or the voice's. The model writes what is missing and keeps
 * what already stands (`backfillManagerChat`), so a message written live
 * is never written twice and a run again writes nothing.
 *
 * A message's time is the source's: a line's send, a voice line's start,
 * and for the Manager's own, the start of the turn that sent it, its last
 * the turn's end, held to no earlier than the message before it, since the
 * transcript keeps no time per call. A call whose answer has not landed in
 * a turn still running is left to the live write it is making.
 *
 * It is asked by hand, `POST /api/maintenance/manager-chat-backfill` under
 * the deployment's own `CRON_SECRET` (`scripts/backfill-manager-chats.sh`),
 * a batch of Managers at a time; `dry=1` writes nothing and answers what a
 * run would do. The answer is counts alone: no account, no Manager, and no
 * word of any chat is named.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  backfillManagerChat,
  listManagersForBackfill,
  type ManagerChatBackfilled,
  type ManagerChatBackfillMessage,
  type ManagerOfBackfill,
} from "@repo/database/models/manager-chat-messages";
import { listMessagesFrom, type StoredMessageRecord } from "@repo/database/models/message-reads";
import { readNativeCallKeys } from "@repo/database/models/native-call-keys";
import { AGENT_PART, type AgentPart, agentParts, messageWords } from "@repo/features/agent-parts";
import { AGENT_TOOL, isShowMediaTool } from "@repo/features/agent-tools";
import { AGENT_SENDER, type AgentTranscriptMessage } from "@repo/features/agent-wire";
import { managerChatLines } from "@repo/features/manager-chat";
import { MANAGER_CHAT_AUTHOR, type ManagerChatAttachment } from "@repo/features/manager-chat-live";
import { messageFileChips } from "@repo/features/message-files";
import { agentName } from "@repo/features/model-label";
import { isVoiceLine, spokenLineOf } from "@repo/features/voice-call-lines";
import { isRecord, isWireString, MESSAGE_ROLE, type WireValue } from "@repo/wire";
import { Effect, Option, type Redacted } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { type TranscriptMessage, transcriptMessagesOf } from "../agents/coder-host/transcript.js";
import { nativeCallDigest } from "../agents/workspace-mcp/call-key.js";
import {
  bearerMatchesSecret,
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  jsonResponse,
} from "../http/http.js";
import { logStoreFailure } from "../http/store-failure.js";

/** How many Managers one request backfills by default, and at most: few enough that a batch of long chats ends well inside a function's time. */
const BACKFILL_BATCH = {
  DEFAULT: 10,
  MAX: 50,
} as const;

/** How many rows of a transcript one read takes: the store's own page. */
const TRANSCRIPT_PAGE = 200;

/** The query a request names its batch by. */
const BACKFILL_QUERY = {
  /** `1` to write nothing and answer what a run would do. */
  DRY: "dry",
  /** The Manager the batch starts past, as the last answer's `next` named it. */
  AFTER: "after",
  /** One Manager alone, to try the backfill on before a whole run. */
  AGENT: "agent",
  LIMIT: "limit",
} as const;

/** What one batch did, or would do, in counts alone. */
export interface ManagerChatBackfillCounts {
  /** Managers read. */
  readonly managers: number;
  /** Managers whose chat was, or would be, written to. */
  readonly changed: number;
  /** Managers whose transcript the vocabulary could not read, left as they were. */
  readonly unreadable: number;
  /** Managers whose read or write failed, left as they were and logged. */
  readonly failed: number;
  /** Messages a row already stood for. */
  readonly standing: number;
  /** Messages written. */
  readonly written: number;
  /** Rows given a later place so the chat reads in order. */
  readonly moved: number;
}

/** One batch's counts and the Manager the next batch starts past; none once the batch reached the last. */
export interface ManagerChatBackfillBatch extends ManagerChatBackfillCounts {
  readonly dry: boolean;
  readonly next: string | null;
}

/** What the endpoint is handed: the request, and the deployment's secret as its environment holds it. */
export interface ManagerChatBackfillOptions {
  readonly request: Request;
  readonly cronSecret: Redacted.Redacted | undefined;
}

/** How one Manager's backfill came out. */
type ManagerOutcome =
  | { readonly read: true; readonly backfilled: ManagerChatBackfilled }
  | { readonly read: false; readonly failed: boolean };

/** A tool part of a turn. */
type ToolPart = Extract<AgentPart, { readonly kind: typeof AGENT_PART.TOOL }>;

const NO_COUNTS: ManagerChatBackfillCounts = {
  managers: 0,
  changed: 0,
  unreadable: 0,
  failed: 0,
  standing: 0,
  written: 0,
  moved: 0,
};

/** Every row of the conversation, oldest first; none where a page holds a row the vocabulary cannot read. */
const wholeTranscript = (manager: ManagerOfBackfill) =>
  Effect.gen(function* () {
    const records: StoredMessageRecord[] = [];
    let from = 0;

    for (;;) {
      const read = yield* listMessagesFrom(
        manager.userId,
        manager.conversationId,
        CODER_TOOL_SET,
        from,
        TRANSCRIPT_PAGE,
      );

      if (!read.ok) return Option.none<readonly StoredMessageRecord[]>();
      records.push(...read.value);
      const last = read.value.at(-1);

      if (last === undefined || read.value.length < TRANSCRIPT_PAGE) return Option.some(records);
      from = last.seq + 1;
    }
  });

/** The transcript's rows as a page carries them, read as the wire's messages, as the transcript's route answers them (`messages-procedures.ts`'s `wireMessages`). */
function wireMessagesOf(messages: readonly TranscriptMessage[]): readonly AgentTranscriptMessage[] {
  // SAFETY: every part and metadata is the JSON its row stored (`storedObjectSchema`), which the SDK's part types only name more narrowly.
  return messages as readonly AgentTranscriptMessage[];
}

/** The words of a message's text parts, as they stand. */
function wordsOf(message: AgentTranscriptMessage): string {
  return messageWords(message).trim();
}

/** The pictures a person's line carries, by the ids they were kept as, as a person's live write keeps them. */
function lineAttachments(line: AgentTranscriptMessage): readonly ManagerChatAttachment[] {
  return messageFileChips(line).flatMap((chip) =>
    chip.pictureId === undefined ? [] : [{ id: chip.pictureId, mediaType: chip.mediaType }],
  );
}

/** The set a `show_media` call showed, each picture by its kept id with the caption it was shown under, as the live write keeps it. */
function shownAttachments(part: ToolPart): readonly ManagerChatAttachment[] {
  const pictures = isRecord(part.output) ? part.output.pictures : undefined;
  const images = isRecord(part.input) ? part.input.images : undefined;

  if (!Array.isArray(pictures)) return [];

  return pictures.flatMap((picture: WireValue, index): ManagerChatAttachment[] => {
    if (!isRecord(picture) || !isWireString(picture.id) || !isWireString(picture.mediaType)) {
      return [];
    }

    const image: WireValue | undefined = Array.isArray(images) ? images[index] : undefined;
    const caption = isRecord(image) && isWireString(image.caption) ? image.caption : undefined;

    return [
      caption === undefined
        ? { id: picture.id, mediaType: picture.mediaType }
        : { id: picture.id, mediaType: picture.mediaType, caption },
    ];
  });
}

/** The id a call's answer named the message it wrote live under; none for an answer from before the live writes. */
function answeredId(part: ToolPart): string | null {
  const id = isRecord(part.output) ? part.output.message_id : undefined;

  return isWireString(id) ? id : null;
}

/**
 * The call a turn's chat message is: the one its own part names, a set's;
 * the one its id is, every send after the turn's first; else the turn's
 * first `send_to_user` call that said its words.
 */
function callOf(said: AgentTranscriptMessage, turn: AgentTranscriptMessage): ToolPart | undefined {
  const tools = agentParts(turn).filter((part): part is ToolPart => part.kind === AGENT_PART.TOOL);
  const shown = said.parts[0];
  const named = isRecord(shown) && isWireString(shown.toolCallId) ? shown.toolCallId : said.id;
  const byId = tools.find((part) => part.callId === named);

  if (byId !== undefined) return byId;
  const words = wordsOf(said);

  return tools.find((part) => {
    const text = isRecord(part.input) ? part.input.text : undefined;

    return part.tool === AGENT_TOOL.SEND_TO_USER && isWireString(text) && text.trim() === words;
  });
}

/** What a transcript's rows are read by: each row by its id, and the turns its journals stand for, in order. */
interface TranscriptIndex {
  readonly records: ReadonlyMap<string, StoredMessageRecord>;
  readonly messages: ReadonlyMap<string, AgentTranscriptMessage>;
  /** The journal each call stands in, by the call's id. */
  readonly callJournals: ReadonlyMap<string, string>;
  /** Each journal's place in the transcript and its turn, oldest first. */
  readonly journals: readonly { readonly seq: number; readonly turnId: string }[];
}

function indexOf(
  records: readonly StoredMessageRecord[],
  messages: readonly AgentTranscriptMessage[],
): TranscriptIndex {
  const journals = records.flatMap((record, index) => {
    const message = messages[index];

    return message !== undefined &&
      message.role === MESSAGE_ROLE.ASSISTANT &&
      !isVoiceLine(message) &&
      record.turnId !== undefined
      ? [{ seq: record.seq, turnId: record.turnId }]
      : [];
  });

  const callJournals = new Map(
    messages.flatMap((message) =>
      message.role === MESSAGE_ROLE.ASSISTANT
        ? agentParts(message).flatMap((part) =>
            part.kind === AGENT_PART.TOOL ? [[part.callId, message.id] as const] : [],
          )
        : [],
    ),
  );

  return {
    records: new Map(records.map((record) => [record.id, record])),
    messages: new Map(messages.map((message) => [message.id, message])),
    callJournals,
    journals,
  };
}

/** The turn a person's line opened or steered: the one whose journal took it in under way, as its row says, else the first journal after it. */
function lineTurn(line: AgentTranscriptMessage, index: TranscriptIndex): string | null {
  // Note that the chat stands a line taken in under way out of its turn, so where it arrived is read off its row.
  const journal = index.messages.get(line.id)?.arrivedIn?.journalId;

  if (journal !== undefined) return index.records.get(journal)?.turnId ?? null;
  const seq = index.records.get(line.id)?.seq;

  if (seq === undefined) return null;

  return index.journals.find((each) => each.seq > seq)?.turnId ?? null;
}

/** The key a line is backfilled under: a call's line's own key, which its live write keyed its row by, else its row's id. */
function lineKeyOf(line: AgentTranscriptMessage): string {
  const key = isRecord(line.metadata) ? line.metadata.line_key : undefined;

  return spokenLineOf(line) !== undefined && isWireString(key) ? key : line.id;
}

/** A person's line, typed or said on a call, as their message: under their account where it names one, else the starter's for a line kept before senders were. */
function personMessage(
  manager: ManagerOfBackfill,
  line: AgentTranscriptMessage,
  index: TranscriptIndex,
): ManagerChatBackfillMessage {
  const { sentBy } = line;
  const spoken = spokenLineOf(line) !== undefined;
  const former = sentBy?.kind === AGENT_SENDER.FORMER;

  return {
    clientKey: lineKeyOf(line),
    liveId: null,
    callKey: null,
    authorKind: MANAGER_CHAT_AUTHOR.PERSON,
    authorUserId: former ? null : (sentBy?.userId ?? manager.userId),
    authorName: sentBy?.name ?? manager.starterName,
    text: wordsOf(line),
    attachments: lineAttachments(line),
    // Note that a line said on a call stands on no line and in no turn, as the call's live write keeps it.
    turnId: spoken ? null : lineTurn(line, index),
    lineId: spoken ? null : line.id,
    createdAt: new Date(line.sentAt ?? index.records.get(line.id)?.placedAt.getTime() ?? 0),
  };
}

/** The voice's line on a call as the Manager's own message, as the call's live write keeps it. */
function voiceMessage(
  manager: ManagerOfBackfill,
  line: AgentTranscriptMessage,
  index: TranscriptIndex,
): ManagerChatBackfillMessage {
  return {
    clientKey: lineKeyOf(line),
    liveId: null,
    callKey: null,
    authorKind: MANAGER_CHAT_AUTHOR.AGENT,
    authorUserId: null,
    authorName: agentName(manager),
    text: wordsOf(line),
    attachments: [],
    turnId: null,
    lineId: null,
    createdAt: new Date(line.sentAt ?? index.records.get(line.id)?.placedAt.getTime() ?? 0),
  };
}

/**
 * One of a turn's chat messages as the Manager's own: a send's words or a
 * set, keyed by its call, with the id its answer named, the turn's record,
 * and the turn's start, or its end for its last. None for a call a turn
 * still running has not answered, which its live write lands.
 */
function turnMessage(
  manager: ManagerOfBackfill,
  said: AgentTranscriptMessage,
  index: TranscriptIndex,
  callKeys: ReadonlyMap<string, string>,
): ManagerChatBackfillMessage | undefined {
  // Note that a turn's first message stands under the turn's own id, and each after it under its call's.
  const journalId = index.messages.has(said.id) ? said.id : index.callJournals.get(said.id);

  const turn = journalId === undefined ? undefined : index.messages.get(journalId);
  const record = journalId === undefined ? undefined : index.records.get(journalId);

  if (turn === undefined || record === undefined) return undefined;
  const call = callOf(said, turn);

  if (call === undefined || (call.output === undefined && record.finishedAt === undefined)) {
    return undefined;
  }

  const shown = call.tool !== AGENT_TOOL.SEND_TO_USER;

  return {
    clientKey: call.callId,
    liveId: answeredId(call),
    callKey: callKeys.get(call.callId) ?? null,
    authorKind: MANAGER_CHAT_AUTHOR.AGENT,
    authorUserId: null,
    authorName: agentName(manager),
    text: shown ? "" : wordsOf(said),
    attachments: shown ? shownAttachments(call) : [],
    turnId: record.turnId ?? null,
    lineId: null,
    createdAt: new Date(said.finishedAt ?? said.startedAt ?? record.createdAt.getTime()),
  };
}

/** Each message's time held to no earlier than the one before it, so the chat's times read down as its order does. */
function inOrder(
  planned: readonly ManagerChatBackfillMessage[],
): readonly ManagerChatBackfillMessage[] {
  let latest = 0;

  return planned.map((message) => {
    latest = Math.max(latest, message.createdAt.getTime());

    return latest === message.createdAt.getTime()
      ? message
      : { ...message, createdAt: new Date(latest) };
  });
}

/**
 * The digest each call that may stand in the chat was keyed by, by its id:
 * every `send_to_user` and `show_media` call, digested as the workspace's MCP
 * server digests a call it is handed (`nativeCallDigest`), whose key the
 * store kept for the call's live write.
 */
function chatCallDigests(messages: readonly AgentTranscriptMessage[]): ReadonlyMap<string, string> {
  return new Map(
    messages.flatMap((message) =>
      message.role === MESSAGE_ROLE.ASSISTANT
        ? agentParts(message).flatMap((part) =>
            part.kind === AGENT_PART.TOOL &&
            (part.tool === AGENT_TOOL.SEND_TO_USER || isShowMediaTool(part.tool))
              ? [[part.callId, nativeCallDigest(part.tool, part.input ?? {})] as const]
              : [],
          )
        : [],
    ),
  );
}

/** The Manager's chat as its transcript holds it, in order, cut by today's derivation (`managerChatLines`). */
export function plannedChatOf(
  manager: ManagerOfBackfill,
  records: readonly StoredMessageRecord[],
  messages: readonly AgentTranscriptMessage[],
  callKeys: ReadonlyMap<string, string>,
): readonly ManagerChatBackfillMessage[] {
  const index = indexOf(records, messages);

  const planned = managerChatLines(messages).flatMap((said) => {
    if (said.role === MESSAGE_ROLE.USER) return [personMessage(manager, said, index)];

    if (isVoiceLine(said)) return [voiceMessage(manager, said, index)];

    return turnMessage(manager, said, index, callKeys) ?? [];
  });

  // Note that a line with no words and no files says nothing, as its live write would write nothing.
  return inOrder(
    planned.filter((message) => message.text !== "" || message.attachments.length > 0),
  );
}

/** One Manager's chat backfilled from its whole transcript, or what a run would do. */
const backfillOne = (manager: ManagerOfBackfill, dry: boolean) =>
  Effect.gen(function* () {
    const records = yield* wholeTranscript(manager);

    if (Option.isNone(records)) return { read: false, failed: false } satisfies ManagerOutcome;

    const messages = wireMessagesOf(
      yield* transcriptMessagesOf(
        { userId: manager.userId, conversationId: manager.conversationId },
        records.value,
      ),
    );

    const digests = chatCallDigests(messages);

    const keys = yield* readNativeCallKeys(manager.userId, manager.conversationId, [
      ...new Set(digests.values()),
    ]);

    const callKeys = new Map(
      [...digests].flatMap(([callId, digest]) => {
        const key = keys.get(digest);

        return key === undefined ? [] : [[callId, key] as const];
      }),
    );

    const planned = plannedChatOf(manager, records.value, messages, callKeys);
    const backfilled = yield* backfillManagerChat(manager.id, planned, { dry });

    // Note that a Manager deleted since the batch was listed has no chat left to write.
    if (Option.isNone(backfilled)) return { read: false, failed: false } satisfies ManagerOutcome;

    return { read: true, backfilled: backfilled.value } satisfies ManagerOutcome;
  }).pipe(
    Effect.tapError((failure: StoreFailure) => logStoreFailure(failure)),
    Effect.orElseSucceed((): ManagerOutcome => ({ read: false, failed: true })),
  );

function counted(counts: ManagerChatBackfillCounts, outcome: ManagerOutcome) {
  const managers = counts.managers + 1;

  if (!outcome.read) {
    return outcome.failed
      ? { ...counts, managers, failed: counts.failed + 1 }
      : { ...counts, managers, unreadable: counts.unreadable + 1 };
  }

  const { standing, written, moved } = outcome.backfilled;

  return {
    ...counts,
    managers,
    changed: counts.changed + (written + moved > 0 ? 1 : 0),
    standing: counts.standing + standing,
    written: counts.written + written,
    moved: counts.moved + moved,
  };
}

/** One batch of Managers past `after`, or the one Manager named, backfilled in the order of their ids, or what a run would do. */
export function backfillManagerChats(batch: {
  readonly dry: boolean;
  readonly after: string | null;
  readonly agent: string | null;
  readonly limit: number;
}): Effect.Effect<ManagerChatBackfillBatch, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const listed = yield* listManagersForBackfill(batch);
    let counts = NO_COUNTS;

    for (const manager of listed) counts = counted(counts, yield* backfillOne(manager, batch.dry));
    const last = listed.at(-1);

    return {
      dry: batch.dry,
      ...counts,
      next:
        batch.agent !== null || listed.length < batch.limit || last === undefined ? null : last.id,
    };
  });
}

/** The batch a request names: dry or not, where it starts, one Manager alone, and how many; none for a query that spells no batch. */
function batchOf(url: URL) {
  const read = (key: string) => url.searchParams.get(key);
  const limitText = read(BACKFILL_QUERY.LIMIT);
  const limit = limitText === null ? BACKFILL_BATCH.DEFAULT : Number(limitText);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
  const after = read(BACKFILL_QUERY.AFTER);
  const agent = read(BACKFILL_QUERY.AGENT);

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > BACKFILL_BATCH.MAX) return undefined;

  if ((after !== null && !uuid.test(after)) || (agent !== null && !uuid.test(agent))) {
    return undefined;
  }

  return { dry: read(BACKFILL_QUERY.DRY) === "1", after, agent, limit };
}

/** The backfill as its endpoint answers it: a POST under the deployment's secret, answered with one batch's counts and where the next starts. */
export const handleManagerChatBackfill = /* @__PURE__ */ Effect.fn("web/handleManagerChatBackfill")(
  function* (
    options: ManagerChatBackfillOptions,
  ): Effect.fn.Return<Response, unknown, DatabaseServices> {
    const { request } = options;

    if (request.method !== "POST") {
      return errorResponse(
        HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      );
    }

    if (options.cronSecret === undefined) {
      return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
    }

    if (!bearerMatchesSecret(request, options.cronSecret)) {
      return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
    }

    const batch = batchOf(new URL(request.url));

    if (batch === undefined) {
      return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
    }

    return jsonResponse(HOSTED_HTTP_STATUS.OK, yield* backfillManagerChats(batch));
  },
);
