import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { parseKeyRing } from "@repo/database/models/provider-key-seal";
import {
  openSlackBot,
  workspaceSlackInstallation,
} from "@repo/database/models/slack-installation-store";
import { user } from "@repo/database/schemas/auth";
import {
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openWorkspace,
  WORKSPACE_ROLE,
} from "@repo/database/testing";
import { HOSTED_API_ERROR, HOSTED_SERVICE_PATH } from "@repo/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  type IntegrationLandingStatus,
  integrationLandingPath,
} from "@repo/features/integration-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { Clock, type Context, Effect, Layer, Option, Redacted, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { hostedFetch } from "../orpc/handler.js";
import type { WebServices } from "../runtime.js";
import { SLACK_BOT_SCOPES, SlackApp, type SlackAppSettings, slackAppService } from "./slack-app.js";
import { slackBotProcedures } from "./slack-bot-procedures.js";
import { slackInstallApp } from "./slack-install-app.js";

/**
 * Add to Slack, as the install procedure and the Redirect URL answer it: an
 * owner or admin is sent to Slack's authorize page, Slack returns the
 * browser with a code the route exchanges for the bot token, and the team is
 * linked and the token sealed only where the Slack user who approved is the
 * member who began. The store is the real one on PGlite; Slack's Web API is
 * the one network double, which grants a token for the code it minted alone.
 * Synthetic accounts, codes, tokens, and Slack ids throughout.
 */

const ORIGIN = "https://app.test";
const CALLBACK = `${ORIGIN}${HOSTED_SERVICE_PATH.SLACK_OAUTH_CALLBACK}`;

const SETTINGS: SlackAppSettings = {
  clientId: "client-id",
  clientSecret: Redacted.make("client-secret"),
  signingSecret: Redacted.make("signing-secret"),
};

const KEYS = Redacted.make(`1:${Buffer.alloc(32, 7).toString("base64")}`);
const RING = Result.getOrThrow(parseKeyRing(KEYS));

const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  posthogDistinctIdKey: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: KEYS,
  titleAnthropicApiKey: undefined,
  previewApiKeys: {},
};

const TEAM = { id: "T0TEAM", name: "Acme" };
const CODE = "1234.5678.abcd";
const BOT_TOKEN = "xoxb-test-token";

/** Our client as HTTP Basic, as `oauth.v2.access` recommends it be sent. */
const CLIENT_BASIC = `Basic ${btoa(`${SETTINGS.clientId}:${Redacted.value(SETTINGS.clientSecret)}`)}`;

/** An account with a user row; its id, which its email is spelled from. */
const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: emailOf(userId) });

  return userId;
});

function emailOf(userId: string): string {
  return `${userId}@app.test`;
}

/** A workspace with an owner, an admin, and a member, and a stranger to it. */
const team = Effect.gen(function* () {
  const owner = yield* openAccount;
  const admin = yield* openAccount;
  const member = yield* openAccount;
  const stranger = yield* openAccount;
  const workspaceId = yield* openWorkspace(owner);
  yield* joinWorkspace(workspaceId, admin, WORKSPACE_ROLE.ADMIN);
  yield* joinWorkspace(workspaceId, member, WORKSPACE_ROLE.MEMBER);

  return { owner, admin, member, stranger, workspaceId };
});

/** One call Slack heard: its method and its form. */
interface SlackCall {
  readonly method: string;
  readonly form: Readonly<Record<string, string>>;
}

/**
 * Slack's Web API: `oauth.v2.access` grants the bot token for our client's
 * own code, sent as HTTP Basic, and the Redirect URL the authorize address named;
 * `auth.test` answers on that token.
 */
function slackApi() {
  const heard: SlackCall[] = [];

  const layer = fakeHttpClientLayer(async (url, init) => {
    const method = new URL(url).pathname.replace("/api/", "");
    const form = Object.fromEntries(new URLSearchParams(await new Response(init.body).text()));
    heard.push({ method, form });
    const bearer = new Headers(init.headers).get("authorization");

    if (method === "oauth.v2.access") {
      const granted =
        bearer === CLIENT_BASIC && form.code === CODE && form.redirect_uri === CALLBACK;

      return granted
        ? Response.json({
            ok: true,
            access_token: BOT_TOKEN,
            token_type: "bot",
            scope: "chat:write,users:read.email",
            bot_user_id: "U0BOT",
            app_id: "A0APP",
            team: TEAM,
            enterprise: null,
            is_enterprise_install: false,
            authed_user: { id: "U0ADMIN" },
          })
        : Response.json({ ok: false, error: "invalid_code" });
    }

    if (bearer !== `Bearer ${BOT_TOKEN}`) return Response.json({ ok: false, error: "not_authed" });

    if (method === "auth.test") {
      return Response.json({ ok: true, team_id: TEAM.id, user_id: "U0BOT", bot_id: "B0BOT" });
    }

    return Response.json({ ok: false, error: "unknown_method" });
  });

  return { layer, heard };
}

/** The procedure and the route over the test's database, the app as `settings` configures it, and Slack. */
const standing = (settings: SlackAppSettings | undefined) =>
  Effect.gen(function* () {
    const slack = slackApi();

    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(SlackApp, slackAppService(settings, ["SLACK_APP_CLIENT_ID"])),
      Layer.succeed(HostedEnvironment, ENVIRONMENT),
      slack.layer,
    );

    const app = HttpRouter.toWebHandler(
      slackInstallApp().pipe(HttpRouter.provideRequest(services)),
      {
        disableLogger: true,
      },
    );

    yield* Effect.addFinalizer(() => Effect.promise(() => app.dispose()));
    const context = yield* Effect.context<never>().pipe(Effect.provide(services));

    const procedures = hostedFetch({
      workspaceSlackBot: slackBotProcedures({
        resolveUserId: (incoming) =>
          Effect.succeed(
            Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
          ),
      }),
    });

    // SAFETY: the install yields the database, the Slack app, and the HTTP client alone, which is all a test provides of the web runtime's services.
    const webServices = context as Context.Context<WebServices>;

    /** An install begun by the account: the status, the body, and the authorize address's query. */
    const install = (userId: string, workspaceId: string) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          procedures(
            new Request(new URL(HOSTED_SERVICE_PATH.WORKSPACE_SLACK_BOT_INSTALL, ORIGIN), {
              method: "POST",
              headers: { authorization: `Bearer ${userId}`, "content-type": "application/json" },
              body: JSON.stringify({ workspaceId }),
            }),
            webServices,
          ),
        );

        // SAFETY: the router answers JSON; an install answers `{ url }`, or a refusal that carries none.
        const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput & {
          url?: string;
        };

        const url = body.url === undefined ? undefined : new URL(body.url);

        return { status: response.status, body, url, state: url?.searchParams.get("state") };
      });

    /** Slack returning the browser with this query; where it was sent on. */
    const returned = (query: Record<string, string>) =>
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          app.handler(new Request(`${CALLBACK}?${new URLSearchParams(query)}`)),
        );

        return response.headers.get("location");
      });

    return {
      slack,
      install,
      returned,
    };
  });

const landed = (status: IntegrationLandingStatus) =>
  integrationLandingPath(INTEGRATION_PROVIDER.SLACK, status);

/** The bot the workspace holds, without its token, and whether the token is the one Slack granted. */
const keptBot = (workspaceId: string) =>
  Effect.map(openSlackBot(RING, workspaceId), (bot) =>
    Option.map(bot, ({ token, ...rest }) => ({
      ...rest,
      granted: Redacted.value(token) === BOT_TOKEN,
    })),
  );

it.layer(getTestDB())("Add to Slack", (it) => {
  it.effect(
    "an admin installs our Slack app, and the workspace keeps the team and the sealed bot token",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(SETTINGS);
        const { admin, workspaceId } = yield* team;

        const begun = yield* group.install(admin, workspaceId);
        const state = begun.state ?? assert.fail("no state");
        const landing = yield* group.returned({ code: CODE, state });

        assert.equal(
          begun.url?.origin + (begun.url?.pathname ?? ""),
          "https://slack.com/oauth/v2/authorize",
        );
        assert.equal(begun.url?.searchParams.get("client_id"), SETTINGS.clientId);
        assert.equal(begun.url?.searchParams.get("scope"), SLACK_BOT_SCOPES.join(","));
        assert.equal(begun.url?.searchParams.get("redirect_uri"), CALLBACK);
        assert.equal(landing, landed(INTEGRATION_LANDING_STATUS.CONNECTED));
        assert.deepEqual(
          yield* workspaceSlackInstallation(workspaceId),
          Option.some({
            teamId: TEAM.id,
            teamName: TEAM.name,
          }),
        );
        assert.deepEqual(
          yield* keptBot(workspaceId),
          Option.some({
            teamId: TEAM.id,
            botUserId: "U0BOT",
            botId: "B0BOT",
            appId: "A0APP",
            scopes: ["chat:write", "users:read.email"],
            enterpriseId: null,
            isEnterpriseInstall: false,
            granted: true,
          }),
        );
      }),
  );

  it.effect(
    "a member may not begin an install, a stranger finds no workspace, and a deployment without the app is unavailable",
    () =>
      Effect.gen(function* () {
        const group = yield* standing(SETTINGS);
        const unconfigured = yield* standing(undefined);
        const { admin, member, stranger, workspaceId } = yield* team;

        const refused = yield* group.install(member, workspaceId);
        const unknown = yield* group.install(stranger, workspaceId);
        const unavailable = yield* unconfigured.install(admin, workspaceId);

        assert.deepEqual(
          { status: refused.status, body: refused.body },
          { status: HOSTED_HTTP_STATUS.FORBIDDEN, body: { error: HOSTED_API_ERROR.NOT_PERMITTED } },
        );
        assert.deepEqual(unknown.body, { error: HOSTED_API_ERROR.NOT_FOUND });
        assert.equal(unavailable.status, HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE);
      }),
  );

  it.effect("a state spends once, so one replayed, made up, or canceled installs nothing", () =>
    Effect.gen(function* () {
      const group = yield* standing(SETTINGS);
      const { admin, workspaceId } = yield* team;

      const canceled = (yield* group.install(admin, workspaceId)).state ?? assert.fail("no state");
      const cancel = yield* group.returned({ error: "access_denied", state: canceled });
      const afterCancel = yield* group.returned({ code: CODE, state: canceled });
      const madeUp = yield* group.returned({ code: CODE, state: "not-a-state" });
      const missing = yield* group.returned({ code: CODE });

      assert.equal(cancel, landed(INTEGRATION_LANDING_STATUS.NOT_COMPLETED));
      assert.equal(afterCancel, landed(INTEGRATION_LANDING_STATUS.EXPIRED));
      assert.equal(madeUp, landed(INTEGRATION_LANDING_STATUS.EXPIRED));
      assert.equal(missing, landed(INTEGRATION_LANDING_STATUS.EXPIRED));
      assert.deepEqual(group.slack.heard, []);
      assert.equal(Option.isNone(yield* workspaceSlackInstallation(workspaceId)), true);
    }),
  );

  it.effect("an admin who lost the role while Slack was open installs nothing", () =>
    Effect.gen(function* () {
      const group = yield* standing(SETTINGS);
      const { admin, workspaceId } = yield* team;

      const state = (yield* group.install(admin, workspaceId)).state ?? assert.fail("no state");
      yield* leaveWorkspace(workspaceId, admin);
      yield* joinWorkspace(workspaceId, admin, WORKSPACE_ROLE.MEMBER);
      const landing = yield* group.returned({ code: CODE, state });

      assert.equal(landing, landed(INTEGRATION_LANDING_STATUS.NOT_PERMITTED));
      assert.deepEqual(group.slack.heard, []);
      assert.equal(Option.isNone(yield* workspaceSlackInstallation(workspaceId)), true);
    }),
  );

  it.effect("a code Slack does not grant installs nothing", () =>
    Effect.gen(function* () {
      const group = yield* standing(SETTINGS);
      const { admin, workspaceId } = yield* team;
      const state = (yield* group.install(admin, workspaceId)).state ?? assert.fail("no state");

      const landing = yield* group.returned({ code: "forged", state });

      assert.equal(landing, landed(INTEGRATION_LANDING_STATUS.NOT_COMPLETED));
      assert.deepEqual(
        group.slack.heard.map((call) => call.method),
        ["oauth.v2.access"],
      );
      assert.equal(Option.isNone(yield* workspaceSlackInstallation(workspaceId)), true);
    }),
  );
});
