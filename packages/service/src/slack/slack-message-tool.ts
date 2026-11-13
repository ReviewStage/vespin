/**
 * slack-message-tool.ts -- `send_slack_message`: one message a coding agent sends as the Slack bot in the Slack thread it answers in.
 *
 * An agent a Slack thread speaks for (`slack_agent_thread`) replies there
 * as a person does, in a few short messages, one call each, posted in its
 * current thread (`currentSlackThread`) as a `markdown` block, which Slack
 * draws as standard Markdown. A turn that sent one has its final message
 * left unposted (`slack-agent-starts.ts`'s `postTurnToSlack`), since the
 * agent already said what it meant to. An agent no thread speaks for is
 * refused, so it answers where it was asked.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { currentSlackThread } from "@repo/database/models/slack-installation-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import type { WireRecord } from "@repo/wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import {
  type AgentReadCall,
  agentToolRejected,
  callerAgent,
  orStoreRefusal,
} from "../agents/agent-tools.js";
import { ACTION_RESULT_STATUS, type UnparsedWireValue } from "../core.js";
import { SlackBot } from "./slack-bot.js";
import { slackClipped, slackMarkdownBlock } from "./slack-markdown.js";

/** The most characters one message may spell. */
const SLACK_MESSAGE_CHARS = 4_000;

/** The most characters of a message the notification's plain text says; the block holds the rest. */
const NOTIFICATION_CHARS = 2_500;

/** Why a message was not sent, in words the model can act on. */
const SLACK_MESSAGE_REFUSAL = {
  UNREADABLE: `Not sent: pass text, one short message of at most ${SLACK_MESSAGE_CHARS} characters.`,
  NO_THREAD:
    "Not sent: no Slack thread speaks for you, so answer in your final message as you would anywhere else.",
  NOT_POSTED: "Not sent: Slack did not take the message; send it again.",
  NOT_AGENT: "Not sent: only a coding agent sends a Slack message.",
} as const;

const SEND_SLACK_MESSAGE_INPUT = Schema.Struct({
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(SLACK_MESSAGE_CHARS)),
    "One message, in Markdown, as a person would send it in Slack: a sentence or two.",
  ),
});

const readInput = Schema.decodeUnknownResult(SEND_SLACK_MESSAGE_INPUT);

/** `send_slack_message` as a coding agent is offered it: its name, its words, and its input. */
export const SEND_SLACK_MESSAGE_TOOL = {
  name: AGENT_TOOL.SEND_SLACK_MESSAGE,
  description:
    "Send one message as the Slack bot in the Slack thread you were started from or last written " +
    "in. Reply there as a person does: a few short messages, one call each, in the order they " +
    "should read. Once you send any, your final message is not posted in the thread as well. " +
    "Answers `accepted`, or `rejected` and why.",
  inputSchema: SEND_SLACK_MESSAGE_INPUT,
} as const;

/** One call of `send_slack_message`: the message posted in the calling agent's current Slack thread, refused with why where there is none or Slack did not take it. */
export function runSendSlackMessage(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, SlackBot | DatabaseServices> {
  const read = readInput(input);

  if (Result.isFailure(read)) {
    return Effect.succeed(agentToolRejected(SLACK_MESSAGE_REFUSAL.UNREADABLE));
  }

  const agent = callerAgent(call.caller);

  if (agent === undefined)
    return Effect.succeed(agentToolRejected(SLACK_MESSAGE_REFUSAL.NOT_AGENT));
  const { text } = read.success;

  return orStoreRefusal(
    Effect.gen(function* () {
      const bot = yield* SlackBot;
      const thread = yield* currentSlackThread(agent.id);

      if (!bot.configured || Option.isNone(thread)) {
        return agentToolRejected(SLACK_MESSAGE_REFUSAL.NO_THREAD);
      }

      const posted = yield* bot.reply(thread.value.channelId, thread.value.threadTs, {
        text: slackClipped(text, NOTIFICATION_CHARS),
        blocks: [slackMarkdownBlock(text)],
      });

      if (Option.isNone(posted)) return agentToolRejected(SLACK_MESSAGE_REFUSAL.NOT_POSTED);

      // Note that the answer names the thread it went to, so the turn's end skips its final message only in that thread.
      const answer: WireRecord = {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        channelId: thread.value.channelId,
        threadTs: thread.value.threadTs,
      };

      return answer;
    }),
  );
}
