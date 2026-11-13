/**
 * voice-call-delegations.ts -- a voice call's delegation loop as the lease holding the call runs it: the session's events and the agent's turn in; the call's lines, the caller's requests, and the voice's context out.
 *
 * The loop itself is `@repo/features/voice-delegation`, fed unchanged: the
 * session's events as the sideband hands them, and the agent's turn as its
 * conversation shows it, through one queue, so the loop takes them in the
 * order they came. What it answers is carried out here, in that order:
 *
 * - A line of the call is recorded through the write a line of a call takes
 *   (`recordVoiceLine`), under its key, as the caller's words or the voice's,
 *   with its span on the session's clock and the event it took last.
 * - A delegation goes the way the caller's typed line goes: sent on the
 *   caller's lines it names, which opens the agent's turn on those rows
 *   rather than writing their words again (`steerMemberWords`), or queued
 *   behind the running turn (`changeAgentQueue`), under the newest line's
 *   key, so the queue hands it on as the same send. A request the service
 *   refuses is logged, and never tried again.
 * - What the voice is told goes out over the sideband (`VoiceCallHolder`'s
 *   `send`).
 *
 * Every act is fenced by the lease's epoch, read just before it, so a holder
 * whose lease another took acts no more and lets go.
 *
 * The agent's turn is followed as the panel's own live read follows it
 * (`listMessagesPast` under a Sync watch on the conversation): a turn's
 * journal standing open says the turn started, each tool call in it says
 * its progress, and the journal finished says its reply and its end. A reply
 * is told once: the call's row keeps `told_seq`, the sequence of the last
 * finished journal told, written under the lease's epoch just before the
 * reply goes to the voice, so a lease that takes the call over mid-reply
 * neither tells it again nor leaves it untold. A tool call's progress is
 * kept nowhere: a holder taking the call over counts the calls already
 * standing as told, so it never repeats one.
 *
 * A holder taking the call over keeps nothing of the one before it but
 * `told_seq`: it starts the loop from the call's stored lines, each naming
 * the key it was recorded under and the event it took last, and from the
 * delegations those lines and the agent's queue name as handed on, so the
 * few seconds the session replays to it are passed by (`voice-delegation`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { readAgentQueue } from "@repo/database/models/agent-queue-store";
import { type Agent, readAgent } from "@repo/database/models/agent-store";
import {
  latestTurnsOf,
  listCallLines,
  listMessagesPast,
  type MessageCursor,
  messageCursorNow,
  readMessageByClientId,
  type StoredMessageRecord,
} from "@repo/database/models/message-reads";
import { saveVoiceCallState, type VoiceCallRow } from "@repo/database/models/voice-calls";
import { type AwaitingLineMetadata, storeWriter } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { TOPIC } from "@repo/database/sync/notification";
import { AGENT_PART, type AgentPart, agentPart } from "@repo/features/agent-parts";
import { QUEUE_CHANGE, VOICE_SPEAKER } from "@repo/features/agent-wire";
import { toolCallView } from "@repo/features/tool-call-model";
import { callLine } from "@repo/features/turn-rows";
import {
  AGENT_TURN,
  type AgentTurnEvent,
  type StoredVoiceLine,
  VOICE_INPUT,
  VOICE_OUTPUT,
  type VoiceCallStart,
  type VoiceInput,
  type VoiceOutput,
  voiceDelegations,
} from "@repo/features/voice-delegation";
import { failureKind } from "@repo/runtime/effect";
import { hostMintedId } from "@repo/wire/host-ids";
import { Effect, Option, Queue, Result, Stream } from "effect";
import { CODER } from "../agents/coder-host/bounds.js";
import { changeAgentQueue } from "../agents/coder-host/queue-change.js";
import { spokenLineMetadata } from "../agents/coder-host/spoken-line.js";
import { steerMemberWords } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type StoredMessageMetadata,
  TURN_OPEN,
  type WireValue,
} from "../core.js";
import { Sync } from "../sync/watch.js";
import type { VoiceCallHolder, VoiceCallObserver } from "./voice-call-lease.js";

/** What a line of a call's key is minted under, apart from every other id the host mints. */
const VOICE_LINE_KIND = "voice-line";

/** The most rows one page of the conversation answers (`listMessagesPast`), a full one read on at once. */
const PAGE_ROWS = 200;

/** The conversation the agent writes in, as the account that owns it reads it. */
interface AgentTarget {
  readonly userId: string;
  readonly conversationId: string;
}

/** A line of the call's key: the call and the event its first fragment came in, so a replayed fragment opens no second line. */
function callLineKey(callId: string, eventId: string): string {
  return hostMintedId([VOICE_LINE_KIND, callId, eventId]);
}

/** A row's metadata, which a system row carries none of. */
function metadataOf(record: StoredMessageRecord): StoredMessageMetadata | undefined {
  return "metadata" in record.message ? record.message.metadata : undefined;
}

/** The voice fields a line of a call stores, none of them where its row is no such line. */
function lineFieldsOf(metadata: StoredMessageMetadata | undefined) {
  return metadata !== undefined && "line_key" in metadata ? metadata : undefined;
}

/** The delegation a row or a queued line names, where it names one. */
function delegationOf(metadata: StoredMessageMetadata | AwaitingLineMetadata | undefined) {
  return metadata !== undefined && "delegation_id" in metadata ? metadata.delegation_id : undefined;
}

/** A stored part read as the transcript draws it. */
function partOf(part: StoredMessageRecord["message"]["parts"][number]): AgentPart {
  // SAFETY: the store read the row back through its vocabulary (`readStoredUIMessages`), so each of its parts is JSON.
  return agentPart(part as WireValue);
}

/** Whether a row is a line of a call, the voice's or the caller's, which the agent's own turn never is. */
function spokenOnCall(record: StoredMessageRecord): boolean {
  const metadata = metadataOf(record);

  return (
    metadata !== undefined && "channel" in metadata && metadata.channel === MESSAGE_CHANNEL.VOICE
  );
}

/** A row's words: its text parts, joined. */
function wordsOf(record: StoredMessageRecord): string {
  return record.message.parts
    .flatMap((part) => {
      const read = partOf(part);

      return read.kind === AGENT_PART.TEXT ? [read.text] : [];
    })
    .join("");
}

/**
 * A stored row as the line of the call the loop goes on from, where it is
 * one this service recorded; taken by a delegation where its row names one,
 * or where a message queued behind the running turn names it.
 */
function storedLineOf(
  record: StoredMessageRecord,
  queuedLines: ReadonlySet<string>,
): StoredVoiceLine | undefined {
  const fields = lineFieldsOf(metadataOf(record));
  const key = fields?.line_key;

  if (fields === undefined || key === undefined) return undefined;

  return {
    speaker: record.message.role === MESSAGE_ROLE.USER ? VOICE_SPEAKER.CALLER : VOICE_SPEAKER.VOICE,
    id: key,
    text: wordsOf(record),
    fromMs: fields.from_ms,
    toMs: fields.to_ms,
    eventId: fields.event_id,
    delegated: fields.delegation_id !== undefined || queuedLines.has(key),
  };
}

/** Whether a row is a turn's journal: the agent model's row of the turn that wrote it. */
function journalOf(record: StoredMessageRecord): string | undefined {
  const metadata = metadataOf(record);

  const byModel =
    record.message.role === MESSAGE_ROLE.ASSISTANT &&
    metadata !== undefined &&
    "author" in metadata &&
    metadata.author === MESSAGE_AUTHOR.MODEL;

  return byModel ? record.turnId : undefined;
}

/** The tool calls a journal stands with: each one's id and the words its row draws. */
function toolCallsOf(record: StoredMessageRecord): readonly { id: string; step: string }[] {
  return record.message.parts.flatMap((part) => {
    const read = partOf(part);

    if (read.kind !== AGENT_PART.TOOL) return [];
    const view = toolCallView({ tool: read.tool, input: read.input, output: read.output });
    const line = callLine(view.kind, view.subject, view.description);

    return [{ id: read.callId, step: [line.verb, line.subject].filter(Boolean).join(" ") }];
  });
}

/** A finished journal's reply: the words of its last step, after every tool call, which are what the turn answered. */
function replyOf(record: StoredMessageRecord): string {
  const parts = record.message.parts.map((part) => partOf(part));

  const lastStep = parts.findLastIndex(
    (part) => part.kind === AGENT_PART.TOOL || part.kind === AGENT_PART.STEP_START,
  );

  return parts
    .slice(lastStep + 1)
    .flatMap((part) => (part.kind === AGENT_PART.TEXT ? [part.text] : []))
    .join("")
    .trim();
}

/** Whether a turn's status is one that stands open. */
function standsOpen(status: string | undefined): boolean {
  return TURN_OPEN.some((open) => open === status);
}

/** Whether the agent's turn stands open now. */
const agentWorking = (target: AgentTarget) =>
  Effect.map(latestTurnsOf(target.userId, [target.conversationId]), (turns) => {
    return standsOpen(turns.get(target.conversationId)?.status);
  });

/**
 * Where the loop starts: the call's stored lines, the delegations handed on
 * by them or queued behind the running turn, whether that turn runs, and the
 * delegation it answers, by the newest line a delegation took.
 */
const callStart = Effect.fnUntraced(function* (call: VoiceCallRow, target: AgentTarget) {
  const read = yield* listCallLines(target.userId, target.conversationId, call.id, CODER_TOOL_SET);

  if (!read.ok)
    yield* Effect.logWarning("a voice call's stored lines did not read; the loop starts afresh");
  const queue = yield* readAgentQueue(call.callerId, call.agentId);
  const queued = Option.match(queue, { onNone: () => [], onSome: (standing) => standing.messages });
  const queuedLines = new Set(queued.flatMap((message) => message.line?.adopts ?? []));

  const queuedDelegations = queued.flatMap((message) => {
    const delegationId = delegationOf(message.line?.metadata);

    return delegationId === undefined ? [] : [delegationId];
  });

  const records = read.ok ? read.value : [];
  const lines = records.flatMap((record) => storedLineOf(record, queuedLines) ?? []);

  const handedOn = records.flatMap((record) => {
    const delegationId = delegationOf(metadataOf(record));

    return delegationId === undefined ? [] : [delegationId];
  });

  const working = yield* agentWorking(target);

  const start: VoiceCallStart = {
    agentWorking: working,
    answering: working ? (handedOn.at(-1) ?? null) : null,
    lineId: (eventId) => callLineKey(call.id, eventId),
    lines,
    delegations: new Set([...handedOn, ...queuedDelegations]),
  };

  return start;
});

/**
 * The sequence a call's replies are told after: the row's own once a lease
 * kept one; otherwise, as the call's first lease finds it, just before the
 * journal of the turn standing open, so its reply is told once it finishes,
 * or the conversation's newest row where none stands open, kept at once.
 */
const toldFrom = Effect.fnUntraced(function* (holder: VoiceCallHolder, target: AgentTarget) {
  const { call } = holder;

  if (call.toldSeq !== null) return Option.some(call.toldSeq);
  const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
  const turn = turns.get(target.conversationId);
  const now = yield* messageCursorNow(target.userId, target.conversationId);
  let told = now.seq;

  if (turn !== undefined && standsOpen(turn.status)) {
    const journal = yield* readMessageByClientId(
      target.userId,
      target.conversationId,
      CODER_TOOL_SET,
      turn.id,
    );

    const [row] = journal.ok ? journal.value : [];

    if (row !== undefined) told = row.seq - 1;
  }

  const kept = yield* saveVoiceCallState(call.id, call.leaseEpoch, { toldSeq: told });

  return kept ? Option.some(told) : Option.none<number>();
});

/**
 * The agent's turn followed for as long as the lease holds, from the told
 * sequence, each thing it says handed to the loop: a journal standing open
 * as the turn's start, each tool call it holds as progress, and a journal
 * finished past the told sequence as its reply and its end, that sequence
 * kept first. Ends only once a write finds the lease lost.
 */
const followed = Effect.fnUntraced(function* (
  holder: VoiceCallHolder,
  target: AgentTarget,
  from: number,
  offer: (event: AgentTurnEvent) => Effect.Effect<void>,
) {
  let told = from;

  const watch = yield* (yield* Sync).watch(
    [[TOPIC.CONVERSATION, target.conversationId]],
    CODER.MESSAGES_POLL,
  );

  const now = yield* messageCursorNow(target.userId, target.conversationId);
  let cursor: MessageCursor = { seq: told, revision: now.revision };
  const started = new Set<string>();
  const stepped = new Set<string>();
  const delegationOfTurn = new Map<string, string>();
  let first = true;

  while (true) {
    const page = yield* listMessagesPast(
      target.userId,
      target.conversationId,
      CODER_TOOL_SET,
      cursor,
    );

    cursor = page.cursor;
    const records = page.read.ok ? page.read.value : [];

    for (const record of records) {
      if (spokenOnCall(record)) {
        const delegationId = delegationOf(metadataOf(record));

        if (record.turnId !== undefined && delegationId !== undefined) {
          delegationOfTurn.set(record.turnId, delegationId);
        }

        continue;
      }

      const turnId = journalOf(record);

      if (turnId === undefined) continue;

      if (record.finishedAt === undefined && !started.has(record.id)) {
        started.add(record.id);
        const delegationId = delegationOfTurn.get(turnId);
        yield* offer({
          kind: AGENT_TURN.STARTED,
          ...(delegationId === undefined ? undefined : { delegationId }),
        });
      }

      for (const call of toolCallsOf(record)) {
        if (stepped.has(call.id)) continue;
        stepped.add(call.id);

        // Note that the calls standing as this holder first reads were told by the one before it.
        if (!first && record.finishedAt === undefined) {
          yield* offer({ kind: AGENT_TURN.PROGRESS, step: call.step });
        }
      }

      if (record.finishedAt === undefined || record.seq <= told) continue;
      told = record.seq;

      if (!(yield* saveVoiceCallState(holder.call.id, holder.call.leaseEpoch, { toldSeq: told }))) {
        return;
      }

      const reply = replyOf(record);

      if (reply !== "") yield* offer({ kind: AGENT_TURN.REPLY, text: reply });
      yield* offer({ kind: AGENT_TURN.ENDED });
    }

    first = false;

    if (records.length < PAGE_ROWS) yield* watch.next;
  }
}, Effect.scoped);

/** A request the service refused, logged by its kind and never tried again, as a store that failed under it is read as a refusal (`hostedStoreOrUnavailable`). */
const refusedLogged = <A, E, R>(label: string, act: Effect.Effect<A, E, R>) =>
  act.pipe(
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(`a voice call's ${label} was refused: ${failureKind(failure)}`),
    ),
  );

/**
 * One output carried out under the lease, fenced by its epoch: whether the
 * lease still held it, so a holder told no acts no more.
 */
const carriedOut = Effect.fnUntraced(function* (
  holder: VoiceCallHolder,
  agent: Agent,
  target: AgentTarget,
  output: VoiceOutput,
) {
  const { call } = holder;

  if (output.kind === VOICE_OUTPUT.TELL) return yield* holder.send(output.event);

  if (!(yield* holder.holds)) return false;

  switch (output.kind) {
    case VOICE_OUTPUT.RECORD: {
      const write = yield* storeWriter({ tools: CODER_TOOL_SET });

      const written = yield* write.recordVoiceLine(target, {
        key: output.id,
        callId: call.id,
        speaker: output.speaker,
        text: output.text,
        sender: { kind: MESSAGE_SENDER.MEMBER, userId: call.callerId },
        fromMs: output.fromMs,
        toMs: output.toMs,
        eventId: output.eventId,
      });

      if (Result.isFailure(written)) {
        yield* Effect.logWarning(`a voice call's line was refused: ${written.failure.refusal}`);
      }

      return true;
    }

    case VOICE_OUTPUT.SEND:
      yield* refusedLogged(
        "request",
        steerMemberWords(storeWriter({ tools: CODER_TOOL_SET }), call.callerId, agent, {
          text: output.text,
          clientKey: output.lines.at(-1) ?? output.delegationId,
          metadata: spokenLineMetadata({
            channel: MESSAGE_CHANNEL.VOICE,
            delegationId: output.delegationId,
          }),
          adopts: output.lines,
        }),
      );

      return true;
    case VOICE_OUTPUT.QUEUE:
      yield* refusedLogged(
        "queued request",
        changeAgentQueue(call.callerId, agent, {
          change: QUEUE_CHANGE.ADD,
          id: output.lines.at(-1) ?? callLineKey(call.id, output.delegationId),
          text: output.text,
          channel: MESSAGE_CHANNEL.VOICE,
          delegationId: output.delegationId,
          lines: output.lines,
        }),
      );

      return true;
  }
});

/**
 * The call's delegations run by the lease holding it: its stored lines read
 * once it claims the call, the session's events and the agent's turn handed
 * to the loop through one queue, and what the loop answers carried out, until
 * an act finds the lease lost. An agent no longer there, or no longer the
 * caller's to reach, leaves the call held with nothing to delegate to.
 */
export const voiceCallDelegations: VoiceCallObserver<
  Effect.Services<ReturnType<typeof carriedOut>> | DatabaseServices
> = (holder) =>
  Effect.gen(function* () {
    const { call } = holder;
    const found = yield* readAgent(call.callerId, call.agentId);

    if (Option.isNone(found)) {
      yield* Effect.logWarning("a voice call's agent is gone; nothing it says is delegated");

      return { observe: () => Effect.void, beside: Effect.never };
    }

    const agent = found.value;
    const target: AgentTarget = { userId: agent.userId, conversationId: agent.conversationId };
    const start = yield* callStart(call, target);
    // Note that the told sequence is read before the holder sets out, so a reply finished after its claim is told.
    const told = yield* toldFrom(holder, target);
    const inputs = yield* Queue.unbounded<VoiceInput>();
    const offer = (input: VoiceInput) => Effect.asVoid(Queue.offer(inputs, input));

    const carried = Stream.runForEachWhile(
      voiceDelegations(Stream.fromQueue(inputs), start),
      (output) => carriedOut(holder, agent, target, output),
    );

    return {
      observe: (event) => offer({ from: VOICE_INPUT.LIVE, body: event.body }),
      beside: Option.match(told, {
        // A lease that could not keep the told sequence has lost the call already.
        onNone: () => Effect.void,
        onSome: (from) =>
          Effect.raceFirst(
            followed(holder, target, from, (event) => offer({ from: VOICE_INPUT.AGENT, event })),
            carried,
          ),
      }),
    };
  });
