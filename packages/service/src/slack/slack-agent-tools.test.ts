import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { linkSlackInstallation } from "@repo/database/models/slack-installation-store";
import { createTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { Effect, Option } from "effect";
import { AGENT_CALLER } from "../agents/agent-tools.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { runReadSlack } from "./slack-agent-tools.js";
import { SlackBot, SlackBotFailure, type SlackWebApi, slackBotOver } from "./slack-bot.js";
import { runSendSlackMessage } from "./slack-message-tool.js";
import { SLACK_REACH_REFUSAL } from "./slack-reach.js";

/**
 * The Slack tools an agent acts as the bot through, over a real store and
 * Slack a fake at the bot's Web API. Synthetic accounts, workspaces, and
 * Slack ids.
 */

const TEAM = "T0001";

/** The Slack user the agent's member is, found by their email. */
const MEMBER_SLACK_ID = "U0001";

/** A channel the bot is in. */
const CHANNEL = "C0001";

/** A Slack whose team holds one channel the bot is in, with one message from another member. */
const slackWithChannel: SlackWebApi = (method) => {
  switch (method) {
    case "auth.test":
      return Effect.succeed({ ok: true, team_id: TEAM, team: "Team", user_id: "UBOT" });
    case "users.lookupByEmail":
      return Effect.succeed({ ok: true, user: { id: MEMBER_SLACK_ID } });
    case "conversations.list":
      return Effect.succeed({
        ok: true,
        channels: [{ id: CHANNEL, name: "release", is_member: true }],
      });
    case "conversations.history":
      return Effect.succeed({
        ok: true,
        messages: [{ ts: "1700000000.000001", user: "U0002", text: "Ship it <tonight>." }],
      });
    case "users.info":
      return Effect.succeed({ ok: true, user: { profile: { display_name: "Robin" } } });
    default:
      return Effect.fail(new SlackBotFailure({ method }));
  }
};

/** A member of a fresh workspace, connected to the Slack team where `connected`, and an agent of theirs, as the agent calls its tools. */
const openAgent = (connected: boolean) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const member = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: member, name: "Test User", email: `${member}@app.test` });
    yield* connectAgentApiKeys(member);
    const organizationId = yield* openWorkspace(member);

    if (connected) {
      yield* linkSlackInstallation({
        organizationId,
        teamId: TEAM,
        teamName: "Team",
        userId: member,
      });
    }

    const { id: taskId } = yield* createTask(member, { organizationId, name: "Release" });

    const agent = Option.getOrThrow(
      yield* createAgent(member, {
        taskId,
        descriptionSnapshot: null,
        repository: null,
        prompt: "Ship the release.",
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
        payer: AGENT_PAYER.API_KEY,
      }),
    ).agent;

    return { kind: AGENT_CALLER.AGENT, agent, descriptionsOn: false } as const;
  });

it.layer(getTestDB())("an agent's Slack tools as the bot", (it) => {
  it.effect("a workspace that holds no Slack bot token is refused", () =>
    Effect.gen(function* () {
      const caller = yield* openAgent(false);

      const sent = yield* runSendSlackMessage(
        { caller },
        { text: "Hello.", channel: CHANNEL },
      ).pipe(Effect.provideService(SlackBot, slackBotOver(undefined)));

      assert.deepEqual(sent, {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: SLACK_REACH_REFUSAL.NOT_CONNECTED,
      });
    }),
  );

  it.effect("a channel's messages are read with others' words fenced and marked outside", () =>
    Effect.gen(function* () {
      const caller = yield* openAgent(true);

      const read = yield* runReadSlack({ caller }, { channel: "#release" }).pipe(
        Effect.provideService(SlackBot, slackBotOver(slackWithChannel)),
      );

      assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.deepEqual(read.messages, [
        {
          ts: "1700000000.000001",
          author: "Robin",
          bot: false,
          outside: true,
          text: "Ship it &lt;tonight&gt;.",
        },
      ]);
    }),
  );
});
