import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { archiveAgent, createAgent, readAgent } from "@repo/database/models/agent-store";
import { claimRuntimeSession } from "@repo/database/models/recorded-session";
import {
  linkSlackInstallation,
  recordSlackAgentThread,
  recordSlackMemberLookup,
  slackMemberLookup,
  workspaceSlackInstallation,
  writeSlackChannelRepository,
} from "@repo/database/models/slack-installation-store";
import { readTask } from "@repo/database/models/task-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { inboxMessage } from "@repo/database/schemas/inbox-message";
import { slackAgentThread } from "@repo/database/schemas/slack-installation";
import { messages } from "@repo/database/schemas/storage";
import {
  CONVERSATION_RUNTIME,
  type ConversationRuntime,
  SLACK_THREAD_ORIGIN,
} from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_MESSAGE_AUTHOR,
  INBOX_REPLY,
} from "@repo/features/inbox-wire";
import { AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@repo/features/models-wire";
import { TASK_STATUS, UNTITLED_TASK_NAME } from "@repo/features/task-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { ACTION_RESULT_STATUS, type WireRecord } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Clock, ConfigProvider, DateTime, Effect, Layer, Option, Result, Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { TestClock } from "effect/testing";
import { AGENT_CALLER } from "../agents/agent-tools.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { type AfterResponse, keptAfterResponse } from "../http/after-response.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { postInboxThread, readInboxItem } from "../inbox/inbox-store.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { connectAgentApiKeys } from "../testing/agent-credentials.js";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "../testing/github-app-fake.js";
import { recordingHarness } from "../testing/native-harness-fake.js";
import { SlackBot, type SlackFileTransfer, type SlackWebApi, slackBotOver } from "./slack-bot.js";
import { slackEventsApp } from "./slack-events-app.js";
import { runSendSlackMessage } from "./slack-message-tool.js";
import { SlackChoiceSchema } from "./thread-dms.js";

/** What every case runs over: the store, and sandboxes kept in memory. */
const SUITE = Layer.merge(getTestDB(), memorySandbox().layer);

/**
 * Our Slack route, answered by its group the way a function answers it,
 * over a real store, a fake Slack, and a fixture signing secret: a press of a decide ask's option in the DM the bot wrote is
 * acknowledged before anything is done, then answers
 * the ask as the member it was written to, hands the agent its answer, and
 * rewrites the DM to say the option chosen, and a request whose signature
 * is forged, or whose timestamp is stale, is refused before anything of it
 * is read; an uninstall of the app deletes the team's installation and its
 * members' ids; and a mention of the bot
 * starts an agent as the member Slack's email names on a task made for it,
 * reacting with 👀 and saying nothing, and starts nothing for a Slack user who is no member; a message in
 * the thread of an archived agent brings it back and hands it the message,
 * and one in the thread of an agent whose session ended continues it in a
 * new agent on the same task, which the thread moves to; a member's reply under the DM of an inbox
 * thread is posted on that thread as theirs, bringing its archived agent back as a press
 * in the DM does, and starts no agent; a press of an ask the agent's archive withdrew
 * answers nothing; and a
 * direct message sharing images and a PDF and no words starts an agent
 * handed them.
 *
 * Synthetic accounts, workspaces, tokens, and Slack ids throughout.
 */

const ORIGIN = "https://app.test";
const EVENTS = "/api/slack/events";
const SIGNING_SECRET = "slack-signing-secret-fixture";

/** Slack's own request timestamp header and signature header. */
const SLACK_HEADER = {
  TIMESTAMP: "x-slack-request-timestamp",
  SIGNATURE: "x-slack-signature",
} as const;

/** One Web API call the fake Slack was handed. */
interface SlackCall {
  readonly method: string;
  readonly args: Readonly<Record<string, string>>;
}

/** A Slack that knows every member by their email, as `U-<email>`, and posts every message it is handed, each at the timestamp given. */
function fakeSlack(calls: SlackCall[], postedTs = "1700000000.000100"): SlackWebApi {
  return (method, args) => {
    calls.push({ method, args });

    switch (method) {
      case "auth.test":
        return Effect.succeed({ ok: true, team_id: "T0001", team: "Team", user_id: "UBOT" });
      case "users.lookupByEmail":
        return Effect.succeed({ ok: true, user: { id: `U-${args.email}` } });
      case "users.info": {
        const email = args.user?.startsWith("U-") ? args.user.slice(2) : undefined;

        return Effect.succeed({
          ok: true,
          user: { profile: email === undefined ? {} : { email } },
        });
      }

      case "chat.getPermalink":
        return Effect.succeed({ ok: true, permalink: "https://team.slack.com/archives/C0001/p1" });
      case "chat.postMessage":
        return Effect.succeed({ ok: true, channel: "D0001", ts: postedTs });
      default:
        return Effect.succeed({ ok: true });
    }
  };
}

/** A one-pixel PNG, as a member shares a screenshot. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A PDF's opening, as a member shares a document. */
const PDF = Buffer.from("%PDF-1.7\n");

/** A Slack whose every private file is the PNG, or the PDF where its address names one, writing down each address read. */
function fakeFiles(read: string[]): SlackFileTransfer {
  return {
    send: () => Effect.void,
    read: (url) =>
      Effect.sync(() => {
        read.push(url);

        return new Uint8Array(url.endsWith(".pdf") ? PDF : PNG);
      }),
  };
}

/**
 * A request to our Slack route as Slack sends it, signed with the secret
 * given at the epoch the test clock starts at, worked by hand from Slack's
 * "Verifying requests from Slack" rather than through the route's own code.
 */
function slackRequest(contentType: string, body: string, secret = SIGNING_SECRET): Request {
  const timestamp = "0";
  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");

  return new Request(new URL(EVENTS, ORIGIN), {
    method: "POST",
    headers: {
      "content-type": contentType,
      [SLACK_HEADER.TIMESTAMP]: timestamp,
      [SLACK_HEADER.SIGNATURE]: `v0=${digest}`,
    },
    body,
  });
}

/** An event Slack sends as JSON, signed with our secret. */
function slackEvent(payload: WireRecord): Request {
  return slackRequest("application/json", JSON.stringify(payload));
}

const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  posthogDistinctIdKey: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

/** The native harnesses an answer is handed to, writing down each with the account it acted for. */
const HARNESS = recordingHarness();

/** The decide ask the member is written: one option of two to pick. */
const PICK_ONE = {
  type: INBOX_ASK.DECIDE,
  options: [{ label: "A week" }, { label: "A month" }],
} as const;

/** The DM a press below is made in, as `press` names it. */
const PRESSED_DM_TS = "1700000000.000100";

/** The member's email, which the fake Slack knows them by. */
const ownerEmail = (owner: string) =>
  Effect.gen(function* () {
    const [row] = yield* (yield* Database)
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, owner));

    return row?.email ?? "";
  });

/** A button of the ask's DM as the bot drew it: the item, the ask, and an option's label or a do ask's answer, or neither for a Submit. */
function askButton(
  item: string,
  ask: string,
  picked: { readonly choice?: string; readonly reply?: typeof INBOX_REPLY.DONE },
) {
  return {
    action_id: randomUUID(),
    value: Schema.encodeSync(SlackChoiceSchema)({ item, ask, ...picked }),
  };
}

/** A member's agent at work on a task in a workspace whose bot is connected, its decide ask written to them in a Slack DM from before the bot stopped writing them, under the title DM given. */
const openAskedMember = (
  _bot: Layer.Layer<SlackBot>,
  ask: Parameters<typeof postInboxThread>[1]["ask"] = PICK_ONE,
  dmThread = "1700000000.000050",
) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    yield* connectAgentApiKeys(owner);
    const task = yield* startTask(owner, { name: "Teammate invitations" });

    const started = yield* createAgent(owner, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: "# Teammate invitations\n",
      prompt: null,
      repository: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      payer: AGENT_PAYER.API_KEY,
    });

    assert.ok(Option.isSome(started));
    const agent = started.value.agent;
    yield* claimRuntimeSession(
      { userId: owner, conversationId: agent.conversationId },
      `wrun_${randomUUID()}`,
      yield* DateTime.nowAsDate,
    );
    const organizationId = task.workspaceId;
    yield* linkSlackInstallation({
      organizationId,
      teamId: "T0001",
      teamName: "Team",
      userId: owner,
    });

    const item = Result.getOrThrow(
      yield* postInboxThread(
        { userId: owner, taskId: task.id, agentId: agent.id },
        {
          key: "invite-expiry",
          title: "How long should an invitation last?",
          body: "Pick how long an invitation stays open.",
          ask,
          needsReply: true,
        },
      ),
    );

    // A DM the bot wrote about the ask before it stopped writing them, kept on the ask's message as a reply under its title DM.
    const askId = item.thread?.find((message) => message.ask)?.id ?? "";
    const slackUserId = `U-${yield* ownerEmail(owner)}`;
    // The bot kept the member's Slack id as it wrote them that DM.
    yield* recordSlackMemberLookup(organizationId, owner, slackUserId);
    yield* (yield* Database)
      .update(inboxMessage)
      .set({ slackDm: { channel: "D0001", ts: PRESSED_DM_TS, to: owner, thread: dmThread } })
      .where(eq(inboxMessage.id, askId));

    return { owner, item, askId, slackUserId };
  });

/** The installation the mention's workspace connects, reaching the repository its channel defaults to. */
const RELAY_INSTALLATION: InstallationFixture = {
  id: 8_100,
  login: "Acme",
  repositories: [{ owner: "Acme", name: "Relay" }],
};

/** The installation the thread agent below works through, its own since an installation stands in one workspace. */
const BEACON_INSTALLATION: InstallationFixture = {
  id: 8_101,
  login: "Acme",
  repositories: [{ owner: "Acme", name: "Beacon" }],
};

/** The group over the test's store, the bot, and the verifier, answering one request; its after-response work runs in place unless kept. */
const answer = (
  bot: Layer.Layer<SlackBot>,
  request: Request,
  after: Layer.Layer<AfterResponse> | Layer.Layer<never> = Layer.empty,
) =>
  Effect.gen(function* () {
    const services = Layer.mergeAll(
      memorySandbox().layer,
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, ENVIRONMENT),
      githubReaching([RELAY_INSTALLATION, BEACON_INSTALLATION]).layer,
      modelCatalogOf([
        {
          id: AGENT_DEFAULT_CHOICE.model,
          name: "Claude Opus 5.5",
          provider: MODEL_PROVIDER.ANTHROPIC,
          efforts: ["low", "medium", "high", "max"],
        },
      ]),
      HARNESS.layer,
      bot,
      after,
      ConfigProvider.layer(
        ConfigProvider.fromUnknown({ SLACK_APP_SIGNING_SECRET: SIGNING_SECRET }),
      ),
    );

    const { handler, dispose } = HttpRouter.toWebHandler(
      slackEventsApp.pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );

    const response = yield* Effect.promise(() => handler(request));
    const body: unknown = yield* Effect.promise(() => response.json());
    yield* Effect.promise(() => dispose());

    return { status: response.status, body };
  });

/** Slack's press of the button, form-encoded as interactivity arrives, signed with the secret given, and the message's checkboxes as they stand. */
function press(
  button: { readonly action_id: string; readonly value: string },
  slackUserId: string,
  secret: string = SIGNING_SECRET,
  state: WireRecord = {},
): Request {
  const payload = {
    type: "block_actions",
    user: { id: slackUserId, team_id: "T0001" },
    team: { id: "T0001", domain: "team" },
    container: { type: "message", channel_id: "D0001", message_ts: PRESSED_DM_TS },
    actions: [{ ...button, type: "button", block_id: "b", action_ts: "1700000001.000200" }],
    state: { values: state },
  };

  return slackRequest(
    "application/x-www-form-urlencoded",
    new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
    secret,
  );
}

/** Slack's mention of the bot in a channel by the Slack user given, as Slack sends it. */
function mention(slackUserId: string, eventId: string): Request {
  const payload = {
    type: "event_callback",
    team_id: "T0001",
    event_id: eventId,
    authorizations: [{ user_id: "UBOT" }],
    event: {
      type: "app_mention",
      user: slackUserId,
      text: "<@UBOT> find the flakiest test and fix it",
      ts: "1700000002.000300",
      channel: "C0001",
    },
  };

  return slackEvent(payload);
}

/** Slack's mention of the bot in the thread given by the Slack user given, at the timestamp given, as Slack sends it. */
function threadMention(
  slackUserId: string,
  eventId: string,
  threadTs: string,
  ts = "1700000003.000400",
): Request {
  const payload = {
    type: "event_callback",
    team_id: "T0001",
    event_id: eventId,
    authorizations: [{ user_id: "UBOT" }],
    event: {
      type: "app_mention",
      user: slackUserId,
      text: "<@UBOT> now make it faster",
      ts,
      thread_ts: threadTs,
      channel: "C0001",
    },
  };

  return slackEvent(payload);
}

/** Slack's message in a public channel by the Slack user given, with the words given, replying in the thread given or, with none, standing on its own, as Slack sends it. */
function channelMessage(
  slackUserId: string,
  eventId: string,
  text: string,
  threadTs: string | undefined,
): Request {
  const message = {
    type: "message",
    channel_type: "channel",
    user: slackUserId,
    text,
    ts: "1700000003.000400",
    channel: "C0001",
  };

  const payload = {
    type: "event_callback",
    team_id: "T0001",
    event_id: eventId,
    authorizations: [{ user_id: "UBOT" }],
    event: threadTs === undefined ? message : { ...message, thread_ts: threadTs },
  };

  return slackEvent(payload);
}

/** Slack's direct message to the bot by the Slack user given, sharing a PNG screenshot, a Mac's HEIC one, and a PDF with no words, as Slack sends it. */
function directShare(slackUserId: string, eventId: string): Request {
  const shared = (name: string, mimetype: string) => ({
    name,
    mimetype,
    size: 120,
    url_private_download: `https://files.slack.com/files-pri/T0001-F0001/download/${name}`,
  });

  const payload = {
    type: "event_callback",
    team_id: "T0001",
    event_id: eventId,
    authorizations: [{ user_id: "UBOT" }],
    event: {
      type: "message",
      subtype: "file_share",
      channel_type: "im",
      user: slackUserId,
      text: "",
      ts: "1700000003.000400",
      channel: "D0002",
      files: [
        shared("screen.png", "image/png"),
        {
          ...shared("mac.heic", "image/heic"),
          thumb_720: "https://files.slack.com/files-tmb/T0001-F0002/mac_720.png",
        },
        shared("notes.pdf", "application/pdf"),
      ],
    },
  };

  return slackEvent(payload);
}

/** Slack's direct message to the bot by the Slack user given, in the thread of the DM given, as Slack sends it. */
function dmReply(
  slackUserId: string,
  eventId: string,
  dm: { channel: string; ts: string },
): Request {
  const payload = {
    type: "event_callback",
    team_id: "T0001",
    event_id: eventId,
    authorizations: [{ user_id: "UBOT" }],
    event: {
      type: "message",
      channel_type: "im",
      user: slackUserId,
      text: "A week, but let admins extend it",
      ts: "1700000005.000600",
      thread_ts: dm.ts,
      channel: dm.channel,
    },
  };

  return slackEvent(payload);
}

/** A member's agent on the task a Slack message made, on the runtime given, in the Beacon repository where asked and none otherwise, started from a Slack thread of its own; with that thread and the Slack user their email names. */
const openThreadAgent = (runtime: ConversationRuntime, inBeacon: boolean) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    yield* connectAgentApiKeys(owner);

    const task = yield* startTask(owner, {
      name: "Flaky tests",
      repository: inBeacon ? "Acme/Beacon" : null,
    });

    const { workspaceId } = task;
    yield* linkSlackInstallation({
      organizationId: workspaceId,
      teamId: "T0001",
      teamName: "Team",
      userId: owner,
    });

    if (inBeacon) yield* connectWorkspaceGitHub(workspaceId, BEACON_INSTALLATION);

    const started = yield* createAgent(owner, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: AGENT_DEFAULT_CHOICE.model,
      effort: "high",
      descriptionSnapshot: null,
      prompt: "find the flakiest test and fix it",
      repository: inBeacon ? "Acme/Beacon" : null,
      runtime,
      payer: AGENT_PAYER.API_KEY,
    });

    assert.ok(Option.isSome(started));
    const agent = started.value.agent;
    yield* claimRuntimeSession(
      { userId: owner, conversationId: agent.conversationId },
      `wrun_${randomUUID()}`,
      yield* DateTime.nowAsDate,
    );
    // Note that each agent's thread is its own, because a message is read against every workspace of the team, oldest first.
    const threadTs = `1700000001.${randomUUID().replace(/\D/gu, "").slice(0, 6)}`;
    yield* recordSlackAgentThread({
      organizationId: workspaceId,
      channelId: "C0001",
      threadTs,
      agentId: agent.id,
      userId: owner,
      origin: SLACK_THREAD_ORIGIN.START,
    });

    const [row] = yield* (yield* Database)
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, owner));

    return { owner, agent, taskId: task.id, threadTs, slackUserId: `U-${row?.email}` };
  });

it.layer(SUITE)("our Slack route", (it) => {
  it.effect(
    "a press Slack signed is acknowledged first, then answers the ask as the member it was written to, tells the agent, and says the choice in the DM; one forged or stale is refused",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));

      return Effect.gen(function* () {
        const { owner, item, askId, slackUserId } = yield* openAskedMember(bot);
        const month = askButton(item.id, askId, { choice: "A month" });

        const askStatus = Effect.map(
          readInboxItem(owner, item.id),
          (stored) => Option.getOrThrow(stored).item.thread?.find((m) => m.ask)?.ask?.status,
        );

        const forged = yield* answer(bot, press(month, slackUserId, "another-secret"));
        // Slack's press signed at the epoch, heard six minutes on.
        yield* TestClock.adjust("6 minutes");
        const stale = yield* answer(bot, press(month, slackUserId));
        yield* TestClock.setTime(0);
        const stillOpen = yield* askStatus;
        const kept = keptAfterResponse();
        const signed = yield* answer(bot, press(month, slackUserId), kept.layer);
        const atAnswer = yield* askStatus;
        yield* kept.run;

        const refused = {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
        };

        assert.deepEqual([forged, stale], [refused, refused]);
        assert.equal(stillOpen, INBOX_ASK_STATUS.OPEN);
        assert.deepEqual(signed, { status: HOSTED_HTTP_STATUS.OK, body: {} });
        assert.equal(atAnswer, INBOX_ASK_STATUS.OPEN);
        assert.equal(yield* askStatus, INBOX_ASK_STATUS.ANSWERED);
        assert.deepEqual(
          HARNESS.heard.filter((heard) => heard.account === owner),
          [{ call: "send", account: owner }],
        );

        const updated = calls.filter((call) => call.method === "chat.update");

        assert.equal(updated.length, 1);
        assert.equal(
          updated[0]?.args.text,
          "How long should an invitation last? · You chose A month",
        );
      });
    },
  );

  it.effect(
    "a Submit of an ask taking several options answers it with the options ticked in the DM",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));

      return Effect.gen(function* () {
        const { owner, item, askId, slackUserId } = yield* openAskedMember(bot, {
          type: INBOX_ASK.DECIDE,
          options: [{ label: "Email" }, { label: "Slack" }, { label: "SMS" }],
          multiple: true,
        });

        // Email and SMS ticked, by their places among the options.
        const ticked = [{ value: "0" }, { value: "2" }];

        const kept = keptAfterResponse();
        yield* answer(
          bot,
          press(askButton(item.id, askId, {}), slackUserId, SIGNING_SECRET, {
            picks: { picks: { type: "checkboxes", selected_options: ticked } },
          }),
          kept.layer,
        );
        yield* kept.run;

        const stored = Option.getOrThrow(yield* readInboxItem(owner, item.id));
        const asked = stored.item.thread?.find((message) => message.ask);
        assert.equal(asked?.ask?.status, INBOX_ASK_STATUS.ANSWERED);

        const updated = calls.filter((call) => call.method === "chat.update");

        assert.equal(
          updated[0]?.args.text,
          "How long should an invitation last? · You chose Email, SMS",
        );
      });
    },
  );

  it.effect(
    "a press of an ask its agent's archive withdrew brings the agent back and answers nothing, telling the agent nothing",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));

      return Effect.gen(function* () {
        const { owner, item, askId, slackUserId } = yield* openAskedMember(bot);
        const month = askButton(item.id, askId, { choice: "A month" });

        yield* archiveAgent(owner, item.agentId, true);
        const heard = HARNESS.heard.length;

        const kept = keptAfterResponse();
        yield* answer(bot, press(month, slackUserId), kept.layer);
        yield* kept.run;

        const stored = Option.getOrThrow(yield* readInboxItem(owner, item.id));
        assert.equal(
          stored.item.thread?.find((message) => message.ask)?.ask?.status,
          INBOX_ASK_STATUS.WITHDRAWN,
        );
        assert.equal(Option.getOrThrow(yield* readAgent(owner, item.agentId)).archivedAt, null);
        assert.equal(HARNESS.heard.length, heard);
      });
    },
  );

  it.effect(
    "a to-do's Mark done answers it with every step ticked, and its DM then says so under its steps",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));

      return Effect.gen(function* () {
        const { owner, item, askId, slackUserId } = yield* openAskedMember(bot, {
          type: INBOX_ASK.DO,
          steps: ["Open the repository's settings.", "Run this:\n```\npnpm install\n```"],
        });

        const done = askButton(item.id, askId, { reply: INBOX_REPLY.DONE });

        const kept = keptAfterResponse();
        yield* answer(bot, press(done, slackUserId), kept.layer);
        yield* kept.run;

        const words =
          "Pick how long an invitation stays open.\n\n1. Open the repository's settings.\n\n2. Run this:\n   ```\n   pnpm install\n   ```";

        const stored = Option.getOrThrow(yield* readInboxItem(owner, item.id));
        const asked = stored.item.thread?.find((message) => message.ask);
        assert.equal(asked?.ask?.status, INBOX_ASK_STATUS.ANSWERED);

        const updated = calls.filter((call) => call.method === "chat.update");

        assert.equal(
          updated[0]?.args.text,
          "How long should an invitation last? · You marked it done",
        );
        // The settled DM keeps the steps it asked.
        assert.equal(JSON.parse(updated[0]?.args.blocks ?? "[]")[0]?.text, words);
      });
    },
  );

  it.effect(
    "a mention starts an agent as the member Slack's email names, on an untitled task with a blank description in its channel's repository, reacts to it with 👀 and says nothing in the thread; one from no member starts nothing",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));

      return Effect.gen(function* () {
        const owner = yield* openGithubUser();
        yield* connectAgentApiKeys(owner);
        const task = yield* startTask(owner, { name: "Flaky tests" });
        yield* linkSlackInstallation({
          organizationId: task.workspaceId,
          teamId: "T0001",
          teamName: "Team",
          userId: owner,
        });
        yield* connectWorkspaceGitHub(task.workspaceId, RELAY_INSTALLATION);
        yield* writeSlackChannelRepository(task.workspaceId, "C0001", "Acme/Relay");

        const [row] = yield* (yield* Database)
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, owner));

        const opened = () => HARNESS.heard.filter((heard) => heard.call === "open").length;

        const replies = () =>
          calls.filter((call) => call.method === "chat.postMessage" && call.args.thread_ts);

        const before = opened();
        const stranger = yield* answer(bot, mention("U-nobody@app.test", `Ev${randomUUID()}`));
        const afterStranger = opened();
        const started = yield* answer(bot, mention(`U-${row?.email}`, `Ev${randomUUID()}`));

        assert.equal(stranger.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(afterStranger, before);
        assert.equal(started.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(HARNESS.heard.at(-1), { call: "open", account: owner });
        const [refused, ...others] = replies();
        assert.match(refused?.args.text ?? "", /couldn't find you/u);

        const [startedAgent] = yield* (yield* Database)
          .select({
            agentId: agentTable.id,
            taskId: agentTable.taskId,
            prompt: agentTable.prompt,
            repository: agentTable.repository,
            source: agentTable.source,
            metadata: messages.metadata,
          })
          .from(slackAgentThread)
          .innerJoin(agentTable, eq(agentTable.id, slackAgentThread.agentId))
          .innerJoin(messages, eq(messages.conversationId, agentTable.conversationId))
          .where(eq(slackAgentThread.userId, owner));

        assert.equal(startedAgent?.repository, "Acme/Relay");
        // The start says nothing in the thread; the agent speaks and reacts there itself.
        assert.deepEqual(others, []);
        const made = Option.getOrThrow(yield* readTask(owner, startedAgent?.taskId ?? ""));
        assert.deepEqual(
          {
            name: made.task.name,
            assignee: made.task.assignee?.userId,
            repository: made.task.repository,
            status: made.task.status,
            plan: made.text,
          },
          {
            name: UNTITLED_TASK_NAME,
            assignee: owner,
            repository: "Acme/Relay",
            status: TASK_STATUS.IN_PROGRESS,
            plan: "",
          },
          "the agent works on a task the message made, left for its title to name and assigned to its writer",
        );
        assert.ok(
          startedAgent?.prompt?.startsWith("find the flakiest test and fix it"),
          "the message is the agent's prompt",
        );
        assert.ok(
          startedAgent?.prompt?.includes("channel `C0001`, message `1700000002.000300`"),
          "the prompt names the message as react_slack takes it",
        );
        // The agent keeps where it came from, which the lists mark it by.
        assert.deepEqual(startedAgent?.source, {
          kind: "slack",
          url: "https://team.slack.com/archives/C0001/p1",
        });
        // The first line says Slack carried it, with the member's own words alone, for a window to draw.
        assert.deepEqual(startedAgent?.metadata, {
          channel: "slack",
          words: "find the flakiest test and fix it",
          url: "https://team.slack.com/archives/C0001/p1",
        });
      });
    },
  );

  it.effect(
    "a message in the thread of an archived agent brings it back, hands it the message, and posts nothing in the thread",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));

      return Effect.gen(function* () {
        const { owner, agent, threadTs, slackUserId } = yield* openThreadAgent(
          CONVERSATION_RUNTIME.CLAUDE_CODE,
          false,
        );

        yield* archiveAgent(owner, agent.id, true);

        const answered = yield* answer(
          bot,
          threadMention(slackUserId, `Ev${randomUUID()}`, threadTs),
        );

        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(Option.getOrThrow(yield* readAgent(owner, agent.id)).archivedAt, null);
        assert.deepEqual(HARNESS.heard.at(-1), { call: "send", account: owner });
        assert.deepEqual(
          calls.filter((call) => call.method === "chat.postMessage"),
          [],
        );
      });
    },
  );

  it.effect(
    "a reply in an agent's thread that names no bot reaches the agent, while one in a thread no agent's and one standing on its own reach nothing and say nothing",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));

      return Effect.gen(function* () {
        const { owner, threadTs, slackUserId } = yield* openThreadAgent(
          CONVERSATION_RUNTIME.CLAUDE_CODE,
          false,
        );

        const heard = HARNESS.heard.length;
        yield* answer(bot, channelMessage(slackUserId, `Ev${randomUUID()}`, "lunch?", undefined));
        yield* answer(
          bot,
          channelMessage(slackUserId, `Ev${randomUUID()}`, "lunch?", "1700000009.000900"),
        );

        assert.equal(HARNESS.heard.length, heard);
        assert.deepEqual(
          calls.filter((call) => call.method === "chat.postMessage"),
          [],
        );

        yield* answer(
          bot,
          channelMessage(slackUserId, `Ev${randomUUID()}`, "now make it faster", threadTs),
        );

        assert.deepEqual(HARNESS.heard.at(-1), { call: "send", account: owner });
      });
    },
  );

  it.effect(
    "a reply under a DM the agent sent with send_slack_message reaches that agent and starts none",
    () => {
      const calls: SlackCall[] = [];
      // Note that the DM's timestamp is this test's own, because the store is shared with the cases above.
      const dmTs = `1700000006.${randomUUID().replace(/\D/gu, "").slice(0, 6)}`;
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls, dmTs)));

      return Effect.gen(function* () {
        const { owner, agent, slackUserId } = yield* openThreadAgent(
          CONVERSATION_RUNTIME.CLAUDE_CODE,
          false,
        );

        const caller = { kind: AGENT_CALLER.AGENT, agent, descriptionsOn: false } as const;
        const noSandbox = () => Promise.reject(new Error("the sandbox was opened"));

        const sent = yield* runSendSlackMessage(
          { caller },
          { text: "Which plan should the invite go out on?", member: owner },
          noSandbox,
        ).pipe(Effect.provide(bot));

        assert.equal(sent.status, ACTION_RESULT_STATUS.ACCEPTED);

        const agentsOf = (yield* Database)
          .select({ id: agentTable.id })
          .from(agentTable)
          .where(eq(agentTable.userId, owner));

        const before = (yield* agentsOf).length;

        yield* answer(
          bot,
          dmReply(slackUserId, `Ev${randomUUID()}`, { channel: "D0001", ts: dmTs }),
        );

        assert.deepEqual(HARNESS.heard.at(-1), { call: "send", account: owner });
        assert.equal((yield* agentsOf).length, before);
      });
    },
  );

  it.effect(
    "a reply in an agent's thread that names the bot, which Slack sends both as a mention and as a message, is handed to the agent once",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));

      return Effect.gen(function* () {
        const { threadTs, slackUserId } = yield* openThreadAgent(
          CONVERSATION_RUNTIME.CLAUDE_CODE,
          false,
        );

        const sent = HARNESS.heard.filter((heard) => heard.call === "send").length;
        yield* answer(bot, threadMention(slackUserId, `Ev${randomUUID()}`, threadTs));
        yield* answer(
          bot,
          channelMessage(slackUserId, `Ev${randomUUID()}`, "<@UBOT> now make it faster", threadTs),
        );

        assert.equal(HARNESS.heard.filter((heard) => heard.call === "send").length, sent + 1);
      });
    },
  );

  it.effect(
    "a message in the thread of an agent whose session ended continues it in a new agent on the same task, moves the thread to it, and posts nothing in the thread",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));

      return Effect.gen(function* () {
        // An agent left on the retired runtime runs on no harness, so its session has ended for good.
        const { owner, agent, taskId, threadTs, slackUserId } = yield* openThreadAgent(
          CONVERSATION_RUNTIME.RETIRED,
          true,
        );

        const answered = yield* answer(
          bot,
          threadMention(slackUserId, `Ev${randomUUID()}`, threadTs),
        );

        assert.equal(answered.status, HOSTED_HTTP_STATUS.OK);

        const [thread] = yield* (yield* Database)
          .select({ agentId: slackAgentThread.agentId })
          .from(slackAgentThread)
          .innerJoin(agentTable, eq(agentTable.id, slackAgentThread.agentId))
          .where(eq(agentTable.userId, owner));

        assert.ok(thread !== undefined && thread.agentId !== agent.id);
        const continued = Option.getOrThrow(yield* readAgent(owner, thread.agentId));
        assert.deepEqual(continued.startedFrom?.agentId, agent.id);
        assert.equal(continued.taskId, taskId, "the new agent works on the ended one's task");
        assert.deepEqual(HARNESS.heard.at(-1), { call: "open", account: owner });
        assert.deepEqual(
          calls.filter((call) => call.method === "chat.postMessage"),
          [],
          "the new agent speaks for itself",
        );
      });
    },
  );

  it.effect(
    "a reply under a thread's DM is posted on that thread as the member it went to, brings its archived agent back and tells it, reacts with 👀, and starts no agent",
    () => {
      const calls: SlackCall[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls)));

      return Effect.gen(function* () {
        // Note that the DM's Slack thread is this test's own, because the store is shared with the presses above.
        const { owner, item, slackUserId } = yield* openAskedMember(
          bot,
          PICK_ONE,
          "1700000004.000500",
        );

        const opened = HARNESS.heard.filter((heard) => heard.call === "open").length;
        yield* archiveAgent(owner, item.agentId, true);

        const replied = yield* answer(
          bot,
          dmReply(slackUserId, `Ev${randomUUID()}`, { channel: "D0001", ts: "1700000004.000500" }),
        );

        assert.equal(replied.status, HOSTED_HTTP_STATUS.OK);
        const thread = Option.getOrThrow(yield* readInboxItem(owner, item.id)).item.thread ?? [];
        assert.deepEqual(
          thread
            .filter((message) => message.author === INBOX_MESSAGE_AUTHOR.MEMBER)
            .map((m) => m.text),
          ["A week, but let admins extend it"],
        );
        // The archive withdrew the ask, which bringing the agent back leaves withdrawn.
        assert.equal(
          thread.find((message) => message.ask)?.ask?.status,
          INBOX_ASK_STATUS.WITHDRAWN,
        );
        assert.equal(Option.getOrThrow(yield* readAgent(owner, item.agentId)).archivedAt, null);
        assert.deepEqual(HARNESS.heard.at(-1), { call: "send", account: owner });
        assert.equal(HARNESS.heard.filter((heard) => heard.call === "open").length, opened);
        assert.deepEqual(
          yield* (yield* Database)
            .select({ agentId: slackAgentThread.agentId })
            .from(slackAgentThread)
            .where(eq(slackAgentThread.threadTs, "1700000004.000500")),
          [],
        );
        assert.deepEqual(
          calls.flatMap((call) => (call.method === "reactions.add" ? [call.args] : [])),
          [{ channel: "D0001", timestamp: "1700000005.000600", name: "eyes" }],
        );
      });
    },
  );
  it.effect(
    "a direct message sharing images and a PDF and no words starts an agent handed them, a HEIC one as Slack's thumbnail",
    () => {
      const calls: SlackCall[] = [];
      const read: string[] = [];
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack(calls), fakeFiles(read)));

      return Effect.gen(function* () {
        const owner = yield* openGithubUser();
        yield* connectAgentApiKeys(owner);
        const task = yield* startTask(owner, { name: "Shared screenshots" });
        yield* linkSlackInstallation({
          organizationId: task.workspaceId,
          teamId: "T0001",
          teamName: "Team",
          userId: owner,
        });

        const [row] = yield* (yield* Database)
          .select({ email: user.email })
          .from(user)
          .where(eq(user.id, owner));

        const started = yield* answer(bot, directShare(`U-${row?.email}`, `Ev${randomUUID()}`));

        assert.equal(started.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(HARNESS.heard.at(-1), { call: "open", account: owner });
        assert.deepEqual(read, [
          "https://files.slack.com/files-pri/T0001-F0001/download/screen.png",
          "https://files.slack.com/files-tmb/T0001-F0002/mac_720.png",
          "https://files.slack.com/files-pri/T0001-F0001/download/notes.pdf",
        ]);

        const [first] = yield* (yield* Database)
          .select({ parts: messages.parts })
          .from(slackAgentThread)
          .innerJoin(agentTable, eq(agentTable.id, slackAgentThread.agentId))
          .innerJoin(messages, eq(messages.conversationId, agentTable.conversationId))
          .where(eq(slackAgentThread.channelId, "D0002"));

        const files = (first?.parts ?? []).flatMap((part) =>
          part.type === "file" ? [{ filename: part.filename, mediaType: part.mediaType }] : [],
        );

        assert.deepEqual(files, [
          { filename: "screen.png", mediaType: "image/png" },
          { filename: "mac.heic", mediaType: "image/png" },
          { filename: "notes.pdf", mediaType: "application/pdf" },
        ]);
      });
    },
  );
  it.effect(
    "a member's 👍 on the bot's message in an agent's thread reaches that agent quoting it, and the bot's own 👍 or another emoji does not",
    () => {
      const calls: SlackCall[] = [];
      const posted = "1700000007.000700";
      const fake = fakeSlack(calls);

      return Effect.gen(function* () {
        const { owner, agent, threadTs, slackUserId } = yield* openThreadAgent(
          CONVERSATION_RUNTIME.CLAUDE_CODE,
          false,
        );

        // Slack's read of the one message the bot posted in the agent's thread.
        const slack: SlackWebApi = (method, args) =>
          method === "conversations.replies" && args.ts === posted
            ? Effect.succeed({
                ok: true,
                messages: [
                  { ts: threadTs, user: slackUserId, text: "fix the flaky test" },
                  {
                    ts: posted,
                    thread_ts: threadTs,
                    user: "UBOT",
                    bot_id: "B0001",
                    text: "I pinned the clock in the retry test.",
                  },
                ],
              })
            : fake(method, args);

        const bot = Layer.succeed(SlackBot, slackBotOver(slack));

        const reaction = (user: string, name: string) =>
          slackEvent({
            type: "event_callback",
            team_id: "T0001",
            event_id: `Ev${randomUUID()}`,
            authorizations: [{ user_id: "UBOT" }],
            event: {
              type: "reaction_added",
              user,
              reaction: name,
              item_user: "UBOT",
              item: { type: "message", channel: "C0001", ts: posted },
            },
          });

        const sent = () => HARNESS.heard.filter((heard) => heard.call === "send").length;
        const before = sent();
        yield* answer(bot, reaction("UBOT", "+1"));
        yield* answer(bot, reaction(slackUserId, "tada"));

        assert.equal(sent(), before);
        yield* answer(bot, reaction(slackUserId, "+1::skin-tone-3"));

        assert.equal(sent(), before + 1);
        assert.deepEqual(HARNESS.heard.at(-1), { call: "send", account: owner });

        const lines = yield* (yield* Database)
          .select({ parts: messages.parts })
          .from(messages)
          .where(eq(messages.conversationId, agent.conversationId));

        const said = lines.flatMap((line) =>
          (line.parts ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])),
        );

        assert.ok(
          said.some((words) =>
            words.startsWith('👍 on your message: "I pinned the clock in the retry test."'),
          ),
        );
      });
    },
  );

  it.effect(
    "an uninstall of the app from a team deletes its workspace's installation and its members' Slack ids",
    () => {
      const bot = Layer.succeed(SlackBot, slackBotOver(fakeSlack([])));

      return Effect.gen(function* () {
        const owner = yield* openGithubUser();
        const task = yield* startTask(owner, { name: "Slack uninstall" });
        const organizationId = task.workspaceId;
        yield* linkSlackInstallation({
          organizationId,
          teamId: "T0001",
          teamName: "Team",
          userId: owner,
        });
        yield* recordSlackMemberLookup(organizationId, owner, "U0001");

        const uninstalled = yield* answer(
          bot,
          slackEvent({
            type: "event_callback",
            team_id: "T0001",
            event_id: `Ev${randomUUID()}`,
            event_time: 0,
            event: { type: "app_uninstalled" },
          }),
        );

        assert.deepEqual(uninstalled, { status: HOSTED_HTTP_STATUS.OK, body: {} });
        assert.ok(Option.isNone(yield* workspaceSlackInstallation(organizationId)));
        assert.ok(Option.isNone(yield* slackMemberLookup(organizationId, owner)));
      });
    },
  );
});
