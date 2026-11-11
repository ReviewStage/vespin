/**
 * side-chat.ts -- a side question asked of an agent with `/btw`: where its fork cuts the agent's transcript, the note it starts on, and the Start that sends it.
 *
 * A side chat is a fork (`fork-model.ts`) the box starts by itself rather
 * than a draft the developer sends: `/btw <question>` forks the agent at its
 * newest settled reply, so what it is still writing stays out, and starts the
 * fork on the question at once, while the agent goes on working. Where it has
 * settled no reply yet, the fork cuts the one it is writing where it stands,
 * and where it has written none, it takes the whole transcript, as a continue
 * does. The note asks for a short answer that changes nothing unless asked,
 * as other tools' side questions do, so the aside reads as one and costs as
 * little; the fork is named for its question, so no title is generated. Its
 * tab opens in the side panel rather than the task's column, and closing it
 * archives it (`desktop-tasks.tsx`).
 */

import type { AgentTranscriptMessage } from "@repo/features/agent-wire";
import { MESSAGE_ROLE } from "@repo/wire";
import {
  type AgentFork,
  continueFork,
  type ForkStart,
  forkCutOf,
  forkStart,
  messageOpening,
  openReply,
} from "./fork-model.js";

/** What a side chat is named, ahead of its question's opening words. */
const TITLE_HEAD = "Side: ";

/** How the fork is asked to answer, under the developer's question. */
const HOW_TO_ANSWER = "(A side question: answer briefly, and change nothing unless I ask.)";

/**
 * Where a side chat of `agentId` forks its transcript: at the newest reply
 * that has settled; else at the one still being written, cut where it
 * stands; and on the whole transcript where no reply has begun a step yet.
 */
export function sideChatFork(
  agentId: string,
  messages: readonly Pick<AgentTranscriptMessage, "id" | "role" | "parts">[],
  writing: boolean,
): AgentFork {
  const open = openReply(messages, writing);
  const replies = messages.filter((message) => message.role === MESSAGE_ROLE.ASSISTANT);
  const settled = replies.findLast((message) => message.id !== open);
  if (settled !== undefined) return { agentId, messageId: settled.id, opening: "" };
  const writingNow = replies.at(-1);
  const cut = writingNow === undefined ? undefined : forkCutOf(writingNow, open);
  if (writingNow === undefined || cut === undefined || cut.messageSteps === 0) {
    return continueFork(agentId);
  }
  return { agentId, messageId: writingNow.id, opening: "", ...cut };
}

/** The note a side chat starts on: the question, then how to answer it. */
function sideChatNote(question: string): string {
  return `${question.trim()}\n\n${HOW_TO_ANSWER}`;
}

/**
 * The Start a side chat sends under its own key: the fork, the question as
 * its note, the source's servers, and its name from the question; it runs
 * on the source's model and where the source runs, as a fork does.
 */
export function sideChatStart(input: {
  readonly key: string;
  readonly fork: AgentFork;
  readonly question: string;
  readonly disabledServers: readonly string[];
}): ForkStart {
  const { key, fork, question, disabledServers } = input;
  return {
    ...forkStart({
      draftId: key,
      fork,
      words: sideChatNote(question),
      attachments: [],
      choice: undefined,
      disabledServers,
    }),
    title: `${TITLE_HEAD}${messageOpening(question)}`,
  };
}
