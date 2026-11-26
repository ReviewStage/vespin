/**
 * manager-chat-line.ts -- the chat message a person's own line to a Manager is, minted as the steer takes the line.
 *
 * A Manager keeps a chat (`manager_chat_message`), and a person's own line
 * to it is a message of that chat whichever door sent it: the chat's own
 * send, a message as released apps and the CLI send it, a queued one as the
 * queue hands it on, a Start's prompt, a reply button's suggestion they
 * pressed, and the member MCP server's `message_agent`. The steer asks here
 * of every line it takes (`steerAgentWritten`), so no door decides it: the
 * line is the member's, and what carried it passes `isPersonChatMetadata`.
 * The writer writes the message beside the line in the line's transaction
 * (`writer.ts`'s `chatMessageOfLine`). A delegation of a call's lines is none, since the
 * chat holds those lines as they were recorded (`growManagerChatLine`).
 *
 * A person's edit of their own message is no message of the chat: its words
 * change in place, and the Manager is told in a line of the person's that
 * is the service's words in their name (`app_words`), which no chat holds
 * as theirs, naming the message and its words before and after
 * (`chatEditLine`), so the Manager answers it in the chat as any message.
 */

import { randomBytes } from "node:crypto";
import type { Agent } from "@repo/database/models/agent-store";
import {
  type ManagerChatMessage,
  readManagerChatMessage,
} from "@repo/database/models/manager-chat-messages";
import type { AwaitingLineMetadata } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { isPersonChatMetadata } from "@repo/features/transcript-lines";
import { MESSAGE_CHANNEL } from "@repo/wire";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import type { SteerChat, SteerLine } from "./steer.js";

/** What a line naming no channel is written as: the member's typed ask. */
const TYPED: AwaitingLineMetadata = { channel: MESSAGE_CHANNEL.TYPED };

/** How many bytes a chat message's id is minted from: eight hex digits, short since the model repeats it. */
const CHAT_ID_BYTES = 4;

/** A fresh id for a person's chat message, unique within the chat but by a clash its write refuses, which a send again mints past. */
function mintedChatId(): string {
  return randomBytes(CHAT_ID_BYTES).toString("hex");
}

/**
 * The root of the thread a chat send replies in, as the chat holds it: the
 * message it names where that is a root, or that message's own root, so
 * every header the Manager reads names a root; none for a message of the
 * chat itself, and refused for one naming no message of the chat.
 */
const threadRootOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agentId: string,
  named: string | undefined,
) {
  if (named === undefined) return null;

  const parent = yield* hostedStoreOrUnavailable(readManagerChatMessage(userId, agentId, named));

  if (Option.isNone(parent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

  return parent.value.threadRoot ?? parent.value.id;
});

/** The line that tells a Manager a person edited their message: who, which message and the thread it stands in, and its words before and after. */
function chatEditWords(message: ManagerChatMessage, after: string): string {
  const thread = message.threadRoot === null ? "" : ` in thread ${message.threadRoot}`;

  return `${message.authorName} edited message ${message.id}${thread}.\n\nBefore:\n${message.text}\n\nAfter:\n${after}`;
}

/**
 * The line telling a Manager its chat's message was edited to `after`, as
 * the steer takes it: the service's words in the editor's name, under the
 * edit's key, so an edit sent again tells it once.
 */
export function chatEditLine(
  message: ManagerChatMessage,
  after: string,
  clientKey: string,
): Omit<SteerLine, "sender"> {
  return {
    text: chatEditWords(message, after),
    clientKey,
    metadata: { channel: MESSAGE_CHANNEL.TYPED, app_words: true },
  };
}

/** Whether a line is a person's own words: the member's, carried as a person's chat message is, and adopting no call's lines. */
function isPersonsOwn(line: Pick<SteerLine, "sender" | "metadata" | "adopts">): boolean {
  return (
    line.sender.kind === MESSAGE_SENDER.MEMBER &&
    line.adopts === undefined &&
    isPersonChatMetadata(line.metadata ?? TYPED)
  );
}

/**
 * The chat message a line to the agent is, as the writer writes it beside
 * the line: a fresh id, in the thread the send names; none for an agent
 * that is no Manager, which keeps no chat, or a line that is no person's
 * own words.
 */
export const chatOfLine = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
  line: Pick<SteerLine, "sender" | "metadata" | "adopts">,
  threadRoot?: string,
) {
  if (agent.kind !== AGENT_KIND.MANAGER || !isPersonsOwn(line)) return undefined;

  const chat: SteerChat = {
    id: mintedChatId(),
    threadRoot: yield* threadRootOf(userId, agent.id, threadRoot),
  };

  return chat;
});
