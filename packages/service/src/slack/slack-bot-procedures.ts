/**
 * slack-bot-procedures.ts -- a workspace's own Slack bot read, connected, and disconnected, and the repositories and channels its Slack starts use.
 *
 * Six procedures the signed-in desktop calls with its bearer:
 *
 * - `GET /api/workspaces/slack-bot` takes any member, and answers whether
 *   this deployment holds the bot and the Slack team the workspace's bot is
 *   connected to.
 * - `POST /api/workspaces/slack-bot/connect` takes an owner or admin, asks
 *   Slack which team the bot's token answers for (`auth.test`), and keeps
 *   it as the workspace's installation.
 * - `POST /api/workspaces/slack-bot/disconnect` takes an owner or admin,
 *   and deletes the installation, every member's Slack id with it; the
 *   bot stays installed in Slack, where only Slack's admins remove it.
 * - `POST /api/workspaces/slack-bot/notifications` takes any member, and
 *   turns their own Slack notifications on or off, in every workspace.
 * - `POST /api/workspaces/slack-bot/repository` takes an owner or admin, and
 *   names the repository Slack starts default to, one the workspace reaches
 *   as GitHub spells it, or clears it.
 * - `POST /api/workspaces/slack-bot/channel` takes an owner or admin, and
 *   puts the bot in a public channel or takes it out of one, forgetting the
 *   channel's repository as it leaves, and names or clears the channel's
 *   default repository.
 *
 * Each is the operation of the same name (`slack-bot-operations.ts`),
 * which the member MCP server's Slack bot tools run too, and which says what
 * each answers.
 *
 * A workspace the account is not in is not found, whatever it asked. The
 * bearer is resolved before the body is read, by the middleware on the
 * resource.
 */

import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  changeSlackChannel,
  connectSlackBot,
  disconnectSlackBot,
  readSlackBot,
  setSlackDefaultRepository,
  setSlackNotifications,
} from "./slack-bot-operations.js";

export interface SlackBotProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The workspace Slack bot resource: connect and disconnect to an owner or admin, and the read and the member's own switch to any member, each the operation of the same name (`slack-bot-operations.ts`). */
export function slackBotProcedures(seams: SlackBotProcedureSeams) {
  const resource = hosted.workspaceSlackBot.use(accountMiddleware(seams.resolveUserId));
  return {
    read: resource.read.effect(function* ({ input, context }) {
      return yield* readSlackBot(context.userId, input.workspaceId);
    }),
    connect: resource.connect.effect(function* ({ input, context }) {
      return yield* connectSlackBot(context.userId, input.workspaceId);
    }),
    disconnect: resource.disconnect.effect(function* ({ input, context }) {
      return yield* disconnectSlackBot(context.userId, input.workspaceId);
    }),
    notifications: resource.notifications.effect(function* ({ input, context }) {
      return yield* setSlackNotifications(context.userId, input.workspaceId, input.notifications);
    }),
    repository: resource.repository.effect(function* ({ input, context }) {
      return yield* setSlackDefaultRepository(context.userId, input.workspaceId, input.repository);
    }),
    channel: resource.channel.effect(function* ({ input: { workspaceId, ...change }, context }) {
      return yield* changeSlackChannel(context.userId, workspaceId, change);
    }),
  };
}
