import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { SLACK_THREAD_ORIGIN, type SlackThreadOrigin } from "../storage-vocabulary.js";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { organization, user } from "./auth.js";

/**
 * slack-installation.ts -- the Slack workspace a workspace's bot is connected to, and who each member is there.
 *
 * Our Slack bot is our own Slack app; an owner or admin installs it into
 * a workspace's Slack team, which stores the team the install answers
 * for. A workspace holds at most one, so the row is keyed on the
 * workspace. `linked_by_user_id` is the member who connected it, null
 * once their account is gone. The row leaves with its workspace, and a
 * Disconnect deletes it.
 *
 * A member's Slack user id is looked up by email the first time the bot
 * writes to them and kept here, per workspace; a lookup that matched no one
 * is kept too, as a null id, so a member with no match is not asked about
 * on every message. Each row leaves with its installation, so a Disconnect
 * forgets every member, and with its account.
 *
 * A Slack thread that speaks for an agent is kept against it, with its
 * origin: either a thread where a member started the agent, by mentioning
 * the bot in a channel or writing to it directly, or the DM where the bot
 * sent an automation run's result. A later message in the thread is sent to
 * the agent rather than starting another, and each of the agent's settled
 * turns is posted once, in its current thread, the one kept or written in
 * latest. Each row leaves with its installation, its agent, and its member.
 *
 * An owner or admin may name a default repository for the workspace's Slack
 * starts, and one for each channel the bot is in; a channel's leaves with
 * its installation, and when the bot leaves the channel.
 *
 * The row also holds the bot token Slack granted that workspace's install, sealed by
 * `models/provider-key-seal.ts` under the provider keys' ring with purposes
 * of its own and the workspace and team bound beside them, with the bot's
 * own Slack user id and id, the scopes it was granted, and the app that
 * granted it. Those seven are set together or none is: none on a row linked
 * before the bot ran on our own app, and none once Slack revoked the token. The
 * Enterprise Grid org an install was made in, and whether it was made across
 * the org, are kept beside them as Bolt's installation keeps them. The token leaves with the row.
 */
export const slackInstallation = pgTable(
  "slack_installation",
  {
    organizationId: text("organization_id")
      .primaryKey()
      .references(() => organization.id, { onDelete: "cascade" }),
    /** Slack's id for the team the bot token answers for (`T…`). */
    teamId: text("team_id").notNull(),
    /** The team's name as Slack answered it, which the settings row shows. */
    teamName: text("team_name").notNull(),
    /** The repository, `owner/name`, an agent started from Slack works in where neither its message nor its channel names one; null for none. */
    defaultRepository: text("default_repository"),
    linkedByUserId: text("linked_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    /** The version of the deployment's key-encryption key the bot token's data key is wrapped under; null where no token is held. */
    botKeyVersion: integer("bot_key_version"),
    /** base64 of nonce, ciphertext, and tag: the bot token's data key under the key-encryption key. */
    botSealedDataKey: text("bot_sealed_data_key"),
    /** base64 of nonce, ciphertext, and tag: the bot token (`xoxb-…`) under the data key. */
    botSealedToken: text("bot_sealed_token"),
    /** Slack's id for the bot's own user in the team (`U…`). */
    botUserId: text("bot_user_id"),
    /** The scopes Slack granted the bot token, as its install answered them. */
    botScopes: text("bot_scopes").array(),
    /** Slack's id for the bot itself (`B…`), as its install answered it. */
    botId: text("bot_id"),
    /** Slack's id for the app the bot token was granted by (`A…`). */
    appId: text("app_id"),
    /** Slack's id for the Enterprise Grid org the install was made in (`E…`); null for a single-workspace install, the only kind our app allows. */
    enterpriseId: text("enterprise_id"),
    /** Whether the app was installed across an Enterprise Grid org rather than one workspace. */
    isEnterpriseInstall: boolean("is_enterprise_install").notNull().default(false),
    createdAt: timestamptz("created_at").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (t) => [
    // The token, its seal, the bot's ids, its scopes, and its app stand together or not at all.
    check(
      "slack_installation_bot_token_whole",
      sql`num_nonnulls(${t.botKeyVersion}, ${t.botSealedDataKey}, ${t.botSealedToken}, ${t.botUserId}, ${t.botScopes}, ${t.botId}, ${t.appId}) in (0, 7)`,
    ),
  ],
);

/** One member's Slack user id in the workspace's connected team, or null where their email matched no one when it was looked up. */
export const slackMember = pgTable(
  "slack_member",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => slackInstallation.organizationId, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Slack's id for the member (`U…`); null where their email matched no one in the team. */
    slackUserId: text("slack_user_id"),
    /** When Slack was last asked, which is what lets a miss be asked again later. */
    lookedUpAt: timestamptz("looked_up_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.userId] })],
);

/** A Slack thread that speaks for an agent, one it was started from or its automation run's result was sent in, which its later messages are sent to and its settled turns posted in. */
export const slackAgentThread = pgTable(
  "slack_agent_thread",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => slackInstallation.organizationId, { onDelete: "cascade" }),
    /** Slack's id for the conversation the thread is in (`C…`, `G…`, or `D…`). */
    channelId: text("channel_id").notNull(),
    /** The timestamp of the thread's first message, which Slack names a thread by. */
    threadTs: text("thread_ts").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The member the thread was kept for: who started the agent from it, or the automation owner its run's result was sent to. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The agent's latest turn whose outcome was posted in the thread; null before the first. */
    postedTurnId: text("posted_turn_id"),
    createdAt: timestamptz("created_at").notNull(),
    /** Where the thread came from: a member's message that started the agent, its run's result DM, or a message the agent sent there itself. */
    origin: text("origin").$type<SlackThreadOrigin>().notNull().default(SLACK_THREAD_ORIGIN.START),
    /** When the thread last became its agent's current one, kept for it or written in by a member; a settled turn is posted in the agent's latest. The epoch for a thread the agent posted to that no member has written in yet, which is never current. */
    activeAt: timestamptz("active_at").notNull().defaultNow(),
    /** The timestamp of the member's message that started the agent; null for a run's result DM, and for a thread kept before it was recorded. */
    startTs: text("start_ts"),
    /** Written by nothing since agents react in Slack themselves: the timestamp of the message the bot once marked 👀, kept until a migration drops it. */
    workingTs: text("working_ts"),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.channelId, t.threadTs] }),
    index("slack_agent_thread_agent_id").on(t.agentId),
  ],
);

/** The repository an agent started from one Slack channel works in where its message names none. */
export const slackChannelRepository = pgTable(
  "slack_channel_repository",
  {
    organizationId: text("organization_id")
      .notNull()
      .references(() => slackInstallation.organizationId, { onDelete: "cascade" }),
    /** Slack's id for the channel (`C…` or `G…`). */
    channelId: text("channel_id").notNull(),
    /** The repository as GitHub spells it, `owner/name`. */
    repository: text("repository").notNull(),
    updatedAt: timestamptz("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.channelId] })],
);
