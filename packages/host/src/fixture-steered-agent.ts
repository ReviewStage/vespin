/**
 * fixture-steered-agent.ts -- the Inbox fixture's agent the lines steered in beside its turns reach: a teammate's thread line, the reader's answer and comment, a teammate's Slack message, a wakeup it set, and a carry-on after a cut-off turn, so its page draws each under the head the panel draws.
 *
 * The Inbox fixture stages it on the invitations task, answering its page
 * and laying its transcript where the host holds one
 * (`LIVE_READ.TRANSCRIPT`), but lists it in no task's agents, so every list
 * the fixture stages counts as it did. Each line carries the metadata the
 * service writes beside it, so a transcript draws the member's words rather
 * than the instructions the agent read. Every word here is invented.
 */

import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { INBOX_REPLY, inboxAnswerMessage, inboxThreadMessage } from "@repo/features/inbox-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  CARRY_ON_REASON,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  THREAD_LINE_EVENT,
  type WireRecord,
} from "@repo/wire";
import type { AppTranscript } from "./app-state.js";
import { FIXTURE_IDS, FIXTURE_PAGE } from "./fixture-stage.js";

const MINUTE = 60_000;

/** The agent's id, which a fixture run opens its page by (`-agent <id>`). */
export const FIXTURE_STEERED_AGENT_ID = "9d3b6f21-4c8a-4e7d-b1f5-3a6c9e2d8b40";

/** The agent's title, as its page names it in the bar and its wakeup's line names its sender. */
const TITLE = "Sign the invite email";

/** The teammate whose lines reach the agent, one of the fixture's workspace members. */
const TEAMMATE = { userId: "user-grace", name: "Grace Hopper" } as const;

/** The Inbox fixture's threads its thread lines are on, by the ids, keys and titles `fixture-inbox.ts` gives them (`fixtureId(3)`, `fixtureId(5)`), which this file cannot import, since that one imports it. */
const THREAD = {
  LIMITS: {
    id: "81e2a425-6d9f-4ab7-92df-000000000003",
    key: "invite-limits",
    title: "Invite limits",
  },
  EXPIRED: {
    id: "81e2a425-6d9f-4ab7-92df-000000000005",
    key: "expired-copy",
    title: "What the expired invite page says",
  },
} as const;

/** The comment thread the reader's comment line hands over. */
const COMMENT_THREAD = "fixture-steered-comment";

/** What the agent was asked to do on its wakeup. */
const WAKEUP_PROMPT = "Check the preview deploy and send a test invite.";

/** A member's own words on each line, as the service keeps them beside what the agent read. */
const WORDS = {
  LIMITS: "Ten pending invites per member is plenty; owners can lift it.",
  COMMENT: "Nine expired is more than I expected. Is the seven-day window too short?",
  SLACK: "Can the invite email say who sent it? Ours read like spam.",
} as const;

/** What the service sends the agent after a turn its runner stopped answering in (`carry-on.ts`). */
const CARRY_ON_PROMPT = `From ${PRODUCT_NAME}: your previous turn was interrupted before it ended: your run stopped answering before the turn ended. Nothing was sent to you meanwhile. Whatever that turn had under way may be half done: check the state of your work first, your files, your branch, and any command or background task it had running, then carry on from where it stopped. If it had finished, say so and end your turn.`;

type Sender = NonNullable<AgentTranscriptMessage["sentBy"]>;

/** A line steered into the agent, `at` milliseconds into the run: the words the agent read, the metadata the service wrote beside them, and who sent it. */
function steered(
  id: string,
  at: number,
  text: string,
  metadata: WireRecord,
  sentBy: Sender,
): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }],
    metadata,
    sentAt: at,
    sentBy,
  };
}

/** One of the agent's turns, `from` to `to` milliseconds into the run, holding `parts`. */
function turn(id: string, from: number, to: number, parts: readonly WireRecord[]) {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [{ type: "step-start" }, ...parts],
    startedAt: from,
    finishedAt: to,
  } satisfies AgentTranscriptMessage;
}

/** The agent as its page reads it, from the fields `base` holds of any fixture agent: its own id and title, finished. */
export function fixtureSteeredAgent(base: AgentSummary): AgentSummary {
  return { ...base, id: FIXTURE_STEERED_AGENT_ID, title: TITLE, status: AGENT_STATUS.COMPLETED };
}

/**
 * The agent's transcript, its instants counted from `startedAt`: `reader`'s
 * ask and the agent's answer; a teammate writing in a thread
 * (`inbox-procedures.ts`), the reader answering another, the reader's
 * comment on the task's page (`comment-ask.ts`), and a teammate's message
 * to the Slack bot (`slack-agent-starts.ts`); a turn that books a wakeup,
 * the wakeup coming back as the agent's own line (`agent-wakeups.ts`), a
 * turn its runner stopped answering in, the carry-on line the service sent
 * after it (`carry-on.ts`), and the turn that carried on.
 */
export function fixtureSteeredTranscript(
  startedAt: number,
  reader: { readonly userId: string; readonly name: string },
): AppTranscript {
  const at = (minutes: number) => startedAt + minutes * MINUTE;
  const own: Sender = { kind: AGENT_SENDER.MEMBER, userId: reader.userId, name: reader.name };
  const teammate: Sender = { kind: AGENT_SENDER.MEMBER, ...TEAMMATE };
  const self: Sender = { name: TITLE, agent: true, agentId: FIXTURE_STEERED_AGENT_ID };

  const messages: readonly AgentTranscriptMessage[] = [
    steered(
      "fixture-steered-ask",
      at(0),
      "Make the invite email say who sent it.",
      { channel: MESSAGE_CHANNEL.TYPED },
      own,
    ),
    turn("fixture-steered-answer", at(0), at(4), [
      { type: "text", text: "The email now opens on who invited them, by name and workspace." },
    ]),
    steered(
      "fixture-steered-thread",
      at(10),
      inboxThreadMessage(THREAD.LIMITS, WORDS.LIMITS),
      {
        channel: MESSAGE_CHANNEL.THREAD,
        event: THREAD_LINE_EVENT.MESSAGE,
        item_id: THREAD.LIMITS.id,
      },
      teammate,
    ),
    steered(
      "fixture-steered-answer-line",
      at(11),
      inboxAnswerMessage(THREAD.EXPIRED, {
        reply: INBOX_REPLY.CHOSE,
        choices: ["Offer a resend"],
        note: "And name who invited them.",
      }),
      {
        channel: MESSAGE_CHANNEL.THREAD,
        event: THREAD_LINE_EVENT.ANSWER,
        item_id: THREAD.EXPIRED.id,
      },
      own,
    ),
    steered(
      "fixture-steered-comment",
      at(12),
      [
        `${reader.name} sent you a comment thread on the page "${FIXTURE_PAGE.title}" of the task "Teammate invitations" to answer (thread ${COMMENT_THREAD}).`,
        "",
        `${reader.name}: ${WORDS.COMMENT}`,
        "",
        "Answer it on the thread.",
      ].join("\n"),
      {
        channel: MESSAGE_CHANNEL.COMMENT,
        thread_id: COMMENT_THREAD,
        task_id: FIXTURE_IDS.TASK,
        quote: "Expired 9",
        words: WORDS.COMMENT,
        page_id: FIXTURE_IDS.PAGE,
        page_title: FIXTURE_PAGE.title,
      },
      own,
    ),
    steered(
      "fixture-steered-slack",
      at(13),
      `${TEAMMATE.name} wrote to you in Slack:\n\n${WORDS.SLACK}`,
      {
        channel: MESSAGE_CHANNEL.SLACK,
        words: WORDS.SLACK,
        url: "https://ada-relay.slack.com/archives/C0FIXTURE/p1760000000000100",
      },
      teammate,
    ),
    turn("fixture-steered-wait", at(13), at(14), [
      { type: "text", text: "I'll look again once preview has deployed the sender line." },
      {
        type: `tool-${AGENT_TOOL.SCHEDULE_WAKEUP}`,
        toolCallId: "fixture-steered-wakeup",
        state: "output-available",
        input: { delaySeconds: 300, prompt: WAKEUP_PROMPT },
        output: { status: "accepted", wakeup: { delaySeconds: 300 } },
      },
    ]),
    steered("fixture-steered-woke", at(19), WAKEUP_PROMPT, { channel: MESSAGE_CHANNEL.APP }, self),
    turn("fixture-steered-cut", at(19), at(20), [
      { type: "text", text: "Preview has the sender line. Sending a test invite now." },
    ]),
    steered(
      "fixture-steered-carry-on",
      at(21),
      CARRY_ON_PROMPT,
      { channel: MESSAGE_CHANNEL.CARRY_ON, reason: CARRY_ON_REASON.RUNNER_LOST },
      { kind: AGENT_SENDER.APP, name: PRODUCT_NAME },
    ),
    turn("fixture-steered-carried", at(21), at(23), [
      { type: "text", text: "The test invite went out on preview, signed by who sent it." },
    ]),
  ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: { status: AGENT_STATUS.COMPLETED, runStartedAt: startedAt, title: TITLE, caughtUp: true },
    pages: 1,
  };
}
