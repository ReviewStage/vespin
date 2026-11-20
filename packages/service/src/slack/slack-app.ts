/**
 * slack-app.ts -- our own Slack app as this deployment's environment configures it, and the bot scopes an install asks for.
 *
 * A workspace's bot is our Slack app installed into the workspace's Slack
 * with Slack's OAuth v2 (Add to Slack,
 * https://docs.slack.dev/authentication/installing-with-oauth/). Its client
 * id names the app on the authorize address, its client secret exchanges the
 * code an install returns with for the bot token (`oauth.v2.access`), and
 * its signing secret verifies the requests Slack sends us
 * (https://docs.slack.dev/authentication/verifying-requests-from-slack/). A
 * deployment missing any of the three still builds the service, because
 * every function bundle loads this layer and a bundle must load with nothing
 * configured; every read of it then answers `SlackAppNotConfigured` naming
 * what was missing, and an install answers unavailable.
 */

import { Config, Context, Data, Effect, Layer, Option, Redacted } from "effect";
import { text } from "../core.js";

/** The variables our Slack app is read from; a blank value is absent. */
export const SLACK_APP_ENVIRONMENT = {
  CLIENT_ID: "SLACK_APP_CLIENT_ID",
  CLIENT_SECRET: "SLACK_APP_CLIENT_SECRET",
  SIGNING_SECRET: "SLACK_APP_SIGNING_SECRET",
} as const;

/**
 * The bot scopes an install asks for: every one the app's manifest
 * configures, so an install grants what the app declares. No user scope is
 * asked for, since a member's own Slack is connected under Integrations.
 */
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "assistant:write",
  "bookmarks:read",
  "channels:history",
  "channels:join",
  "channels:manage",
  "channels:read",
  "chat:write",
  "chat:write.customize",
  "chat:write.public",
  "dnd:read",
  "emoji:read",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "groups:write",
  "im:history",
  "im:read",
  "im:write",
  "metadata.message:read",
  "pins:read",
  "reactions:read",
  "reactions:write",
  "team:read",
  "usergroups:read",
  "users.profile:read",
  "users:read",
  "users:read.email",
] as const;

/** Our Slack app as a configured deployment holds it. */
export interface SlackAppSettings {
  readonly clientId: string;
  readonly clientSecret: Redacted.Redacted<string>;
  readonly signingSecret: Redacted.Redacted<string>;
}

/** The deployment holds no Slack app, or not all of it. */
class SlackAppNotConfigured extends Data.TaggedError("SlackAppNotConfigured")<{
  /** The variables that were missing, by name alone. */
  readonly missing: readonly string[];
}> {
  override get message(): string {
    return `The Slack app is not configured on this deployment: ${this.missing.join(", ")}`;
  }
}

/** The app's settings, or why this deployment has none. */
export interface SlackAppService {
  readonly settings: Effect.Effect<SlackAppSettings, SlackAppNotConfigured>;
}

export class SlackApp extends Context.Service<SlackApp, SlackAppService>()("SlackApp") {}

/** The service over settings read, or over the names of what was missing. */
export function slackAppService(
  settings: SlackAppSettings | undefined,
  missing: readonly string[],
): SlackAppService {
  return {
    settings:
      settings === undefined
        ? Effect.fail(new SlackAppNotConfigured({ missing }))
        : Effect.succeed(settings),
  };
}

/** A secret read, trimmed, and absent where blank. */
function presentSecret(read: Option.Option<Redacted.Redacted<string>>): string | undefined {
  return text(Option.getOrUndefined(Option.map(read, Redacted.value)));
}

/** Our Slack app as this deployment's environment configures it, read as the services are built. */
export const slackAppFromEnvironment: Layer.Layer<SlackApp, Config.ConfigError> = Layer.effect(
  SlackApp,
  Effect.map(
    Config.all({
      clientId: Config.option(Config.String(SLACK_APP_ENVIRONMENT.CLIENT_ID)),
      clientSecret: Config.option(Config.Redacted(SLACK_APP_ENVIRONMENT.CLIENT_SECRET)),
      signingSecret: Config.option(Config.Redacted(SLACK_APP_ENVIRONMENT.SIGNING_SECRET)),
    }),
    (read) => {
      const clientId = text(Option.getOrUndefined(read.clientId));
      const clientSecret = presentSecret(read.clientSecret);
      const signingSecret = presentSecret(read.signingSecret);

      const missing = [
        [SLACK_APP_ENVIRONMENT.CLIENT_ID, clientId],
        [SLACK_APP_ENVIRONMENT.CLIENT_SECRET, clientSecret],
        [SLACK_APP_ENVIRONMENT.SIGNING_SECRET, signingSecret],
      ].flatMap(([name, value]) => (value === undefined ? [String(name)] : []));

      return slackAppService(
        clientId !== undefined && clientSecret !== undefined && signingSecret !== undefined
          ? {
              clientId,
              clientSecret: Redacted.make(clientSecret),
              signingSecret: Redacted.make(signingSecret),
            }
          : undefined,
        missing,
      );
    },
  ),
);
