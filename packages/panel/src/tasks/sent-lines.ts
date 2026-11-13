/**
 * sent-lines.ts -- the lines sent into an agent, as its transcript's rail marks them: who sent each, the reader or someone else, and its words as plain words.
 *
 * A line sent in is any of the developer's messages the agent read: the
 * reader's own, a teammate's, another agent's (`message_agent`), an
 * automation's, the app's, and what GitHub, a thread, a comment, or Slack
 * steered in. The agent's own wakeups and the carry-on after a cut-off turn
 * are the agent's, not anyone's message to it, so they are none. Who sent
 * a line is read as its row reads it (`messageSender`): nobody, where the
 * reader sent it. Its words are those its row draws (`sentMessageWords`),
 * as plain words on one line, as a card too short to draw markdown says them.
 */

import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { plainWords } from "@repo/features/plain-words";
import { sentMessageWords } from "@repo/features/transcript-copy";
import { carryOnLineOf, isWakeupLine } from "@repo/features/transcript-lines";
import type { FormerMember, WorkspaceMember } from "@repo/features/workspace-wire";
import type { Actor } from "@repo/ui/actor-model";
import { MESSAGE_ROLE } from "@repo/wire";
import { messageSender } from "./agent-model.js";

/** One line sent into the agent, as its rail marks it. */
export interface SentLine {
  readonly messageId: string;
  /** Who sent it, as its row heads it; none where the reader sent it. */
  readonly sender: Actor | undefined;
  /** Its words as its row draws them, as plain words. */
  readonly words: string;
  readonly sentAt: number | undefined;
}

/** `message` as a line sent into the agent, read for `readerId`; none for the agent's own turn, wakeup, or carry-on. */
export function sentLineOf(
  message: AgentTranscriptMessage,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
  former?: readonly FormerMember[] | undefined,
): SentLine | undefined {
  if (message.role !== MESSAGE_ROLE.USER) return undefined;

  if (isWakeupLine(message) || carryOnLineOf(message) !== undefined) return undefined;

  return {
    messageId: message.id,
    sender: messageSender(message, readerId, members, former),
    words: plainWords(sentMessageWords(message)),
    sentAt: message.sentAt,
  };
}
