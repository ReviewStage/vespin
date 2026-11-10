/**
 * slack-bot-operations.ts -- a workspace's own Slack bot read, connected, disconnected, and set, as every door asks for it.
 *
 * The hosted procedures (`slack-bot-procedures.ts`) and the member MCP
 * server's tools (`../member-mcp/tools.ts`) are doors over these: each takes
 * the account asking and the workspace it names, checks the account's role
 * there as the app does, and answers the bot as it then stands.
 *
 * - The read takes any member, and answers whether this deployment holds
 *   the bot and the Slack team the workspace's bot is connected to.
 * - A connect takes an owner or admin, asks Slack which team the bot's token
 *   answers for (`auth.test`), and keeps it as the workspace's installation.
 * - A disconnect takes an owner or admin, and deletes the installation,
 *   every member's Slack id with it; the bot stays installed in Slack, where
 *   only Slack's admins remove it.
 * - The notifications switch takes any member, and turns their own Slack
 *   notifications on or off, in every workspace.
 * - The default repository takes an owner or admin, and names the
 *   repository Slack starts default to, one the workspace reaches as GitHub
 *   spells it, or clears it.
 * - A channel change takes an owner or admin, and puts the bot in a public
 *   channel or takes it out of one, forgetting the channel's repository as
 *   it leaves, and names or clears the channel's default repository.
 *
 * The read answers an owner or admin the team's channels as Slack lists
 * them, each with its default repository; a member is answered none. A
 * write answers the transaction its row was written in beside the bot,
 * which a desktop holding the workspace's integrations live waits for
 * (`WORKSPACE_INTEGRATIONS_READ`); a write that wrote no row answers none.
 * A workspace the account is not in is not found, whatever it asked.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  deleteSlackInstallation,
  linkSlackInstallation,
  type SlackChannelRepository,
  slackNotificationsOn,
  slackStartRepositories,
  workspaceSlackInstallation,
  writeSlackChannelRepository,
  writeSlackDefaultRepository,
  writeSlackNotifications,
} from "@repo/database/models/slack-installation-store";
import type { Workspace } from "@repo/database/models/workspace-store";
import type {
  SlackBotChannel,
  WorkspaceSlackBot,
  workspaceSlackBotChannelRequestSchema,
} from "@repo/features/slack-bot-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import { Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { answeredWorkspace, managedWorkspace } from "../accounts/workspace-access.js";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { SlackBot, type SlackBotService } from "./slack-bot.js";

/** One channel changed: the bot put in it or taken out of it, and its default repository named or cleared, either or both. */
export type SlackChannelChange = Omit<
  typeof workspaceSlackBotChannelRequestSchema.Type,
  "workspaceId"
>;

/** What a write that names a repository reaches: the store, the bot, and GitHub through the App. */
type SlackBotWriteServices = DatabaseServices | SlackBot | GitHubApp | HttpClient.HttpClient;

/** The team's channels as Settings lists them, each with its default repository; none where Slack could not be read. */
const listedChannels = Effect.fn("web/slackBotChannels")(function* (
  bot: SlackBotService,
  channels: readonly SlackChannelRepository[],
) {
  const listed = yield* bot.channels;
  if (Option.isNone(listed)) return undefined;
  const named = new Map(channels.map((channel) => [channel.channelId, channel.repository]));
  return listed.value.map((channel): SlackBotChannel => {
    const repository = named.get(channel.id);
    return repository === undefined ? channel : { ...channel, repository };
  });
});

/**
 * The workspace's Slack bot as the wire carries it to the member: the team,
 * their own switch, and the default repository where it is connected, and,
 * to an owner or admin, the team's channels.
 */
const workspaceSlackBot = Effect.fn("web/workspaceSlackBot")(function* (
  workspace: Workspace,
  userId: string,
): Effect.fn.Return<WorkspaceSlackBot, HostedRefusal, DatabaseServices | SlackBot> {
  const bot = yield* SlackBot;
  const { configured } = bot;
  const installation = yield* hostedStoreOrUnavailable(workspaceSlackInstallation(workspace.id));
  if (Option.isNone(installation)) return { configured };
  const { teamId, teamName } = installation.value;
  const notifications = yield* hostedStoreOrUnavailable(slackNotificationsOn(userId));
  const { defaultRepository, channels } = yield* hostedStoreOrUnavailable(
    slackStartRepositories(workspace.id),
  );
  const listed = managesWorkspace(workspace) ? yield* listedChannels(bot, channels) : undefined;
  return {
    configured,
    team: { id: teamId, name: teamName },
    notifications,
    ...(defaultRepository === null ? undefined : { defaultRepository }),
    ...(listed === undefined ? undefined : { channels: listed }),
  };
});

/** The bot as it then stands, with the transaction a write committed its row in, where it wrote one. */
function withTxid(slackBot: WorkspaceSlackBot, txid: Option.Option<string>): WorkspaceSlackBot {
  return Option.match(txid, {
    onNone: () => slackBot,
    onSome: (id) => ({ ...slackBot, txid: id }),
  });
}

/** The repository named, as GitHub spells it, where the workspace reaches it; null clears. */
const reachedRepository = Effect.fn("web/slackBotRepository")(function* (
  workspaceId: string,
  userId: string,
  repository: string | null,
): Effect.fn.Return<
  string | null,
  HostedRefusal,
  DatabaseServices | GitHubApp | HttpClient.HttpClient
> {
  if (repository === null) return null;
  const reached = yield* workspaceRepository(workspaceId, repository, userId);
  return reached.repository.fullName;
});

/** The workspace named, where an owner or admin of it asks and its bot is connected; the bot as the deployment holds it. */
const connectedWorkspace = Effect.fn("web/slackBotConnected")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const installation = yield* hostedStoreOrUnavailable(workspaceSlackInstallation(workspace.id));
  if (Option.isNone(installation)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const bot = yield* SlackBot;
  if (!bot.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return { workspace, bot };
});

/** The workspace's Slack bot, to any member of it. */
export const readSlackBot = Effect.fn("web/readSlackBot")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  return yield* workspaceSlackBot(workspace, userId);
});

/** The bot connected to the team its token answers for; unavailable where the deployment holds no bot or Slack did not answer. */
export const connectSlackBot = Effect.fn("web/connectSlackBot")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const bot = yield* SlackBot;
  if (!bot.configured) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  const team = yield* bot.team.pipe(
    Effect.tapError((failure) =>
      Effect.logWarning("The Slack bot could not read its team", failure.message),
    ),
    Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
  );
  const txid = yield* hostedStoreOrUnavailable(
    linkSlackInstallation({
      organizationId: workspace.id,
      teamId: team.id,
      teamName: team.name,
      userId,
    }),
  );
  return withTxid(yield* workspaceSlackBot(workspace, userId), Option.some(txid));
});

/** The bot disconnected from the workspace; disconnecting one already gone answers it as it stands. */
export const disconnectSlackBot = Effect.fn("web/disconnectSlackBot")(function* (
  userId: string,
  workspaceId: string,
) {
  const workspace = yield* managedWorkspace(userId, workspaceId);
  const txid = yield* hostedStoreOrUnavailable(deleteSlackInstallation(workspace.id));
  return withTxid(yield* workspaceSlackBot(workspace, userId), txid);
});

/** The member's own Slack notifications turned on or off, which holds in every workspace, answered with the transaction it was written in. */
export const setSlackNotifications = Effect.fn("web/setSlackNotifications")(function* (
  userId: string,
  workspaceId: string,
  notifications: boolean,
) {
  const workspace = yield* answeredWorkspace(userId, workspaceId);
  const txid = yield* hostedStoreOrUnavailable(writeSlackNotifications(userId, notifications));
  return { ...(yield* workspaceSlackBot(workspace, userId)), txid };
});

/** The workspace's default repository for Slack starts named, as GitHub spells it, or cleared with null. */
export const setSlackDefaultRepository = Effect.fn("web/setSlackDefaultRepository")(function* (
  userId: string,
  workspaceId: string,
  repository: string | null,
): Effect.fn.Return<WorkspaceSlackBot, HostedRefusal, SlackBotWriteServices> {
  const { workspace } = yield* connectedWorkspace(userId, workspaceId);
  const reached = yield* reachedRepository(workspace.id, userId, repository);
  const txid = yield* hostedStoreOrUnavailable(writeSlackDefaultRepository(workspace.id, reached));
  return withTxid(yield* workspaceSlackBot(workspace, userId), txid);
});

/** The bot put in a public channel or taken out of one, and the channel's default repository named or cleared; unavailable where Slack refused. */
export const changeSlackChannel = Effect.fn("web/changeSlackChannel")(function* (
  userId: string,
  workspaceId: string,
  change: SlackChannelChange,
): Effect.fn.Return<WorkspaceSlackBot, HostedRefusal, SlackBotWriteServices> {
  const { workspace, bot } = yield* connectedWorkspace(userId, workspaceId);
  const { channelId } = change;
  if (change.member === false) {
    if (!(yield* bot.leave(channelId))) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    // A channel the bot left keeps no repository, so a later join starts from the workspace's.
    const txid = yield* hostedStoreOrUnavailable(
      writeSlackChannelRepository(workspace.id, channelId, null),
    );
    return withTxid(yield* workspaceSlackBot(workspace, userId), txid);
  }
  if (change.member === true && !(yield* bot.join(channelId))) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  let txid = Option.none<string>();
  if (change.repository !== undefined) {
    const repository = yield* reachedRepository(workspace.id, userId, change.repository);
    txid = yield* hostedStoreOrUnavailable(
      writeSlackChannelRepository(workspace.id, channelId, repository),
    );
  }
  return withTxid(yield* workspaceSlackBot(workspace, userId), txid);
});
