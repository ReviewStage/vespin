import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  PROVIDER_KEY_ENCRYPTION_ENVIRONMENT,
  parseKeyRing,
} from "@repo/database/models/provider-key-seal";
import {
  linkSlackInstallation,
  saveSlackBotToken,
} from "@repo/database/models/slack-installation-store";
import { member, organization, user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { ConfigProvider, DateTime, Effect, Layer, Option, Redacted, Result } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import {
  beginIntegrationSignIn,
  completeIntegrationSignIn,
} from "../integrations/integration-store.js";
import {
  CONNECTOR_ASKED_NOTHING,
  firstIntegrationAccount,
  integrationConnectOf,
} from "../testing/integration-connect.js";
import { SlackApp, slackAppService } from "./slack-app.js";
import {
  SlackBot,
  SlackBotFailure,
  type SlackWebApi,
  slackBotFromEnvironment,
  slackBotOver,
} from "./slack-bot.js";
import { readSlackBot } from "./slack-bot-operations.js";

/**
 * Our Slack bot writing to a member, over a real store and a fake
 * Slack: a member whose email Slack knows is written to, one it does not
 * know is written nothing unless they connected their own Slack account in
 * the bot's team, and a Slack that refuses answers nothing rather than
 * failing whoever asked. Each workspace's calls are made on the token its
 * own install granted, and one that holds none writes nothing. Settings
 * offers the bot only where the deployment holds both the key ring that
 * opens a token and our Slack app whose install grants one.
 *
 * Synthetic accounts, workspaces, and Slack ids throughout.
 */

const KNOWN_EMAIL = "known@app.test";
const POSTED = { channel: "D0001", ts: "1700000000.000100" };
const CONTENT = { text: "A thread needs you", blocks: [] };

/** The deployment's key ring as its variable spells it: one fresh key. */
const RING_VARIABLE = `1:${randomBytes(32).toString("base64")}`;

/** A Slack that knows one member, by `KNOWN_EMAIL`, answers a member's own account as the user its subject names in the team, and posts every message it is handed. */
const fakeSlack: SlackWebApi = (method, args, memberSubject) => {
  switch (method) {
    case "auth.test":
      return Effect.succeed(
        memberSubject === undefined
          ? { ok: true, team_id: "T0001", team: "Team" }
          : { ok: true, team_id: "T0001", user_id: `U-${memberSubject}` },
      );
    case "users.lookupByEmail":
      return args.email === KNOWN_EMAIL
        ? Effect.succeed({ ok: true, user: { id: "U0001" } })
        : Effect.fail(new SlackBotFailure({ method, code: "users_not_found" }));
    case "chat.postMessage":
      return Effect.succeed({ ok: true, ...POSTED });
    default:
      return Effect.succeed({ ok: true });
  }
};

const openAccount = (email: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name: "Test User", email });

    return id;
  });

/** The account's own Slack account, connected as Settings › Integrations connects it, under the account's id as its subject. */
const connectOwnSlack = (userId: string) =>
  Effect.gen(function* () {
    const state = `state-${randomUUID()}`;
    yield* beginIntegrationSignIn(
      userId,
      firstIntegrationAccount(userId, INTEGRATION_PROVIDER.SLACK),
      state,
    );
    yield* completeIntegrationSignIn(userId, INTEGRATION_PROVIDER.SLACK, state);
  });

/** The account made a member of the workspace. */
const joinWorkspace = (organizationId: string, userId: string) =>
  Effect.gen(function* () {
    yield* (yield* Database).insert(member).values({
      id: randomUUID(),
      organizationId,
      userId,
      createdAt: yield* DateTime.nowAsDate,
    });
  });

/** A workspace whose bot is connected, by the member given. */
const openConnectedWorkspace = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    yield* db.insert(organization).values({
      id,
      name: "Test Workspace",
      slug: `workspace-${id}`,
      createdAt: yield* DateTime.nowAsDate,
    });
    yield* linkSlackInstallation({ organizationId: id, teamId: "T0001", teamName: "Team", userId });

    return id;
  });

it.layer(getTestDB())("the Slack bot", (it) => {
  it.effect("writes to a member Slack knows by their email, and nothing to one it does not", () =>
    Effect.gen(function* () {
      const known = yield* openAccount(KNOWN_EMAIL);
      const unknown = yield* openAccount(`${randomUUID()}@app.test`);
      const workspace = yield* openConnectedWorkspace(known);
      const bot = yield* slackBotOver(fakeSlack).forWorkspace(workspace);

      assert.deepEqual(yield* bot.dm(known, CONTENT), Option.some(POSTED));
      assert.deepEqual(yield* bot.dm(unknown, CONTENT), Option.none());
    }),
  );

  it.effect(
    "finds a member whose emails differ through their own Slack connection, writing to them and knowing them back",
    () =>
      Effect.gen(function* () {
        const writtenTo = yield* openAccount(`${randomUUID()}@app.test`);
        const writing = yield* openAccount(`${randomUUID()}@app.test`);
        const workspace = yield* openConnectedWorkspace(writtenTo);
        yield* joinWorkspace(workspace, writtenTo);
        yield* joinWorkspace(workspace, writing);
        yield* connectOwnSlack(writtenTo);
        yield* connectOwnSlack(writing);
        const bot = yield* slackBotOver(fakeSlack).forWorkspace(workspace);

        assert.deepEqual(yield* bot.dm(writtenTo, CONTENT), Option.some(POSTED));
        assert.deepEqual(yield* bot.memberOf("T0001", `U-${writing}`), Option.some(writing));
        assert.deepEqual(yield* bot.memberOf("T0001", "U-stranger"), Option.none());
      }),
  );

  it.effect("answers nothing where Slack refuses, rather than failing", () =>
    Effect.gen(function* () {
      const known = yield* openAccount(`${randomUUID()}-${KNOWN_EMAIL}`);
      const workspace = yield* openConnectedWorkspace(known);

      const bot = yield* slackBotOver((method) =>
        Effect.fail(new SlackBotFailure({ method, code: "invalid_auth" })),
      ).forWorkspace(workspace);

      assert.deepEqual(yield* bot.dm(known, CONTENT), Option.none());
    }),
  );

  it.effect(
    "calls Slack for each workspace on its own token, and for one holding none not at all",
    () => {
      const bearers: (string | undefined)[] = [];

      const slack = HttpClient.make((request) =>
        Effect.sync(() => {
          bearers.push(request.headers.authorization);

          return HttpClientResponse.fromWeb(request, Response.json({ ok: true, ...POSTED }));
        }),
      );

      const bot = slackBotFromEnvironment.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(HttpClient.HttpClient, slack),
            integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                [PROVIDER_KEY_ENCRYPTION_ENVIRONMENT.KEYS]: RING_VARIABLE,
              }),
            ),
          ),
        ),
      );

      return Effect.gen(function* () {
        const owner = yield* openAccount(`${randomUUID()}@app.test`);
        const ours = yield* openConnectedWorkspace(owner);
        const theirs = yield* openConnectedWorkspace(owner);
        const unsealed = yield* openConnectedWorkspace(owner);
        const ring = Result.getOrThrow(parseKeyRing(Redacted.make(RING_VARIABLE)));

        for (const [organizationId, token] of [
          [ours, "xoxb-ours"],
          [theirs, "xoxb-theirs"],
        ] as const) {
          yield* saveSlackBotToken(ring, {
            organizationId,
            teamId: "T0001",
            token: Redacted.make(token),
            botUserId: "U0BOT",
            botId: "B0BOT",
            appId: "A0APP",
            scopes: ["chat:write"],
            enterpriseId: null,
            isEnterpriseInstall: false,
          });
        }

        const { forWorkspace } = yield* SlackBot;

        const replies = yield* Effect.forEach([theirs, ours, unsealed], (organizationId) =>
          Effect.flatMap(forWorkspace(organizationId), (one) => one.reply("C0001", "1.0", CONTENT)),
        );

        assert.deepEqual(replies, [Option.some(POSTED), Option.some(POSTED), Option.none()]);
        assert.deepEqual(bearers, ["Bearer xoxb-theirs", "Bearer xoxb-ours"]);
      }).pipe(Effect.provide(bot));
    },
  );

  it.effect.each([
    { holds: "the key ring and the Slack app", ring: true, app: true, configured: true },
    { holds: "the key ring alone", ring: true, app: false, configured: false },
    { holds: "the Slack app alone", ring: false, app: true, configured: false },
  ])("is offered in Settings where the deployment holds $holds: $configured", (row) =>
    Effect.gen(function* () {
      const owner = yield* openAccount(`${randomUUID()}@app.test`);
      const workspace = yield* openWorkspace(owner);

      assert.equal((yield* readSlackBot(owner, workspace)).configured, row.configured);
    }).pipe(
      Effect.provideService(SlackBot, slackBotOver(row.ring ? fakeSlack : undefined)),
      Effect.provideService(
        SlackApp,
        slackAppService(
          row.app
            ? {
                clientId: "1.2",
                clientSecret: Redacted.make("client-secret"),
                signingSecret: Redacted.make("signing-secret"),
              }
            : undefined,
          [],
        ),
      ),
    ),
  );
});
