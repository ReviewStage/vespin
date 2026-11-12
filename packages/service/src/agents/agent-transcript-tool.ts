/**
 * agent-transcript-tool.ts -- `read_agent_transcript`: a page of the whole transcript of an agent of the caller's workspace or of one of its workers, or one call of it whole.
 *
 * The agent is found as `read_agent` finds it (`workspaceAgentOf`), on the
 * caller's member's standing now, so an agent of another workspace, even
 * one the member is also in, is none. A page is read as `read_agent` reads
 * one (`transcriptPage`), in the same places and bounds, with each call's
 * entry naming the call's id: a worker's call opens that worker's own
 * transcript, the conversation its call started
 * (`messages.agentWorker`), and any call is read whole by its id and the
 * message it stands in (`messages.agentPart`), its input and its output or
 * its error each cut on a line to a bound, since a page leaves a call's
 * output out. A worker is read only where its call recorded one, so a call
 * that started none is refused rather than read as an empty transcript.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { readDelegation } from "@repo/database/models/agent-store";
import { childConversationId } from "@repo/database/models/ids";
import { readMessageById } from "@repo/database/models/message-reads";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { agentCallIdSchema } from "@repo/features/agent-wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  isStoredToolPart,
  storedToolName,
  TOOL_PART_STATE,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import {
  AGENT_TOOL_REFUSAL,
  type AgentReadCall,
  type AgentToolServices,
  agentToolRejected,
  CODER_READ_AGENT_TOOL,
  cutOnLine,
  orStoreRefusal,
  type PageEntry,
  pageAnswer,
  pageAskedOf,
  READ_PAGE_CHARS,
  transcriptPage,
  workspaceAgentOf,
} from "./agent-tools.js";
import { wordsOf } from "./coder-host/replay.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";

/** Why a read answered nothing, in words the model can act on. */
const READ_AGENT_TRANSCRIPT_REFUSAL = {
  NO_WORKER:
    "Not read: no call of that agent with that callId started a worker; a page's entries name " +
    "each call's callId.",
  NO_CALL:
    "Not read: that transcript has no call with that callId in the message with that " +
    "messageId; a page's entries name both.",
} as const;

/** A call of a transcript, by its own id and the id of the message it stands in, as a page's entry names both. */
const CALL_NAMED = Schema.Struct({
  messageId: describeWire(wireUuidSchema, "The messageId of the entry that names the call."),
  callId: describeWire(agentCallIdSchema, "The callId of the entry that names the call."),
});

/** A read names the agent, at most one of its workers, and either the page of that transcript to read or one call to read whole. */
export const READ_AGENT_TRANSCRIPT_INPUT = Schema.Struct({
  agentId: describeWire(
    wireUuidSchema,
    `The agent's id, as ${AGENT_TOOL.LIST_AGENTS} answered it.`,
  ),
  worker: Schema.optionalKey(
    describeWire(
      agentCallIdSchema,
      "One of the agent's workers, by the callId of the call that started it, as an entry of " +
        "the agent's page names it, to read that worker's transcript instead; leave it out for " +
        "the agent's own.",
    ),
  ),
  call: Schema.optionalKey(
    describeWire(
      CALL_NAMED,
      "One call of the transcript to read whole, its input and its output, instead of a page; " +
        "leave it out to read a page.",
    ),
  ),
  from: CODER_READ_AGENT_TOOL.inputSchema.fields.from,
  before: CODER_READ_AGENT_TOOL.inputSchema.fields.before,
  after: CODER_READ_AGENT_TOOL.inputSchema.fields.after,
  entries: CODER_READ_AGENT_TOOL.inputSchema.fields.entries,
});

const readTranscriptAsked = Schema.decodeUnknownResult(READ_AGENT_TRANSCRIPT_INPUT);

/** An entry as a page of this read says it: its words, the journal it stands in where it is the agent's own, and the call it says where it is one. */
function transcriptEntry({ messageId, text, callId }: PageEntry): WireRecord {
  return {
    ...(messageId === undefined ? undefined : { messageId }),
    ...(callId === undefined ? undefined : { callId }),
    text,
  };
}

/** Words cut on a line to the read's bound, and how many characters were left out. */
function wordsCut(value: UnparsedWireValue): WireRecord {
  const cut = cutOnLine(wordsOf(value), READ_PAGE_CHARS);

  return { text: cut.text, leftOutChars: cut.leftOutChars };
}

/** One call of the transcript, whole: the tool, where it stands, its input, and its output or its error, each cut to the bound; none where the message holds no such call. */
const wholeCallOf = (
  target: ConversationTarget,
  messageId: string,
  callId: string,
): Effect.Effect<WireRecord | undefined, StoreFailure, DatabaseServices> =>
  Effect.map(
    readMessageById(target.userId, target.conversationId, CODER_TOOL_SET, messageId),
    (read): WireRecord | undefined => {
      const parts = read.ok ? (read.value[0]?.message.parts ?? []) : [];
      const part = parts.find((each) => isStoredToolPart(each) && each.toolCallId === callId);

      if (part === undefined || !isStoredToolPart(part)) return undefined;
      // SAFETY: a stored part's input and output are the JSON the row carried, and they are only said, never read into.
      const input = wordsCut(part.input as UnparsedWireValue);

      // SAFETY: a stored part's output is the JSON the row carried, and it is only said, never read into.
      const settled =
        part.state === TOOL_PART_STATE.OUTPUT_AVAILABLE
          ? { output: wordsCut(part.output as UnparsedWireValue) }
          : part.state === TOOL_PART_STATE.OUTPUT_ERROR
            ? { error: wordsCut(part.errorText) }
            : undefined;

      return { tool: storedToolName(part), state: part.state, input, ...settled };
    },
  );

/** One call of `read_agent_transcript`: a page of the agent's or its worker's transcript, its newest where none is named, or one call of it whole. */
export function runReadAgentTranscript(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readTranscriptAsked(input);
  const page = Result.isSuccess(asked) ? pageAskedOf(asked.success) : undefined;

  if (Result.isFailure(asked) || page === undefined) {
    return Effect.succeed(agentToolRejected(AGENT_TOOL_REFUSAL.UNREADABLE_PAGE));
  }

  const { agentId, worker, call: named } = asked.success;

  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(call.caller, agentId);

      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent } = found.value;

      // Note that a worker's transcript is read under the member who started the agent, as the agent's own is.
      const own: ConversationTarget = {
        userId: agent.userId,
        conversationId: agent.conversationId,
      };

      const target: ConversationTarget =
        worker === undefined
          ? own
          : {
              userId: agent.userId,
              conversationId: childConversationId(own.conversationId, worker),
            };

      if (worker !== undefined) {
        const delegation = yield* readDelegation(own, target.conversationId);

        if (Option.isNone(delegation)) {
          return agentToolRejected(READ_AGENT_TRANSCRIPT_REFUSAL.NO_WORKER);
        }
      }

      if (named !== undefined) {
        const whole = yield* wholeCallOf(target, named.messageId, named.callId);

        if (whole === undefined) return agentToolRejected(READ_AGENT_TRANSCRIPT_REFUSAL.NO_CALL);

        return { status: ACTION_RESULT_STATUS.ACCEPTED, call: whole };
      }

      const read = yield* transcriptPage(target, page);

      if (read === undefined) return agentToolRejected(AGENT_TOOL_REFUSAL.UNREADABLE_TRANSCRIPT);

      return { status: ACTION_RESULT_STATUS.ACCEPTED, ...pageAnswer(page, read, transcriptEntry) };
    }),
  );
}
