/**
 * slack-reactions.ts -- a member's 👍 or 👎 on a message the bot posted in an agent's Slack thread, handed to that agent as feedback on it.
 *
 * Our Slack route hands each `reaction_added` event here
 * (`slack-events-app.ts`). One is heard only where it is 👍 or 👎 (any skin
 * tone), a member added it, never the bot itself, whose reactions an
 * agent adds with `react_slack` land on members' messages, and it is on a message the bot posted (`item_user`), an agent's
 * own `send_slack_message` among them. The message is then read on the bot's
 * token for its words and the thread it stands in
 * (`SlackWorkspaceBot.message`), and that thread must speak for an agent
 * (`slack_agent_thread`), whatever kept it: a start, a run's result, or the
 * agent's own post. Any other event, emoji, or thread is dropped with one
 * fixed line, as is Slack's own retry.
 *
 * The reacting member is found as a thread message's writer is (`memberIn`),
 * and the agent is handed one short line as theirs, through the path a
 * thread message takes (`steerAgent`), keyed by Slack's event id: the
 * reaction, the start of the message it was on, and the message's link.
 * Only an agent that stands, unarchived and visible to the member, hears it,
 * since a reaction is no reason to bring one back. A busy agent takes the
 * line into the turn it is running, read at its next step, as any message
 * joining a turn is, so a reaction never opens a turn of its own beside one
 * running; an idle agent hears it in a turn of its own. The bot says and
 * marks nothing for a reaction, and a refusal is logged by its kind alone.
 */

import { readVisibleAgent } from "@repo/database/models/agent-store";
import {
  slackAgentThreadAt,
  slackTeamWorkspaces,
} from "@repo/database/models/slack-installation-store";
import { storeWriter } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { causeKind } from "@repo/runtime/effect";
import {
  EXCESS_KEYS,
  MESSAGE_CHANNEL,
  SLACK_LINE_BOUNDS,
  type UnparsedWireValue,
} from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Option, Predicate, Result, Schema } from "effect";
import { routedSessions } from "../agents/coder-host/runtime-sessions.js";
import { steerAgent } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { afterResponse } from "../http/after-response.js";
import { memberIn } from "./slack-agent-starts.js";
import { SlackBot } from "./slack-bot.js";

/** The event read: a reaction added to an item. */
const SLACK_REACTION_ADDED = "reaction_added";

/** The kind of item a reaction is heard on: a message. */
const SLACK_MESSAGE_ITEM = "message";

/** The feedback a reaction gives, as the agent reads it. */
const FEEDBACK = { UP: "👍", DOWN: "👎" } as const;

type Feedback = (typeof FEEDBACK)[keyof typeof FEEDBACK];

/** The reactions heard as feedback, by Slack's names for them, each spelling it takes. */
const FEEDBACK_OF_REACTION: ReadonlyMap<string, Feedback> = new Map([
  ["+1", FEEDBACK.UP],
  ["thumbsup", FEEDBACK.UP],
  ["-1", FEEDBACK.DOWN],
  ["thumbsdown", FEEDBACK.DOWN],
]);

/** What a skin tone adds to a reaction's name, as `+1::skin-tone-2`. */
const SKIN_TONE_MARK = "::";

/** The most of the message's words the line quotes. */
const QUOTE_CHARS = 200;

/** Why a reaction was not handed on, as its log line names it; a fixed word, never anything Slack wrote. */
const REACTION_DROP = {
  RETRY: "retry",
  NOT_FEEDBACK: "not_feedback",
  FROM_BOT: "from_bot",
  NOT_BOT_MESSAGE: "not_bot_message",
} as const;

type ReactionDrop = (typeof REACTION_DROP)[keyof typeof REACTION_DROP];

/** A reaction added as far as it is read: the team, Slack's id for the event, the bot's own user, who reacted with what, and the item it is on. */
const ReactionAddedSchema = Schema.Struct({
  type: Schema.Literal("event_callback"),
  team_id: Schema.String,
  event_id: Schema.String,
  authorizations: Schema.optionalKey(
    Schema.Array(Schema.Struct({ user_id: Schema.optionalKey(Schema.String) })),
  ),
  event: Schema.Struct({
    type: Schema.Literal(SLACK_REACTION_ADDED),
    user: Schema.String,
    reaction: Schema.String,
    item_user: Schema.optionalKey(Schema.String),
    item: Schema.Struct({
      type: Schema.String,
      channel: Schema.optionalKey(Schema.String),
      ts: Schema.optionalKey(Schema.String),
    }),
  }),
});

type ReactionAdded = typeof ReactionAddedSchema.Type;

/** A reaction heard as feedback on a bot's message, as it is acted on. */
interface SlackFeedback {
  readonly teamId: string;
  readonly eventId: string;
  readonly slackUserId: string;
  readonly channel: string;
  readonly ts: string;
  readonly feedback: Feedback;
}

/** One fixed line per reaction heard: what came of it. */
function heardLine(outcome: string): Effect.Effect<void> {
  return Effect.logInfo("A Slack reaction was heard", { outcome });
}

/** The reaction as feedback on a message the bot posted, or why it is not: a retry, another emoji, the bot's own, or on anything but the bot's message. */
function feedbackOf(added: ReactionAdded, retried: boolean): SlackFeedback | ReactionDrop {
  const { event } = added;

  if (retried) return REACTION_DROP.RETRY;
  const feedback = FEEDBACK_OF_REACTION.get(event.reaction.split(SKIN_TONE_MARK)[0] ?? "");

  if (feedback === undefined) return REACTION_DROP.NOT_FEEDBACK;
  const botUserId = added.authorizations?.[0]?.user_id;

  // Note that a bot whose user is unknown cannot tell its own reactions or messages apart, so nothing is heard.
  if (botUserId === undefined || event.user === botUserId) return REACTION_DROP.FROM_BOT;
  const { channel, ts } = event.item;

  if (
    event.item.type !== SLACK_MESSAGE_ITEM ||
    channel === undefined ||
    ts === undefined ||
    event.item_user !== botUserId
  ) {
    return REACTION_DROP.NOT_BOT_MESSAGE;
  }

  return {
    teamId: added.team_id,
    eventId: added.event_id,
    slackUserId: event.user,
    channel,
    ts,
    feedback,
  };
}

/** The start of the message's words on one line, marked where it was cut. */
function quoteOf(text: string): string {
  const line = text.replace(/\s+/gu, " ").trim();

  return line.length <= QUOTE_CHARS ? line : `${line.slice(0, QUOTE_CHARS)}…`;
}

/** The line the agent reads: the reaction, the message it was on, and that it is feedback asking no reply. */
function feedbackPrompt(
  feedback: Feedback,
  quote: string,
  permalink: Option.Option<string>,
): string {
  const where = Option.match(permalink, {
    onNone: () => "in the Slack thread",
    onSome: (link) => `in the Slack thread (${link})`,
  });

  return [
    `${feedback} on your message: "${quote}"`,
    "---",
    `A member reacted ${feedback} to that message, which you sent ${where}. Take it as their feedback on it; it asks no reply in Slack.`,
  ].join("\n\n");
}

/**
 * The reaction handed to the agent whose thread holds the message, as the
 * header says; nothing where the message, its thread's agent, the member,
 * or a standing agent is not found.
 */
const handFeedback = Effect.fnUntraced(function* (reacted: SlackFeedback) {
  const slack = yield* SlackBot;

  if (!slack.configured) return;

  const bots = yield* Effect.forEach(yield* slackTeamWorkspaces(reacted.teamId), (organizationId) =>
    Effect.map(slack.forWorkspace(organizationId), (bot) => ({ organizationId, bot })),
  );

  // Note that the message is read once, on the first token the team's workspaces hold, because its thread is found by it.
  const reading = bots.find(({ bot }) => bot.connected)?.bot;

  if (reading === undefined) return;
  const message = yield* reading.message(reacted.channel, reacted.ts);

  if (Option.isNone(message) || !message.value.bot) return;

  for (const { organizationId, bot } of bots) {
    const kept = yield* slackAgentThreadAt(organizationId, reacted.channel, message.value.threadTs);

    if (Option.isNone(kept)) continue;

    if (!bot.connected) return;
    const email = bot.userEmail(reacted.slackUserId);
    const member = yield* memberIn(bot, email, organizationId, reacted);

    if (Option.isNone(member)) return;
    const userId = member.value;
    const agent = yield* readVisibleAgent(userId, kept.value.agentId);

    // A reaction brings no agent back: only one standing hears it.
    if (Option.isNone(agent) || agent.value.archivedAt !== null) return;
    const permalink = yield* bot.permalink(reacted.channel, reacted.ts);
    const quote = quoteOf(message.value.text);

    const url = Option.getOrUndefined(
      Option.filter(permalink, (link) => link.length <= SLACK_LINE_BOUNDS.URL_CHARS),
    );

    yield* steerAgent(
      yield* routedSessions(userId),
      storeWriter({ tools: CODER_TOOL_SET }),
      userId,
      agent.value,
      {
        text: feedbackPrompt(reacted.feedback, quote, permalink),
        // A reaction's line hands the agent no servers.
        serverWords: "",
        clientKey: reacted.eventId,
        sender: { kind: MESSAGE_SENDER.MEMBER, userId },
        metadata: {
          channel: MESSAGE_CHANNEL.SLACK,
          words: `${reacted.feedback} on "${quote}"`,
          ...(url === undefined ? undefined : { url }),
        },
      },
    );

    return;
  }
});

/**
 * The event acted on once the answer has left, where it is a reaction
 * added; none where it is any other event, for the route to read as one.
 * A reaction not heard as feedback is dropped with its fixed line, and a
 * failure is logged by its kind alone.
 */
export function actOnSlackReaction(payload: UnparsedWireValue, retried: boolean) {
  const added = readEither(ReactionAddedSchema, { excess: EXCESS_KEYS.DROP })(payload);

  if (Result.isFailure(added)) return undefined;
  const reacted = feedbackOf(added.success, retried);

  if (Predicate.isString(reacted)) return heardLine(reacted);

  return Effect.andThen(
    heardLine("acted"),
    afterResponse(
      "a Slack reaction",
      handFeedback(reacted).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("a Slack reaction was not handed to the agent", {
            failure: causeKind(cause),
          }),
        ),
      ),
    ),
  );
}
