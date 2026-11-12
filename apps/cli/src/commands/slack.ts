/**
 * slack.ts -- `vespin slack show`, `set`, and `disconnect`: the workspace's own Slack bot, as its Settings rows read and set it.
 *
 * `show` reads the bot through `workspaceSlackBot.read` for the workspace
 * the command acts in: whether the deployment holds it, the team it is
 * connected to, the member's own notifications, the default repository for
 * Slack starts, and, to an owner or admin, the team's channels. `set` makes
 * each change it names as its own request, as the Settings rows do: the
 * member's notifications (`notifications`), the workspace's default
 * repository (`repository`), and one channel (`channel`), which `--channel`
 * names by its id or its name as `show` lists them, with `--repo` then the
 * channel's own. `disconnect` disconnects the bot (`disconnect`), asking
 * first unless `--yes` says to go on. Who may change what is the service's
 * to say. Connecting the bot needs a browser and stays in the app.
 */

import { CLI_EXIT } from "@repo/features/cli-exit";
import type { WorkspaceSlackBot } from "@repo/features/slack-bot-wire";
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/cli";
import { answer, CommandFailed, columns, confirmOrYes } from "../output.js";
import { askService, session } from "../session.js";
import { resolveWorkspace } from "../workspace.js";

/** The word `--repo` takes to clear a repository. */
const NONE_WORD = "none";

/** The words `--notifications` takes, each as the switch it sets. */
const NOTIFICATIONS_WORD = { on: true, off: false } as const;

/** The bot as every answer prints it: the wire's answer bar the transaction a desktop waits for. */
function slackBotJson({ txid: _txid, ...slackBot }: WorkspaceSlackBot) {
  return slackBot;
}

/** The bot as a person reads it. */
function slackBotLines(slackBot: WorkspaceSlackBot): string[] {
  if (!slackBot.configured) return ["This service holds no Slack bot."];

  if (slackBot.team === undefined) {
    return [
      "The Slack bot is not connected to this workspace; an owner or admin connects it in Settings.",
    ];
  }

  const channels = slackBot.channels ?? [];

  return [
    `Connected to ${slackBot.team.name} (${slackBot.team.id}).`,
    `  Notifications: ${slackBot.notifications === false ? "off" : "on"}`,
    `  Default repository: ${slackBot.defaultRepository ?? "none"}`,
    ...(channels.length === 0
      ? []
      : [
          "  Channels:",
          ...columns(
            channels.map((channel) => [
              `    ${channel.id}`,
              `${channel.private ? "🔒" : "#"}${channel.name}`,
              channel.member ? "bot in" : "bot out",
              channel.repository ?? "",
            ]),
          ),
        ]),
  ];
}

const showCommand = Command.make("show", {}, () =>
  Effect.gen(function* () {
    const { workspace } = yield* resolveWorkspace;
    const { hosted } = yield* session;

    const slackBot = yield* askService(hosted.workspaceSlackBot.read, {
      workspaceId: workspace.id,
    });

    yield* answer({
      json: slackBotJson(slackBot),
      lines: slackBotLines(slackBot),
      ids: slackBot.team === undefined ? [] : [slackBot.team.id],
    });
  }),
).pipe(
  Command.withDescription(
    "Show the workspace's Slack bot: its team, your notifications, its repositories and channels",
  ),
  Command.withExamples([
    { command: "vespin slack show", description: "The workspace's Slack bot" },
  ]),
);

/** The channel a `--channel` names, by its id or its name with or without `#`, among the channels the bot lists; a usage failure where it names none. */
function channelIdOf(slackBot: WorkspaceSlackBot, named: string) {
  return Effect.gen(function* () {
    const channels = slackBot.channels ?? [];
    const name = named.replace(/^#/, "");
    const found = channels.find((channel) => channel.id === named || channel.name === name);

    if (found !== undefined) return found.id;

    return yield* new CommandFailed({
      exit: CLI_EXIT.USAGE,
      message:
        channels.length === 0
          ? `${named} is no channel the Slack bot lists; only an owner or admin is shown the team's channels.`
          : [
              `${named} is none of the team's channels:`,
              ...channels.map((channel) => `  ${channel.id}  #${channel.name}`),
            ].join("\n"),
    });
  });
}

const setCommand = Command.make(
  "set",
  {
    notifications: Flag.Literals("notifications", ["on", "off"]).pipe(
      Flag.optional,
      Flag.withDescription("Whether the bot writes you, in Slack, the threads that wait on you"),
    ),
    repo: Flag.String("repo").pipe(
      Flag.optional,
      Flag.withDescription(
        "The repository Slack starts work in where a message names none, as owner/name; none clears it. With --channel, that channel's own",
      ),
    ),
    channel: Flag.String("channel").pipe(
      Flag.optional,
      Flag.withDescription("A channel to change, by its id or its name as slack show lists them"),
    ),
    join: Flag.Boolean("join").pipe(
      Flag.withDescription("With --channel: put the bot in it, a public channel alone"),
    ),
    leave: Flag.Boolean("leave").pipe(
      Flag.withDescription("With --channel: take the bot out of it, forgetting its repository"),
    ),
  },
  ({ notifications, repo, channel, join, leave }) =>
    Effect.gen(function* () {
      if (Option.isNone(channel) && (join || leave)) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "--join and --leave name a channel with --channel.",
        });
      }

      if (join && leave) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Name one of --join and --leave.",
        });
      }

      if (Option.isSome(channel) && !join && !leave && Option.isNone(repo)) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Name a change to the channel: --join, --leave, or --repo.",
        });
      }

      if (Option.isNone(notifications) && Option.isNone(repo) && Option.isNone(channel)) {
        return yield* new CommandFailed({
          exit: CLI_EXIT.USAGE,
          message: "Name a change: --notifications, --repo, or --channel.",
        });
      }

      const { workspace } = yield* resolveWorkspace;
      const workspaceId = workspace.id;
      const { hosted } = yield* session;
      const repository = Option.map(repo, (named) => (named === NONE_WORD ? null : named));

      // Note that each change is its own request, as the Settings rows' are, and the bot as the last one answers is the one printed.
      // Note that a channel is resolved before any change is made, so a name that matches none changes nothing.
      let slackBot = Option.isSome(channel)
        ? yield* askService(hosted.workspaceSlackBot.read, { workspaceId })
        : undefined;

      const channelId =
        slackBot !== undefined && Option.isSome(channel)
          ? yield* channelIdOf(slackBot, channel.value)
          : undefined;

      if (Option.isSome(notifications)) {
        slackBot = yield* askService(hosted.workspaceSlackBot.notifications, {
          workspaceId,
          notifications: NOTIFICATIONS_WORD[notifications.value],
        });
      }

      if (channelId === undefined && Option.isSome(repository)) {
        slackBot = yield* askService(hosted.workspaceSlackBot.repository, {
          workspaceId,
          repository: repository.value,
        });
      }

      if (channelId !== undefined) {
        slackBot = yield* askService(hosted.workspaceSlackBot.channel, {
          workspaceId,
          channelId,
          ...(join || leave ? { member: join } : undefined),
          ...(Option.isSome(repository) ? { repository: repository.value } : undefined),
        });
      }

      slackBot ??= yield* askService(hosted.workspaceSlackBot.read, { workspaceId });
      yield* answer({
        json: slackBotJson(slackBot),
        lines: slackBotLines(slackBot),
        ids: slackBot.team === undefined ? [] : [slackBot.team.id],
      });
    }),
).pipe(
  Command.withDescription(
    "Set your Slack notifications, the workspace's default repository for Slack starts, or a channel",
  ),
  Command.withExamples([
    { command: "vespin slack set --notifications off", description: "Stop the bot writing you" },
    { command: "vespin slack set --repo acme/app", description: "Slack starts work in acme/app" },
    {
      command: "vespin slack set --channel eng --join --repo acme/api",
      description: "Put the bot in #eng, its starts in acme/api",
    },
    { command: "vespin slack set --channel eng --leave", description: "Take the bot out of #eng" },
  ]),
);

const disconnectCommand = Command.make(
  "disconnect",
  {
    yes: Flag.Boolean("yes").pipe(
      Flag.withAlias("y"),
      Flag.withDefault(false),
      Flag.withDescription("Disconnect without asking; required where stdin is no terminal"),
    ),
  },
  ({ yes }) =>
    Effect.gen(function* () {
      const { workspace } = yield* resolveWorkspace;
      yield* confirmOrYes(
        `Disconnect the Slack bot from ${workspace.name}? It starts no agent from Slack and writes no member after, and forgets its repositories.`,
        yes,
      );
      const { hosted } = yield* session;

      const slackBot = yield* askService(hosted.workspaceSlackBot.disconnect, {
        workspaceId: workspace.id,
      });

      yield* answer({
        json: slackBotJson(slackBot),
        lines: slackBotLines(slackBot),
        ids: [],
      });
    }),
).pipe(
  Command.withDescription(
    "Disconnect the workspace's Slack bot; it stays installed in Slack until its admins remove it",
  ),
  Command.withExamples([
    { command: "vespin slack disconnect --yes", description: "Disconnect without asking" },
  ]),
);

/** The Slack group: show, set, and disconnect. */
export const slackCommand = Command.make("slack").pipe(
  Command.withDescription("Read, set, and disconnect the workspace's Slack bot"),
  Command.withSubcommands([showCommand, setCommand, disconnectCommand]),
  Command.withExamples([
    { command: "vespin slack show", description: "The workspace's Slack bot" },
  ]),
);
