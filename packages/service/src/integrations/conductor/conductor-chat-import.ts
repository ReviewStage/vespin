/**
 * conductor-chat-import.ts -- one Conductor chat written as a finished agent with its whole transcript.
 *
 * A chat's stored records are the developer's messages and the events its
 * harness emitted, each kept whole (`conductor-client.ts`). A Claude Code
 * chat's events are the Agent SDK's own messages, which `claudeCodeMoments`
 * reads as a live runner's are read; a Codex chat's carry app-server items
 * in an envelope of Conductor's, which is rewritten to the notification
 * `codexMoments` reads. The moments are folded by the one projection
 * (`native-projection.ts`) into the store writer's events, as a live run's
 * are, so an import draws the words, reasoning, and calls a live run draws.
 *
 * The chat is split into turns at each of the developer's messages: each
 * message is written as the line its turn takes, then the turn's events,
 * each stamped with the instant Conductor received it, and the turn ends
 * succeeded. Only what the transcript draws is kept: a harness's sessions,
 * results, usage, limits, and plan are moments of a run that never ran
 * here, so an imported turn neither fails, meters, nor waits on any of them.
 * A picture the developer sent the harness inline is kept beside the
 * conversation as a line's attached image; any other picture is the
 * stand-in a live run keeps.
 *
 * No model is called. The agent is made under the chat's id as its Start's
 * key, and its source is recorded only once its whole transcript is
 * written: an import run again answers a finished agent as it stands, and
 * discards and writes again one a run left unfinished. Its conversation is
 * marked as a transcript with no session behind it
 * (`NATIVE_SESSION.REPLAY`), so its first launch hands the model its steps
 * afresh.
 */

import {
  archiveAgent,
  createAgent,
  discardAgent,
  NATIVE_SESSION,
  recordAgentNativeSession,
  recordAgentSource,
} from "@repo/database/models/agent-store";
import type { HandedFile } from "@repo/database/models/attached-file-parts";
import { importedTurnId } from "@repo/database/models/ids";
import {
  type ConversationTarget,
  type LineSender,
  type StoreWriter,
  storeWriter,
} from "@repo/database/models/writer";
import {
  AGENT_ATTACHMENT_TYPE,
  AGENT_MACHINE,
  AGENT_SOURCE,
  type AgentAttachment,
  MESSAGE_SENDER,
  type StoredAgentSource,
} from "@repo/features/agent-wire";
import type { ModelChoice } from "@repo/features/models-wire";
import { type WireValue, WireValueSchema } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { Clock, Data, Effect, Option, Result, Schema } from "effect";
import { keptHandedImages } from "../../agents/attached-files.js";
import {
  agentRuntimeChoice,
  modelRuntimeOf,
} from "../../agents/coder-host/agent-runtime-choice.js";
import { CODER_TOOL_SET } from "../../agents/coder-host/tool-set.js";
import { claudeCodeMoments } from "../../agents/native-events/claude-code-moments.js";
import { codexMoments } from "../../agents/native-events/codex-moments.js";
import {
  NATIVE_ENDING,
  NATIVE_MOMENT,
  type NativeHeld,
  type NativeMoment,
} from "../../agents/native-events/native-moments.js";
import {
  NATIVE_WRITE,
  type NativeProjection,
  type NativeWrite,
  projectMoments,
} from "../../agents/native-events/native-projection.js";
import { PICTURE_STAND_IN } from "../../agents/native-events/runner-moments.js";
import { type RunEvent, TURN_ORIGIN } from "../../core.js";
import { type OfferedModel, providerModelOf } from "../../providers/model-catalog.js";
import {
  CONDUCTOR_MESSAGE_TYPE,
  type ConductorAgentMessage,
  type ConductorChat,
  type ConductorMessage,
  type ConductorUserMessage,
  type ConductorWorkspace,
} from "./conductor-client.js";

/**
 * The moments an imported transcript keeps: what the transcript draws. Note
 * that a session, a result, usage, a limit, or the plan is a moment of a run
 * on a harness that never ran here, so none of them is folded: an imported
 * turn ends as the line it took was answered, and costs nothing here.
 */
const KEPT_MOMENTS: ReadonlySet<NativeMoment["kind"]> = new Set([
  NATIVE_MOMENT.ACTIVE,
  NATIVE_MOMENT.STEP,
  NATIVE_MOMENT.STEP_CLOSED,
  NATIVE_MOMENT.TEXT_DELTA,
  NATIVE_MOMENT.TEXT,
  NATIVE_MOMENT.REASONING,
  NATIVE_MOMENT.TOOL_STARTED,
  NATIVE_MOMENT.TOOL_SETTLED,
  NATIVE_MOMENT.SUBAGENT_RUNNING,
  NATIVE_MOMENT.SUBAGENT_ENDED,
  NATIVE_MOMENT.COMPACTED,
]);

/** Conductor's names for the Codex events it keeps, each with the app-server notification that carries the same item. */
const CODEX_EVENT_METHOD: ReadonlyMap<string, string> = new Map([
  ["item.started", "item/started"],
  ["item.completed", "item/completed"],
  ["turn.started", "turn/started"],
  ["turn.completed", "turn/completed"],
]);

/** The launch an imported turn names: none ran it. */
const NO_LAUNCH = 0;

/** A Codex event as Conductor keeps it: the event, with its type and the rest of its fields, under the thread it ran on. */
const readCodexEnvelope = Schema.decodeUnknownOption(
  Schema.Struct({
    event: Schema.Record(Schema.String, WireValueSchema),
    thread_id: Schema.optionalKey(Schema.String),
  }),
);

const readEventType = Schema.decodeUnknownOption(Schema.Struct({ type: Schema.String }));

/** A Claude Code user message's blocks, where its content is blocks rather than words. */
const readUserBlocks = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal("user"),
    message: Schema.Struct({ content: Schema.Array(Schema.Unknown) }),
  }),
);

const readImageBlock = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.Literal("image"), source: Schema.Unknown }),
);

/** An image block's bytes as the SDK documents them inline: base64 of a media type named. */
const readInlineImage = Schema.decodeUnknownOption(
  Schema.Struct({
    type: Schema.Literal("base64"),
    media_type: Schema.String,
    data: Schema.String,
  }),
);

/** The media types a conversation keeps a picture under, by the SDK's name for each. */
const KEPT_IMAGE_TYPES: ReadonlyMap<string, AgentAttachment["mediaType"]> = new Map([
  [AGENT_ATTACHMENT_TYPE.PNG, AGENT_ATTACHMENT_TYPE.PNG],
  [AGENT_ATTACHMENT_TYPE.JPEG, AGENT_ATTACHMENT_TYPE.JPEG],
  [AGENT_ATTACHMENT_TYPE.WEBP, AGENT_ATTACHMENT_TYPE.WEBP],
]);

/** Why a chat could not be imported: its task is out of the account's reach, or the store refused a write, named by its step. */
class ConductorChatNotImported extends Data.TaggedError("ConductorChatNotImported")<{
  readonly step: string;
}> {}

/** What the import job hands for one chat: whose it is, where it lands, the chat and its workspace on Conductor, its records oldest first, and the models offered with the default to fall back on. */
export interface ConductorChatToImport {
  readonly userId: string;
  readonly taskId: string;
  /** The repository the agent works in, as `owner/name`; null for none. */
  readonly repository: string | null;
  readonly workspace: Pick<ConductorWorkspace, "id" | "deepLink">;
  readonly chat: ConductorChat;
  readonly messages: readonly ConductorMessage[];
  /** The models the account is offered (`offeredToAccount`), which the chat's own runs on where one of them is it. */
  readonly offered: readonly OfferedModel[];
  /** The workspace's default choice, which an agent runs on where the chat's model is not offered. */
  readonly fallback: ModelChoice;
}

/** One turn of the chat: the developer's message that opened it, none for events ahead of the first, and the harness's events after it. */
interface ChatTurn {
  readonly line: ConductorUserMessage | undefined;
  readonly events: readonly ConductorAgentMessage[];
}

/** The chat split at each of the developer's messages; events ahead of the first form a turn of no line. */
function turnsOf(messages: readonly ConductorMessage[]): readonly ChatTurn[] {
  const turns: { line: ConductorUserMessage | undefined; events: ConductorAgentMessage[] }[] = [];

  for (const message of messages) {
    if (message.type === CONDUCTOR_MESSAGE_TYPE.USER_MESSAGE) {
      turns.push({ line: message, events: [] });
      continue;
    }

    const last = turns.at(-1);

    if (last === undefined) turns.push({ line: undefined, events: [message] });
    else last.events.push(message);
  }

  return turns;
}

/**
 * The model and effort the agent runs on: the chat's own where the account
 * is offered it, matched by the catalog id or the provider's own name for
 * it, at the chat's effort where that model lists it; the fallback otherwise.
 */
function choiceOf(chat: ConductorChat, offered: readonly OfferedModel[], fallback: ModelChoice) {
  const names = [chat.resolvedModel, chat.model].filter((name) => name != null);

  const model = offered.find(
    (candidate) =>
      names.includes(candidate.id) ||
      names.includes(providerModelOf(candidate.id)?.modelId ?? candidate.id),
  );

  if (model === undefined || chat.effort == null || !model.efforts.includes(chat.effort)) {
    return { model: fallback.model, effort: fallback.effort };
  }

  return { model: model.id, effort: chat.effort };
}

/** The instant Conductor received a record, in epoch milliseconds; `fallback` where it spells none. */
function instantOf(receivedAt: string, fallback: number): number {
  const at = Date.parse(receivedAt);

  return Number.isNaN(at) ? fallback : at;
}

/** A clock standing still at the instant given, which every row written under it is stamped with; it sleeps on the clock it stands in for. */
function clockAt(at: number, real: Clock.Clock): Clock.Clock {
  const nanos = BigInt(at) * 1_000_000n;

  return {
    currentTimeMillisUnsafe: () => at,
    currentTimeMillis: Effect.succeed(at),
    currentTimeNanosUnsafe: () => nanos,
    currentTimeNanos: Effect.succeed(nanos),
    monotonicTimeNanosUnsafe: () => real.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: real.monotonicTimeNanos,
    sleep: (duration) => real.sleep(duration),
  };
}

/**
 * A Codex event as the app-server notification carrying the same item:
 * `item.completed` is `item/completed` with the item in its params, under
 * the thread Conductor names; nothing for an event that is not Codex's, or
 * of a kind no notification carries.
 */
function codexNotificationOf(payload: WireValue): Option.Option<WireValue> {
  return Option.flatMap(readCodexEnvelope(payload), ({ event, thread_id }) =>
    Option.flatMap(readEventType(event), ({ type }) => {
      const method = CODEX_EVENT_METHOD.get(type);

      if (method === undefined) return Option.none();
      const { type: _type, ...params } = event;

      return Option.some({
        method,
        params: thread_id === undefined ? params : { ...params, threadId: thread_id },
      });
    }),
  );
}

/** The pictures one message sent: those a conversation keeps, and how many others stand in. */
interface SentPictures {
  readonly files: readonly AgentAttachment[];
  readonly others: number;
}

/** One harness event as an import reads it: its moments of the kinds kept, and the Codex thread it ran on, where it names one. */
interface ReadEvent {
  readonly moments: readonly NativeMoment[];
  readonly thread: string | undefined;
}

/** One turn's writes, in the order they land, and what the projection said that no write keeps. */
interface TurnWrites {
  readonly writes: readonly NativeWrite[];
  readonly reports: readonly string[];
}

/**
 * The pictures a Claude Code user message carries beside its words, as a
 * line's attachments: each inline base64 image of a type a conversation
 * keeps, and how many others it carries, which stand in as a live run's do.
 * Note that a picture in a tool's answer is not among them, since the
 * reader keeps that answer's stand-in.
 */
function picturesOf(payload: WireValue): SentPictures {
  const files: AgentAttachment[] = [];
  let others = 0;

  const blocks = Option.match(readUserBlocks(payload), {
    onSome: (read) => read.message.content,
    onNone: () => [],
  });

  for (const block of blocks) {
    const image = readImageBlock(block);

    if (Option.isNone(image)) continue;
    const inline = readInlineImage(image.value.source);

    const mediaType = Option.isSome(inline)
      ? KEPT_IMAGE_TYPES.get(inline.value.media_type)
      : undefined;

    if (Option.isNone(inline) || mediaType === undefined || inline.value.data.length === 0) {
      others += 1;
      continue;
    }

    files.push({ name: `image-${files.length + 1}`, mediaType, data: inline.value.data });
  }

  return { files, others };
}

/** The moments of one harness event, read by its harness's reader, of the kinds an import keeps. */
function momentsOf(payload: WireValue, held: NativeHeld): ReadEvent {
  const codex = codexNotificationOf(payload);

  const read = Option.isSome(codex)
    ? codexMoments(codex.value, held)
    : claudeCodeMoments(payload, held);

  const thread = Option.getOrUndefined(readCodexEnvelope(payload))?.thread_id;

  return { moments: read.filter((moment) => KEPT_MOMENTS.has(moment.kind)), thread };
}

/** A writer's answer, or the import failed at the step named where the writer refused it. */
function landed<A, E>(step: string, result: Result.Result<A, E>) {
  return Result.isFailure(result)
    ? Effect.fail(new ConductorChatNotImported({ step }))
    : Effect.void;
}

/** What the projection holds across the chat's turns: its state, the next event's number, and the Codex thread the chat runs on, which a subagent's thread is told apart from. */
interface Folding {
  state: NativeProjection;
  sequence: number;
  thread: string | undefined;
}

/**
 * One turn's writes, in the order they land: the turn queued under its own
 * id, its line taken where it has one, every event of its harness's, and
 * its end, each event stamped with the instant Conductor received it.
 */
function turnWrites(
  turn: ChatTurn,
  turnId: string,
  conversationId: string,
  model: string,
  folding: Folding,
  startedAt: number,
): TurnWrites {
  const writes: NativeWrite[] = [];
  const reports: string[] = [];
  let at = startedAt;

  const fold = (moments: readonly NativeMoment[]) => {
    folding.sequence += 1;

    const projected = projectMoments(folding.state, moments, {
      conversationId,
      sequence: folding.sequence,
      now: at,
      attempt: NO_LAUNCH,
      queuedTurnId: turnId,
      model,
      ownKey: false,
      registered: (name) => Object.hasOwn(CODER_TOOL_SET, name),
      report: (said) => reports.push(said),
    });

    folding.state = projected.state;
    writes.push(...projected.writes);
  };

  fold(
    turn.line === undefined
      ? [{ kind: NATIVE_MOMENT.ACTIVE }]
      : [{ kind: NATIVE_MOMENT.LINE_ACCEPTED, clientId: sentLineId(turn.line.id) }],
  );

  for (const event of turn.events) {
    at = instantOf(event.receivedAt, at);

    const held: NativeHeld = {
      callName: (callId) => folding.state.turn?.calls[callId],
      session: folding.thread,
      sequence: folding.sequence + 1,
      planLimited: false,
    };

    const { moments, thread } = momentsOf(event.content.rawPayload, held);
    folding.thread ??= thread;
    fold(moments);
  }

  fold([{ kind: NATIVE_MOMENT.ENDED, ending: NATIVE_ENDING.DONE }]);

  return { writes, reports };
}

/**
 * Lands one turn's writes through the writer, in order: each run of events
 * as one batch, and the turn's queueing and its line's taking where the
 * projection asks for them. Anything else it asks, a session or a failure,
 * is no write an import makes.
 */
function landWrites(
  writer: StoreWriter,
  target: ConversationTarget,
  writes: readonly NativeWrite[],
  model: string,
  effort: string,
  step: string,
) {
  return Effect.gen(function* () {
    let events: RunEvent[] = [];

    const flush = Effect.gen(function* () {
      if (events.length === 0) return;
      const batch = events;
      events = [];

      for (const result of yield* writer.consumeAll(target, batch)) yield* landed(step, result);
    });

    for (const write of writes) {
      switch (write.kind) {
        case NATIVE_WRITE.EVENT:
          events.push(write.event);
          continue;
        case NATIVE_WRITE.ENQUEUE:
          yield* flush;
          yield* landed(
            step,
            yield* writer.enqueueTurn(target, {
              turnId: write.turnId,
              runtimeTurnId: write.turnId,
              origin: TURN_ORIGIN.TYPED,
              model,
              reasoningEffort: effort,
            }),
          );
          continue;
        case NATIVE_WRITE.TAKE_LINE:
          yield* flush;
          yield* landed(
            step,
            yield* writer.takeAwaitingLine(target, {
              clientId: write.clientId,
              turnId: write.turnId,
            }),
          );
          continue;
        default:
          continue;
      }
    }

    yield* flush;
  });
}

/**
 * One turn written: the developer's line awaiting it, with the pictures
 * they sent beside it, then the turn's writes, all stamped with the instant
 * the line was received.
 */
function writeTurn(
  writer: StoreWriter,
  target: ConversationTarget,
  turn: ChatTurn,
  choice: { readonly model: string; readonly effort: string },
  folding: Folding,
) {
  return Effect.gen(function* () {
    const real = yield* Clock.Clock;
    const now = real.currentTimeMillisUnsafe();
    const opening = turn.line ?? turn.events[0];

    if (opening === undefined) return;
    const startedAt = instantOf(opening.receivedAt, now);
    const turnId = importedTurnId(target.conversationId, opening.id);
    const step = `turn ${turnId}`;

    const write = Effect.gen(function* () {
      const line = turn.line;

      if (line !== undefined) {
        const sender: LineSender = { kind: MESSAGE_SENDER.MEMBER, userId: target.userId };
        const pictures = turn.events.map((event) => picturesOf(event.content.rawPayload));
        const files = pictures.flatMap((each) => each.files);
        const others = pictures.reduce((total, each) => total + each.others, 0);
        const attachments: readonly HandedFile[] = yield* keptHandedImages(target, files);
        const standIns = Array.from({ length: others }, () => PICTURE_STAND_IN);
        const text = [line.content.message, ...standIns].join("\n");

        const awaiting = {
          text,
          clientKey: line.id,
          sender,
          ...(attachments.length === 0 ? undefined : { attachments }),
        };

        yield* landed(
          step,
          yield* writer.writeAwaitingLine(target, awaiting, Effect.succeed(true)),
        );
      }

      const { writes, reports } = turnWrites(
        turn,
        turnId,
        target.conversationId,
        choice.model,
        folding,
        startedAt,
      );

      for (const said of reports) {
        yield* Effect.logWarning(`conductor-chat-import: ${said}`).pipe(
          Effect.annotateLogs({ conversationId: target.conversationId }),
        );
      }

      yield* landWrites(writer, target, writes, choice.model, choice.effort, step);
    });

    yield* Effect.provideService(write, Clock.Clock, clockAt(startedAt, real));
  });
}

/** The runtime and payer the agent records: as a Start of its model would, or the model's harness with no payer where the account keeps no credential for it, whose next turn is paid for by what pays as it launches. */
function runtimeOf(userId: string, model: string) {
  return Effect.catchTag(agentRuntimeChoice(userId, model), "AgentCredentialMissing", () =>
    Effect.map(modelRuntimeOf(model), (runtime) => ({ runtime, payer: undefined })),
  );
}

/** Where the agent's transcript came from, as its row keeps it once the import finished. */
function sourceOf(chat: ConductorChatToImport): StoredAgentSource {
  return {
    kind: AGENT_SOURCE.CONDUCTOR,
    sessionId: chat.chat.id,
    workspaceId: chat.workspace.id,
    ...(chat.workspace.deepLink == null ? undefined : { url: chat.workspace.deepLink }),
  };
}

/**
 * The agent the chat is written into, made under the chat's id as its
 * Start's key: a fresh one, or the one an earlier import finished, which is
 * answered as it stands. One an earlier import left unfinished, which has
 * no source yet, is discarded with whatever of its transcript was written,
 * and made afresh.
 */
const startedAgent = Effect.fnUntraced(function* (chat: ConductorChatToImport) {
  const choice = choiceOf(chat.chat, chat.offered, chat.fallback);
  const { runtime, payer } = yield* runtimeOf(chat.userId, choice.model);

  const start = createAgent(chat.userId, {
    taskId: chat.taskId,
    descriptionSnapshot: null,
    prompt: null,
    idempotencyKey: chat.chat.id,
    model: choice.model,
    effort: choice.effort,
    repository: chat.repository,
    title: chat.chat.name ?? undefined,
    runtime,
    payer,
    machine: AGENT_MACHINE.VERCEL,
  });

  const first = yield* start;
  const unfinished = Option.filter(first, ({ agent, created }) => !created && agent.source == null);

  if (Option.isSome(unfinished)) {
    const { agent } = unfinished.value;
    yield* discardAgent(agent.userId, agent.id);
  }

  const started = Option.isSome(unfinished) ? yield* start : first;

  if (Option.isNone(started)) {
    return yield* Effect.fail(new ConductorChatNotImported({ step: "agent" }));
  }

  return { ...started.value, choice };
});

/**
 * Writes one Conductor chat as a finished agent on the task given, its
 * whole transcript in turns as the chat ran them, archived where the chat
 * was, and answers it with whether this import wrote it. The import is all
 * or nothing as a later run sees it: the agent's source is recorded last,
 * so a run that died partway leaves an agent with none, which the next run
 * discards and writes again, and a chat this account imported whole
 * answers the agent that import made and writes nothing. Note that the
 * writes are not one transaction, because a line is written under its
 * conversation's dispatch claim, which runs with no transaction open
 * (`dispatch-claim.ts`). The records are handed in already read, from the
 * API or an export alike.
 */
export const importConductorChat = Effect.fnUntraced(function* (chat: ConductorChatToImport) {
  const { agent, created, choice } = yield* startedAgent(chat);

  if (!created) return { agent, created };
  const target: ConversationTarget = { userId: agent.userId, conversationId: agent.conversationId };
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  const folding: Folding = { state: {}, sequence: 0, thread: undefined };

  for (const turn of turnsOf(chat.messages)) {
    yield* writeTurn(writer, target, turn, choice, folding);
  }

  yield* recordAgentNativeSession(agent.userId, agent.id, NATIVE_SESSION.REPLAY);

  if (chat.chat.archivedAt != null) yield* archiveAgent(agent.userId, agent.id, true);
  const finished = yield* recordAgentSource(agent.userId, agent.id, sourceOf(chat));

  if (Option.isNone(finished)) {
    return yield* Effect.fail(new ConductorChatNotImported({ step: "source" }));
  }

  return { agent: finished.value, created };
});
