/**
 * slack-reach.ts -- where a coding agent may act in Slack as the bot: its own workspace's team, and the channels the bot is in.
 *
 * Every Slack tool an agent is offered (`send_slack_message`,
 * `list_slack_channels`, `read_slack`, `react_slack`) asks here first.
 *
 * - The agent's workspace must hold its own bot token, granted when it
 *   installed the Slack app, and every call is made on it
 *   (`SlackBot.forWorkspace`), so one workspace's agent never acts in
 *   another's Slack; the team it answers for (`auth.test`) names the bot's
 *   own user.
 * - A channel is one the bot is in (`conversations.list`, `member`),
 *   private or not. Note that what an agent reads in a private channel
 *   lands in its transcript, which anyone who can open the task reads.
 * - The agent's current thread (`currentSlackThread`) is where it was
 *   addressed, so a post or a reaction in its channel, and a read of the
 *   thread itself, need no lookup.
 * - Who the agent acts for in Slack (`slackAsker`) is its starter, or for a
 *   Manager the member who asked for its turn under way (`turnAsker`): their
 *   own lines are not outside, and a thread it posts is kept for them.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { Agent } from "@repo/database/models/agent-store";
import {
  currentSlackThread,
  type SlackThread,
} from "@repo/database/models/slack-installation-store";
import { turnAsker } from "@repo/database/models/turn-asker";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { Effect, Option, Result } from "effect";
import { SlackBot, type SlackChannel, type SlackWorkspaceBot } from "./slack-bot.js";

/** Why a Slack tool did not act, in words the model can act on. */
export const SLACK_REACH_REFUSAL = {
  NOT_CONNECTED:
    "Refused: your workspace has not connected the Slack bot; an owner or admin connects it under Settings.",
  UNREACHABLE: "Refused: Slack did not answer; try again in a minute.",
  NOT_IN_CHANNEL: `Refused: the Slack bot is not in that channel. ${AGENT_TOOL.LIST_SLACK_CHANNELS} lists where it is; ask a person to add the bot to the channel.`,
} as const;

export type SlackReachRefusal = (typeof SLACK_REACH_REFUSAL)[keyof typeof SLACK_REACH_REFUSAL];

/** What a Slack tool acts through once the workspace is reached: the bot, the team, the agent, and its current thread where it has one. */
export interface SlackReach {
  readonly bot: SlackWorkspaceBot;
  readonly agent: Agent;
  readonly botUserId: string | undefined;
  readonly thread: Option.Option<SlackThread>;
}

/** A channel the agent may act in: its id, and its name where the bot's list named it. */
export interface ReachedChannel {
  readonly id: string;
  readonly name?: string;
}

/** What a channel is reached for: a post or a reaction, which the agent's current thread's channel takes, or a read, which only the current thread itself does. */
export const SLACK_USE = { POST: "post", READ: "read" } as const;

type SlackUse = (typeof SLACK_USE)[keyof typeof SLACK_USE];

/** A channel as an agent names it: its id, or its name with or without `#`. */
function channelNamed(channels: readonly SlackChannel[], named: string): SlackChannel | undefined {
  const name = named.replace(/^#/u, "");

  return channels.find((channel) => channel.id === named || channel.name === name);
}

/**
 * The agent's workspace reached in Slack: its own bot connected, and the
 * team its token answers for read; the refusal's words otherwise.
 */
export const reachSlack = Effect.fn("web/reachSlack")(function* (
  agent: Agent,
): Effect.fn.Return<
  Result.Result<SlackReach, SlackReachRefusal>,
  StoreFailure,
  SlackBot | DatabaseServices
> {
  const bot = yield* (yield* SlackBot).forWorkspace(agent.organizationId);

  if (!bot.connected) return Result.fail(SLACK_REACH_REFUSAL.NOT_CONNECTED);

  const team = yield* bot.team.pipe(
    Effect.map(Option.some),
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning("The Slack bot could not read its team", failure.message),
        Option.none(),
      ),
    ),
  );

  if (Option.isNone(team)) return Result.fail(SLACK_REACH_REFUSAL.UNREACHABLE);
  const thread = yield* currentSlackThread(agent.id);

  return Result.succeed({ bot, agent, botUserId: team.value.botUserId, thread });
});

/** The member the agent acts for in Slack, as the module says: a Manager's asker, any other agent's starter. */
export function slackAsker(
  reach: SlackReach,
): Effect.Effect<string, StoreFailure, DatabaseServices> {
  const { agent } = reach;

  return agent.kind === AGENT_KIND.MANAGER
    ? turnAsker({ userId: agent.userId, conversationId: agent.conversationId })
    : Effect.succeed(agent.userId);
}

/**
 * The channel an agent named, where it may act there for the use given:
 * the current thread's channel for a post, or the current thread itself
 * for a read, as it stands; otherwise a channel the bot is in.
 */
export const reachChannel = Effect.fn("web/reachSlackChannel")(function* (
  reach: SlackReach,
  named: string,
  use: SlackUse,
  threadTs?: string,
): Effect.fn.Return<Result.Result<ReachedChannel, SlackReachRefusal>, never, DatabaseServices> {
  const current = Option.getOrUndefined(reach.thread);

  const inCurrent =
    current !== undefined &&
    current.channelId === named &&
    (use === SLACK_USE.POST || threadTs === current.threadTs);

  if (inCurrent) return Result.succeed({ id: named });
  const listed = yield* reach.bot.channels;

  if (Option.isNone(listed)) return Result.fail(SLACK_REACH_REFUSAL.UNREACHABLE);
  const channel = channelNamed(listed.value, named);

  if (channel === undefined || !channel.member)
    return Result.fail(SLACK_REACH_REFUSAL.NOT_IN_CHANNEL);

  return Result.succeed({ id: channel.id, name: channel.name });
});
