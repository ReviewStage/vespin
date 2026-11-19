/**
 * manager-chat.ts -- a Manager's transcript as the chat its page draws: people's lines, and the Manager's `send_to_user` messages alone.
 *
 * A Manager's page is a direct-message chat between the people who can open
 * it and the Manager, never its transcript: a person's line stands as they
 * sent it (`isPersonLine`), and each of the Manager's turns stands as the
 * words of the `send_to_user` calls it made, one paragraph each, in the
 * order it sent them. Everything else the transcript holds (the Manager's
 * own text, its thoughts and other calls, and the lines its agents, wakes,
 * threads, and GitHub sent it) is left out, and a turn that sent nothing
 * stands nowhere. The greeting it opens on is drawn above (`manager-greeting.ts`).
 */

import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  MESSAGE_ROLE,
  type WireValue,
} from "@repo/wire";
import { AGENT_PART, type AgentPart, agentParts } from "./agent-parts.js";
import { AGENT_TOOL } from "./agent-tools.js";
import type { AgentTranscriptMessage } from "./agent-wire.js";
import { TOOL_STATE } from "./tool-call-block.js";
import { isPersonLine } from "./transcript-lines.js";

/** The words of a `send_to_user` call whose input is whole, but one its answer refused; none for any other part. */
function sentWords(part: AgentPart): string | undefined {
  if (part.kind !== AGENT_PART.TOOL || part.tool !== AGENT_TOOL.SEND_TO_USER) return undefined;

  // Note that a call still streaming its input holds only the start of its words, so it stands once they are whole.
  if (part.state === TOOL_STATE.INPUT_STREAMING || part.state === TOOL_STATE.OUTPUT_ERROR) {
    return undefined;
  }

  if (isRecord(part.output) && part.output.status !== ACTION_RESULT_STATUS.ACCEPTED) {
    return undefined;
  }

  const text = isRecord(part.input) ? part.input.text : undefined;

  return isWireString(text) && text.trim() !== "" ? text.trim() : undefined;
}

/**
 * A turn's parts as its chat message: the words of each `send_to_user`
 * call as a text part, in the order sent, with the turn's step starts kept
 * between them, so a person's line that reached the turn while it ran is
 * still drawn after the steps it arrived after (`arrivedParts`); none where
 * it sent nothing.
 */
function chatParts(message: AgentTranscriptMessage): readonly WireValue[] {
  const parts = agentParts(message).flatMap((part): readonly WireValue[] => {
    if (part.kind === AGENT_PART.STEP_START) return [{ type: AGENT_PART.STEP_START }];
    const text = sentWords(part);

    return text === undefined ? [] : [{ type: AGENT_PART.TEXT, text }];
  });

  return parts.some((part) => isRecord(part) && part.type === AGENT_PART.TEXT) ? parts : [];
}

/** A Manager's transcript as its chat: people's lines as they are, and each turn as its `send_to_user` words, a turn that sent none left out. */
export function managerChatLines(
  messages: readonly AgentTranscriptMessage[],
): readonly AgentTranscriptMessage[] {
  return messages.flatMap((message): readonly AgentTranscriptMessage[] => {
    if (message.role === MESSAGE_ROLE.USER) return isPersonLine(message) ? [message] : [];

    if (message.role !== MESSAGE_ROLE.ASSISTANT) return [];

    const parts = chatParts(message);

    if (parts.length === 0) return [];
    // Note that the parts are new, so the cuts that named the old ones by index go with them.
    const { cutParts: _cut, ...kept } = message;

    return [{ ...kept, parts }];
  });
}
