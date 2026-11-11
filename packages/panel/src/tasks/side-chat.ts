/**
 * side-chat.ts -- a side question asked of an agent with `/btw`: where its fork cuts the agent's transcript, the note it starts on, and the Start that sends it.
 *
 * A side chat is a fork (`fork-model.ts`) the box starts by itself rather
 * than a draft the developer sends: `/btw <question>` forks the agent at its
 * newest settled reply, so what it is still writing stays out, and starts the
 * fork on the question at once, while the agent goes on working. Where it has
 * settled no reply yet, the fork cuts the one it is writing where it stands;
 * where it has begun none, there is nothing to ask about, so none is offered.
 * The Start marks the fork a side chat (`from.side`), which the service keeps
 * on its record: it copies none of the agent's work, its preamble asks for a
 * short answer that changes nothing unless asked, as other tools' side
 * questions do, and it is archived with the agent. Every client reads the
 * mark off the summary, so the note is the question alone, and the fork is
 * named for it, so no title is generated. Its tab opens in the side panel
 * rather than the task's column, and closing it archives it
 * (`desktop-tasks.tsx`).
 */

import type { AgentSummary, AgentTranscriptMessage } from "@repo/features/agent-wire";
import { MESSAGE_ROLE } from "@repo/wire";
import {
  type AgentFork,
  type ForkStart,
  forkCutOf,
  forkStart,
  messageOpening,
  openReply,
} from "./fork-model.js";

/** What a side chat is named, ahead of its question's opening words. */
const TITLE_HEAD = "Side: ";

/** Whether the agent is a side chat asked beside another (`/btw`), which stands under that agent rather than among the task's. */
export function isSideChat(agent: Pick<AgentSummary, "from">): boolean {
  return agent.from?.side === true;
}

/**
 * Where a side chat of `agentId` forks its transcript: at the newest reply
 * that has settled; else at the one still being written, cut where it
 * stands; none where no reply has begun a step yet.
 */
export function sideChatFork(
  agentId: string,
  messages: readonly Pick<AgentTranscriptMessage, "id" | "role" | "parts">[],
  writing: boolean,
): AgentFork | undefined {
  // Note that a reply is still being written only where it is the newest line, so a turn that has written none yet leaves the last turn's reply settled.
  const open =
    messages.at(-1)?.role === MESSAGE_ROLE.ASSISTANT ? openReply(messages, writing) : undefined;
  const replies = messages.filter((message) => message.role === MESSAGE_ROLE.ASSISTANT);
  const settled = replies.findLast((message) => message.id !== open);
  if (settled !== undefined) return { agentId, messageId: settled.id, opening: "" };
  const writingNow = replies.at(-1);
  const cut = writingNow === undefined ? undefined : forkCutOf(writingNow, open);
  if (writingNow === undefined || cut === undefined || cut.messageSteps === 0) return undefined;
  return { agentId, messageId: writingNow.id, opening: "", ...cut };
}

/**
 * The Start a side chat sends under its own key: the fork marked a side
 * chat, the question as its note, the source's servers, and its name from
 * the question; it runs on the source's model and where the source runs, as
 * a fork does.
 */
export function sideChatStart(input: {
  readonly key: string;
  readonly fork: AgentFork;
  readonly question: string;
  readonly disabledServers: readonly string[];
}): ForkStart {
  const { key, fork, question, disabledServers } = input;
  const start = forkStart({
    draftId: key,
    fork,
    words: question,
    attachments: [],
    choice: undefined,
    disabledServers,
  });
  return {
    ...start,
    ...(start.from === undefined ? undefined : { from: { ...start.from, side: true } }),
    title: `${TITLE_HEAD}${messageOpening(question)}`,
  };
}
