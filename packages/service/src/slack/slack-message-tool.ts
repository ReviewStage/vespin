/**
 * slack-message-tool.ts -- `send_slack_message`: one message a coding agent sends as the Slack bot, in its own Slack thread, a channel the bot is in, or a member's DM.
 *
 * With no place named, the message goes to the agent's current thread
 * (`currentSlackThread`), the one a Slack thread speaks for it in; a
 * `channel` posts there, at its top level or under `thread`; a `member`
 * DMs that member of the workspace (`SlackBot.dm`), or replies under
 * `thread` in that DM. Every call is reached through `slack-reach.ts`:
 * the agent's own workspace's team, and a channel the bot is in.
 *
 * Each message is a `markdown` block, which Slack draws as standard
 * Markdown; a workspace member's mention in it becomes a real Slack
 * mention where their Slack id is known, and their name otherwise. The
 * answer names where it landed: the channel, the message's timestamp, the
 * thread's, and its link, so the agent can reply or react to it later.
 * The thread hears nothing else of the turn but that it failed or was
 * stopped (`slack-agent-starts.ts`'s `postTurnToSlack`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  decodeMention,
  MENTION_KIND,
  memberMentionOf,
  mentionLinksIn,
  mentionName,
} from "@repo/features/mention-link";
import { PRODUCT_NAME } from "@repo/features/product-name";
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
import type { SlackBot, SlackMessage } from "./slack-bot.js";
import { slackClipped, slackMarkdownBlock } from "./slack-markdown.js";
import { reachChannel, reachSlack, SLACK_USE, type SlackReach } from "./slack-reach.js";

/** The most characters one message may spell. */
const SLACK_MESSAGE_CHARS = 4_000;

/** The most characters of a message the notification's plain text says; the block holds the rest. */
const NOTIFICATION_CHARS = 2_500;

/** Why a message was not sent, in words the model can act on. */
const SLACK_MESSAGE_REFUSAL = {
  UNREADABLE: `Not sent: pass text, one short message of at most ${SLACK_MESSAGE_CHARS} characters, and at most one of channel and member.`,
  NO_THREAD:
    "Not sent: no Slack thread speaks for you, so name a channel or a member, or answer in your final message as you would anywhere else.",
  NOT_MEMBER: "Not sent: that member is no member of your workspace.",
  NO_SLACK_ID:
    "Not sent: that member's Slack account could not be found, so the bot cannot write to them.",
  NOT_POSTED: "Not sent: Slack did not take the message; send it again.",
  NOT_AGENT: "Not sent: only a coding agent sends a Slack message.",
} as const;

/** How an agent behaves in Slack, which every Slack tool's description carries, so every agent sees it. */
export const SLACK_MANNERS =
  "Talk in Slack like a coworker, not a report: casual, plain words, the answer first. Most " +
  "replies are one or two short messages of a sentence or two each, one call per message, and " +
  "rarely more than three. Leave out how you found it, file paths, numbers, and caveats unless " +
  "they change the answer, and offer more if they want it. No headings, bold labels, or long " +
  "lists. Speak only when you add something its readers don't already have; staying quiet is " +
  'often the right call. Send no "on it" or progress messages, and don\'t nudge a thread that ' +
  "has gone quiet. Where people are talking to each other, stay out unless a message is aimed " +
  "at you.";

const SEND_SLACK_MESSAGE_INPUT = Schema.Struct({
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(SLACK_MESSAGE_CHARS)),
    "One message, in Markdown, as a person would send it in Slack: a sentence or two. A " +
      "workspace member's mention link becomes a real Slack mention.",
  ),
  channel: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty()),
      `A channel the bot is in, by the id or name ${AGENT_TOOL.LIST_SLACK_CHANNELS} answered; ` +
        "leave it and member out for your own Slack thread.",
    ),
  ),
  member: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty()),
      "A member of your workspace to DM, by their mention link or user id.",
    ),
  ),
  thread: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty()),
      "The `ts` of a message to reply under, in the channel, the DM, or your own thread's channel.",
    ),
  ),
});

type SendSlackMessageInput = typeof SEND_SLACK_MESSAGE_INPUT.Type;

const readInput = Schema.decodeUnknownResult(SEND_SLACK_MESSAGE_INPUT);

/** `send_slack_message` as a coding agent is offered it: its name, its words, and its input. */
export const SEND_SLACK_MESSAGE_TOOL = {
  name: AGENT_TOOL.SEND_SLACK_MESSAGE,
  description:
    "Send one message as the Slack bot: in the Slack thread you were started from or last " +
    "written in where you name no place, in a channel the bot is in, or to a workspace member " +
    "as a DM, at the top level or under `thread`. " +
    `${SLACK_MANNERS} Where the work opened a pull request, your closing message carries your ` +
    `own ${PRODUCT_NAME} link, your agent's page, beside the pull request's, since nothing ` +
    "else posts it. Answers `accepted` with the " +
    "message's `channelId`, `ts`, `threadTs`, and `link`, or `rejected` and why.",
  inputSchema: SEND_SLACK_MESSAGE_INPUT,
} as const;

/** The member's account id an agent named, by their mention link or the id alone. */
function namedMember(named: string): string {
  const mention = memberMentionOf(named);

  return mention?.kind === MENTION_KIND.PERSON ? mention.userId : named;
}

/**
 * The words with each workspace member's mention link written as Slack's
 * own mention where their Slack id is known, and as their name otherwise;
 * every other link left for the block to write.
 */
const withSlackMentions = Effect.fn("web/slackMentions")(function* (
  reach: SlackReach,
  text: string,
) {
  const { organizationId } = reach.agent;
  let out = "";
  let at = 0;

  for (const link of mentionLinksIn(text)) {
    const mention = decodeMention(link.target, null);

    if (mention?.kind !== MENTION_KIND.PERSON) continue;
    const member = yield* isWorkspaceMember(mention.userId, organizationId);

    const slackId = member ? yield* reach.bot.memberSlackId(mention.userId) : Option.none<string>();

    const written = Option.match(slackId, {
      onNone: () => mentionName(link.label),
      onSome: (id) => `<@${id}>`,
    });

    out += text.slice(at, link.start) + written;
    at = link.end;
  }

  return out + text.slice(at);
});

/** The message posted where the input names, through the reach; the refusal's words where it may not go there or Slack did not take it. */
const postedMessage = Effect.fn("web/slackAgentPost")(function* (
  reach: SlackReach,
  input: SendSlackMessageInput,
  text: string,
) {
  const content = {
    text: slackClipped(text, NOTIFICATION_CHARS),
    blocks: [slackMarkdownBlock(text)],
  };

  const { bot, agent } = reach;
  let posted: Option.Option<SlackMessage>;
  let threadTs = input.thread;

  if (input.member !== undefined) {
    const userId = namedMember(input.member);

    if (!(yield* isWorkspaceMember(userId, agent.organizationId))) {
      return Result.fail<string>(SLACK_MESSAGE_REFUSAL.NOT_MEMBER);
    }

    if (input.thread === undefined) {
      posted = yield* bot.dm(userId, content);
    } else {
      const slackId = yield* bot.memberSlackId(userId);

      if (Option.isNone(slackId)) return Result.fail<string>(SLACK_MESSAGE_REFUSAL.NO_SLACK_ID);
      // Note that a user id as the channel writes to the bot's own conversation with them.
      posted = yield* bot.reply(slackId.value, input.thread, content);
    }
  } else {
    const current = Option.getOrUndefined(reach.thread);
    const named = input.channel ?? current?.channelId;

    if (named === undefined) return Result.fail<string>(SLACK_MESSAGE_REFUSAL.NO_THREAD);
    const channel = yield* reachChannel(reach, named, SLACK_USE.POST);

    if (Result.isFailure(channel)) return Result.fail<string>(channel.failure);

    // Note that naming no place at all replies in the agent's own thread.
    if (input.channel === undefined) threadTs ??= current?.threadTs;

    posted =
      threadTs === undefined
        ? yield* bot.post(channel.success.id, content)
        : yield* bot.reply(channel.success.id, threadTs, content);
  }

  if (Option.isNone(posted)) return Result.fail<string>(SLACK_MESSAGE_REFUSAL.NOT_POSTED);

  return Result.succeed({ message: posted.value, threadTs });
});

/** One call of `send_slack_message`: the message posted where the input names, refused with why where it may not go there or Slack did not take it. */
export function runSendSlackMessage(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, SlackBot | DatabaseServices> {
  const read = readInput(input);

  if (
    Result.isFailure(read) ||
    (read.success.channel !== undefined && read.success.member !== undefined)
  ) {
    return Effect.succeed(agentToolRejected(SLACK_MESSAGE_REFUSAL.UNREADABLE));
  }

  const agent = callerAgent(call.caller);

  if (agent === undefined)
    return Effect.succeed(agentToolRejected(SLACK_MESSAGE_REFUSAL.NOT_AGENT));

  return orStoreRefusal(
    Effect.gen(function* () {
      const reached = yield* reachSlack(agent);

      if (Result.isFailure(reached)) return agentToolRejected(reached.failure);
      const reach = reached.success;
      const text = yield* withSlackMentions(reach, read.success.text);
      const posted = yield* postedMessage(reach, read.success, text);

      if (Result.isFailure(posted)) return agentToolRejected(posted.failure);
      const { message, threadTs } = posted.success;
      const link = yield* reach.bot.permalink(message.channel, message.ts);

      // Note that the answer names where it went, so the agent can reply or react to it later.
      const answer: WireRecord = {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        channelId: message.channel,
        ts: message.ts,
        ...(threadTs === undefined ? undefined : { threadTs }),
        ...(Option.isSome(link) ? { link: link.value } : undefined),
      };

      return answer;
    }),
  );
}
