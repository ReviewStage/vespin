/**
 * follow-offer.ts -- whom the reader is offered to add as a follower of a task, after a line of their own to one of its agents mentions someone.
 *
 * A mention never makes anyone follow (the service's rule), so the reader
 * who mentions a teammate is asked instead, and only they are: the offer
 * reads the reader's own newest line to the agent, the one still on its
 * way first, else the newest the transcript names them as sending, and
 * never a line an agent, an automation, GitHub, or a teammate sent. It
 * offers one person at a time, the first that line mentions who is a
 * member of the task's workspace, is not the reader, does not follow the
 * task, and was not turned down for this task on this device (Not now),
 * so the dock stands one row tall however many the line names.
 */

import { messageWords } from "@repo/features/agent-parts";
import { AGENT_SENDER, type AgentTranscriptMessage } from "@repo/features/agent-wire";
import { MENTION_KIND, mentionsIn } from "@repo/features/mention-link";
import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { MESSAGE_ROLE, type TaskFollowerWire } from "@repo/wire";

/** What the offer is read from. */
export interface FollowOfferInput {
  /** The transcript's rows, oldest first, as read back. */
  readonly messages: readonly AgentTranscriptMessage[];
  /** The words of the reader's lines sent from this tab still on their way, not yet read back, in the order they went; a refused line is none of them. */
  readonly pending: readonly string[];
  readonly readerId: string | undefined;
  /** The task's followers; none while they are unread or Following is off, which offers no one. */
  readonly followers: readonly TaskFollowerWire[] | undefined;
  /** The task's workspace's members; none while unread, which offers no one. */
  readonly members: readonly WorkspaceMember[] | undefined;
  /** The people turned down for this task on this device, by account id. */
  readonly declined: readonly string[];
}

/** Whether a row is a line the reader sent themselves, as its sender names them. */
function sentByReader(message: AgentTranscriptMessage, readerId: string): boolean {
  const { sentBy } = message;

  return (
    message.role === MESSAGE_ROLE.USER &&
    sentBy !== undefined &&
    sentBy.userId === readerId &&
    sentBy.agent !== true &&
    (sentBy.kind === undefined || sentBy.kind === AGENT_SENDER.MEMBER)
  );
}

/** The words of the reader's newest line to the agent: the newest still on its way, else the newest the transcript names them as sending; none before they sent one. */
function newestOwnWords(input: FollowOfferInput, readerId: string): string | undefined {
  const pending = input.pending.at(-1);

  if (pending !== undefined) return pending;
  const own = input.messages.findLast((message) => sentByReader(message, readerId));

  return own === undefined ? undefined : messageWords(own);
}

/**
 * The member the reader is offered to add as a follower, by account id: the
 * first person their newest line to the agent mentions who is a member, is
 * not the reader, does not follow the task, and was not turned down here;
 * none where nobody is.
 */
export function followOffer(input: FollowOfferInput): string | undefined {
  const { readerId, followers, members, declined } = input;

  if (readerId === undefined || followers === undefined || members === undefined) return undefined;
  const words = newestOwnWords(input, readerId);

  if (words === undefined) return undefined;

  for (const { mention } of mentionsIn(words, null)) {
    if (mention.kind !== MENTION_KIND.PERSON) continue;
    const { userId } = mention;

    if (
      userId !== readerId &&
      members.some((member) => member.userId === userId) &&
      !followers.some((follower) => follower.userId === userId) &&
      !declined.includes(userId)
    ) {
      return userId;
    }
  }

  return undefined;
}
