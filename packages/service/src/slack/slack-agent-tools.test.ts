import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { linkSlackInstallation } from "@repo/database/models/slack-installation-store";
import { createTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openRunningTurn, openWorkspace } from "@repo/database/testing";
import { AGENT_KIND, AGENT_PAYER } from "@repo/features/agent-wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { Effect, Option } from "effect";
import { AGENT_CALLER } from "../agents/agent-tools.js";
import type { InboxSandboxDoor } from "../agents/coder-host/inbox-image.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import { runReadSlack } from "./slack-agent-tools.js";
import {
  SlackBot,
  SlackBotFailure,
  type SlackFileTransfer,
  type SlackWebApi,
  slackBotOver,
} from "./slack-bot.js";
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

/** A sandbox the agent keeps nothing in, which a message that shares no file never opens. */
const noSandbox: InboxSandboxDoor = () => Promise.reject(new Error("the sandbox was opened"));

/** A one-pixel PNG, as an agent takes a screenshot of what it rendered. */
const PNG = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

/** A sandbox holding the PNG at `shots/settings.png` under its checkout, and nothing else. */
const sandboxWithShot: InboxSandboxDoor = () =>
  Promise.resolve({
    checkout: "/workspace/repository",
    readFile: ({ path }) =>
      Promise.resolve(
        path === "/workspace/repository/shots/settings.png"
          ? new ReadableStream<Uint8Array>({
              start: (controller) => {
                controller.enqueue(PNG);
                controller.close();
              },
            })
          : null,
      ),
  });

/** One Web API call the fake Slack was handed. */
interface SlackCall {
  readonly method: string;
  readonly args: Readonly<Record<string, string>>;
}

/** A Slack whose team the bot reads, which finds the member by their email, posts every message in their DM at one timestamp, and hands every file an upload address, writing each call down. */
function postingSlack(calls: SlackCall[]): SlackWebApi {
  return (method, args) => {
    calls.push({ method, args });

    switch (method) {
      case "auth.test":
        return Effect.succeed({ ok: true, team_id: "T0001", team: "Team", user_id: "UBOT" });
      case "users.lookupByEmail":
        return Effect.succeed({ ok: true, user: { id: MEMBER_SLACK_ID } });
      case "chat.postMessage":
        return Effect.succeed({ ok: true, channel: "D0001", ts: "1700000000.000100" });
      case "files.getUploadURLExternal":
        return Effect.succeed({
          ok: true,
          upload_url: `https://files.slack.com/upload/v1/${args.filename}`,
          file_id: "F0001",
        });
      default:
        return Effect.succeed({ ok: true });
    }
  };
}

/** Slack's upload addresses, writing down each file's bytes as sent to its address. */
function fakeFiles(sent: { url: string; bytes: Uint8Array }[]): SlackFileTransfer {
  return {
    send: (url, bytes) => Effect.sync(() => void sent.push({ url, bytes })),
    read: () => Effect.die("no file is read"),
  };
}

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

/** The Slack user Dean is, found by his email, who wrote the channel's one message. */
const DEAN_SLACK_ID = "U0002";

/** The Slack of `slackWithChannel`, but finding Dean by his own email and everyone else as the agent's member. */
const slackWithDean =
  (dean: string): SlackWebApi =>
  (method, args) =>
    method === "users.lookupByEmail"
      ? Effect.succeed({
          ok: true,
          user: { id: args.email === `${dean}@app.test` ? DEAN_SLACK_ID : MEMBER_SLACK_ID },
        })
      : slackWithChannel(method, args);

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

/** Charles's workspace, connected to the Slack team, with Dean a member of it and a Manager Charles started there in a turn Dean opened. */
const openManagerDeanAsked = Effect.gen(function* () {
  const db = yield* Database;
  const [charles, dean] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [charles, dean]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  const organizationId = yield* openWorkspace(charles);
  yield* joinWorkspace(organizationId, dean);
  yield* linkSlackInstallation({ organizationId, teamId: TEAM, teamName: "Team", userId: charles });

  const agent = Option.getOrThrow(
    yield* createAgent(charles, {
      taskId: null,
      workspaceId: organizationId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
      descriptionSnapshot: null,
      prompt: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      kind: AGENT_KIND.MANAGER,
    }),
  ).agent;

  yield* openRunningTurn({ userId: charles, conversationId: agent.conversationId }, [
    { member: dean },
  ]);

  return { dean, caller: { kind: AGENT_CALLER.AGENT, agent, descriptionsOn: false } as const };
});

it.layer(getTestDB())("an agent's Slack tools as the bot", (it) => {
  it.effect("a workspace that holds no Slack bot token is refused", () =>
    Effect.gen(function* () {
      const caller = yield* openAgent(false);

      const sent = yield* runSendSlackMessage(
        { caller },
        { text: "Hello.", channel: CHANNEL },
        noSandbox,
      ).pipe(Effect.provideService(SlackBot, slackBotOver(undefined)));

      assert.deepEqual(sent, {
        status: ACTION_RESULT_STATUS.REJECTED,
        reason: SLACK_REACH_REFUSAL.NOT_CONNECTED,
      });
    }),
  );

  it.effect("a DM's file from the agent's sandbox is shared under the message it sent", () =>
    Effect.gen(function* () {
      const caller = yield* openAgent(true);
      const calls: SlackCall[] = [];
      const sent: { url: string; bytes: Uint8Array }[] = [];

      const answer = yield* runSendSlackMessage(
        { caller },
        {
          text: "Here's the new settings page.",
          member: caller.agent.userId,
          files: ["shots/settings.png"],
        },
        sandboxWithShot,
      ).pipe(Effect.provideService(SlackBot, slackBotOver(postingSlack(calls), fakeFiles(sent))));

      assert.equal(answer.status, ACTION_RESULT_STATUS.ACCEPTED);
      assert.deepEqual(sent, [
        { url: "https://files.slack.com/upload/v1/settings.png", bytes: PNG },
      ]);
      const shared = calls.find((call) => call.method === "files.completeUploadExternal");
      assert.deepEqual(
        [shared?.args.channel_id, shared?.args.thread_ts],
        ["D0001", "1700000000.000100"],
      );
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

  it.effect(
    "in a turn a member opened, a Manager reads that member's own lines as not outside",
    () =>
      Effect.gen(function* () {
        const { dean, caller } = yield* openManagerDeanAsked;

        const read = yield* runReadSlack({ caller }, { channel: "#release" }).pipe(
          Effect.provideService(SlackBot, slackBotOver(slackWithDean(dean))),
        );

        assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.deepEqual(
          Array.isArray(read.messages) ? read.messages.map((message) => message?.outside) : [],
          [false],
        );
      }),
  );
});
