/**
 * slack-install-app.ts -- Add to Slack: the authorize address an install begins at, and the Redirect URL Slack returns the browser to.
 *
 * An owner or admin installs our Slack app into the workspace's Slack with
 * Slack's OAuth v2 (https://docs.slack.dev/authentication/installing-with-oauth/).
 * The hosted procedure (`slack-bot-operations.ts`'s `installSlackBot`) opens
 * an install intent bound to the account and the workspace
 * (`integration-installation-store.ts`) and answers Slack's authorize
 * address, which asks for the bot scopes (`SLACK_BOT_SCOPES`) and carries
 * the intent's state and this route as its `redirect_uri`.
 *
 * `GET /api/slack/oauth/callback` is a browser navigation that carries no
 * bearer. The intent is spent first, whatever Slack sent, so a state
 * replayed, unknown, or expired installs nothing; the account must still be
 * an owner or admin of its workspace, or it lands as not permitted. Slack's
 * `error` lands as not completed: `access_denied` where the person canceled,
 * the one code Slack's guide names for the redirect; any other, an install
 * sent to the Slack workspace's admins for approval among them, is
 * undocumented and logged by its code. Nothing on the address is trusted on
 * its own: the code is exchanged at Slack (`oauth.v2.access`) under our
 * client, with the same `redirect_uri`, for the bot token, and `auth.test` on
 * that token answers the bot's own id, as Bolt's installer reads it. An
 * install into a whole Enterprise Grid org names no team, and is refused as
 * not completed.
 *
 * Slack's guide asks nothing of who approves the install beyond Slack's own
 * check that they may install apps in that Slack workspace, so neither do we:
 * the member who began it must still manage the workspace, and the team is
 * then linked to the workspace (`linkSlackInstallation`) and the bot token
 * sealed beside it (`saveSlackBotToken`), in one transaction.
 *
 * The token and the code are used here and sealed or dropped; neither is
 * logged, and a failure is logged by Slack's error code alone. Whatever
 * happened, the browser lands on the integrations landing page with Slack
 * and one word.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { INSTALL_INTENT_PROVIDER } from "@repo/database/integration-vocabulary";
import { spendIntegrationInstallIntent } from "@repo/database/models/integration-installation-store";
import {
  linkSlackInstallation,
  saveSlackBotToken,
} from "@repo/database/models/slack-installation-store";
import { workspaceOf } from "@repo/database/models/workspace-store";
import { HOSTED_SERVICE_PATH } from "@repo/features";
import {
  INTEGRATION_LANDING_STATUS,
  INTEGRATION_PROVIDER,
  type IntegrationLandingStatus,
  integrationLandingPath,
} from "@repo/features/integration-wire";
import { managesWorkspace } from "@repo/features/workspace-role";
import { Data, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import { SqlClient } from "effect/sql";
import type { HostedEnvironment } from "../environment.js";
import {
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { hostedKeyRing } from "../orpc/base.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { SLACK_BOT_SCOPES, SlackApp, type SlackAppSettings } from "./slack-app.js";

/** Where Slack's authorize page and Web API stand. */
const SLACK_ORIGIN = "https://slack.com";

/** Slack's authorize page for an app's install. */
const AUTHORIZE_PATH = "/oauth/v2/authorize";

/** The query the authorize address carries to Slack. */
const AUTHORIZE_QUERY = {
  CLIENT_ID: "client_id",
  SCOPE: "scope",
  REDIRECT_URI: "redirect_uri",
  STATE: "state",
} as const;

/** The query Slack puts on the Redirect URL. */
const CALLBACK_QUERY = {
  CODE: "code",
  STATE: "state",
  ERROR: "error",
} as const;

/** The Web API methods an install calls. */
const SLACK_METHOD = {
  OAUTH_V2_ACCESS: "oauth.v2.access",
  AUTH_TEST: "auth.test",
} as const;

type SlackMethod = (typeof SLACK_METHOD)[keyof typeof SLACK_METHOD];

/** Slack's `error` on the Redirect URL where the person canceled the install. */
const SLACK_ACCESS_DENIED = "access_denied";

/** Slack's error code as a log line may keep it: a short slug, and nothing shaped like a sentence or a token. */
const SLACK_CODE_PATTERN = /^[a-z][a-z0-9_]{0,62}$/u;

/** A code as Slack spells one: dotted digits and hex, bounded so nothing long is sent on. */
const GRANT_CODE = /^[A-Za-z0-9._-]{1,256}$/u;

/** A browser is sent on with 303, so the landing is the GET the page is. */
const SEE_OTHER = 303;

const SLACK = INTEGRATION_PROVIDER.SLACK;

/** Every Web API answer: whether it succeeded, and its error code where it did not. */
const AnswerSchema = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
});

/** `oauth.v2.access`'s answer, as far as an install reads it. */
const AccessSchema = Schema.Struct({
  access_token: Schema.String,
  scope: Schema.String,
  bot_user_id: Schema.String,
  app_id: Schema.String,
  team: Schema.NullOr(Schema.Struct({ id: Schema.String, name: Schema.String })),
  enterprise: Schema.NullOr(Schema.Struct({ id: Schema.String })),
  is_enterprise_install: Schema.Boolean,
});

type SlackAccess = typeof AccessSchema.Type;

/** `auth.test`'s answer on the bot's token: the bot's own id. */
const AuthTestSchema = Schema.Struct({ bot_id: Schema.String });

/** Why Slack did not grant an install: it refused, by its error code where it gave one, or did not answer. */
class SlackInstallFailure extends Data.TaggedError("SlackInstallFailure")<{
  readonly method: SlackMethod;
  readonly answered: boolean;
  readonly code?: string;
}> {
  override get message(): string {
    return `Slack ${this.answered ? "refused" : "did not answer"} ${this.method}${this.code === undefined ? "" : `: ${this.code}`}`;
  }
}

/** Slack's error code where it is one a log line may keep. */
function codeOf(error: string | undefined): string | undefined {
  return error !== undefined && SLACK_CODE_PATTERN.test(error) ? error : undefined;
}

/** How a call authenticates: our client by HTTP Basic, as `oauth.v2.access` recommends, or the bot's token as a bearer. */
type CallAuth = (
  request: HttpClientRequest.HttpClientRequest,
) => HttpClientRequest.HttpClientRequest;

const CALL_AUTH = {
  client: (settings: SlackAppSettings): CallAuth =>
    HttpClientRequest.basicAuth(settings.clientId, Redacted.value(settings.clientSecret)),
  bot: (token: Redacted.Redacted<string>): CallAuth =>
    HttpClientRequest.bearerToken(Redacted.value(token)),
} as const;

/**
 * One Web API call, a form post as Slack's docs take every method, its
 * answer read as the schema says: an answer that is not ok, or not that
 * shape, is refused; no answer is unanswered.
 */
function slackCall<A>(
  method: SlackMethod,
  args: Readonly<Record<string, string>>,
  schema: Schema.Codec<A, unknown>,
  auth: CallAuth,
): Effect.Effect<A, SlackInstallFailure, HttpClient.HttpClient> {
  const refused = (code?: string) =>
    new SlackInstallFailure({
      method,
      answered: true,
      ...(code === undefined ? undefined : { code }),
    });

  const request = HttpClientRequest.post(`${SLACK_ORIGIN}/api/${method}`).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bodyUrlParams(args),
    auth,
  );

  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const body = yield* client.execute(request).pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Schema.Unknown)),
      Effect.scoped,
      Effect.mapError(() => new SlackInstallFailure({ method, answered: false })),
    );

    const said = yield* Schema.decodeUnknownEffect(AnswerSchema)(body).pipe(
      Effect.mapError(() => refused()),
    );

    if (!said.ok) return yield* Effect.fail(refused(codeOf(said.error)));

    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(Effect.mapError(() => refused()));
  });
}

/** Where Slack returns the browser: this route on the host the install began on. */
export function slackInstallCallback(origin: string): string {
  return new URL(HOSTED_SERVICE_PATH.SLACK_OAUTH_CALLBACK, origin).toString();
}

/** Slack's authorize address for our app, asking for the bot scopes, carrying the intent's state and the Redirect URL. */
export function slackAuthorizeUrl(
  settings: SlackAppSettings,
  state: string,
  redirectUri: string,
): string {
  const url = new URL(AUTHORIZE_PATH, SLACK_ORIGIN);
  url.searchParams.set(AUTHORIZE_QUERY.CLIENT_ID, settings.clientId);
  url.searchParams.set(AUTHORIZE_QUERY.SCOPE, SLACK_BOT_SCOPES.join(","));
  url.searchParams.set(AUTHORIZE_QUERY.REDIRECT_URI, redirectUri);
  url.searchParams.set(AUTHORIZE_QUERY.STATE, state);

  return url.toString();
}

/** The landing a Slack `error` on the Redirect URL settles on. */
const landedOnSlackError = Effect.fn("web/slackInstallError")(function* (error: string) {
  if (error === SLACK_ACCESS_DENIED) return INTEGRATION_LANDING_STATUS.NOT_COMPLETED;
  // Note that Slack documents no other code here, an admin approval's included, so each is logged to learn it.
  yield* Effect.logWarning(
    "Slack returned an install with an error",
    codeOf(error) ?? "unreadable",
  );

  return INTEGRATION_LANDING_STATUS.NOT_COMPLETED;
});

/** The code exchanged at Slack for the install's grant, under our client and the Redirect URL the authorize address named. */
function exchangeCode(settings: SlackAppSettings, code: string, redirectUri: string) {
  return slackCall(
    SLACK_METHOD.OAUTH_V2_ACCESS,
    { code, redirect_uri: redirectUri },
    AccessSchema,
    CALL_AUTH.client(settings),
  );
}

/** The team linked to the workspace and the bot token sealed beside it, in one transaction. */
const keepInstall = Effect.fn("web/slackKeepInstall")(function* (
  userId: string,
  organizationId: string,
  access: SlackAccess,
  team: { readonly id: string; readonly name: string },
  botId: string,
) {
  const ring = yield* hostedKeyRing;
  const client = yield* SqlClient.SqlClient;

  const kept = client.withTransaction(
    Effect.gen(function* () {
      yield* linkSlackInstallation({
        organizationId,
        teamId: team.id,
        teamName: team.name,
        userId,
      });

      return yield* saveSlackBotToken(ring, {
        organizationId,
        teamId: team.id,
        token: Redacted.make(access.access_token),
        botUserId: access.bot_user_id,
        botId,
        appId: access.app_id,
        scopes: access.scope.split(",").filter((scope) => scope.length > 0),
        enterpriseId: access.enterprise?.id ?? null,
        isEnterpriseInstall: access.is_enterprise_install,
      });
    }),
  );

  return yield* hostedStoreOrUnavailable(kept);
});

/**
 * The grant proven and kept: the code exchanged, the bot's id read, and the
 * install kept; a refusal at Slack lands as not completed, and no answer as
 * unavailable.
 */
const grantedLanding = Effect.fn("web/slackGrantedLanding")(function* (
  settings: SlackAppSettings,
  userId: string,
  organizationId: string,
  code: string,
  redirectUri: string,
): Effect.fn.Return<
  IntegrationLandingStatus,
  SlackInstallFailure | HostedRefusal,
  DatabaseServices | HttpClient.HttpClient | HostedEnvironment
> {
  const access = yield* exchangeCode(settings, code, redirectUri);

  // Note that an org-wide install names no team, which a workspace's bot cannot stand for.
  if (access.team === null || access.is_enterprise_install) {
    yield* Effect.logWarning("Slack returned an org-wide install, which is not kept");

    return INTEGRATION_LANDING_STATUS.NOT_COMPLETED;
  }

  const token = Redacted.make(access.access_token);
  const bot = yield* slackCall(SLACK_METHOD.AUTH_TEST, {}, AuthTestSchema, CALL_AUTH.bot(token));

  const saved = yield* keepInstall(userId, organizationId, access, access.team, bot.bot_id);

  return saved ? INTEGRATION_LANDING_STATUS.CONNECTED : INTEGRATION_LANDING_STATUS.UNAVAILABLE;
});

/** How an install the browser returned from settled. */
const callbackLanding = Effect.fn("web/slackCallbackLanding")(function* (
  query: URLSearchParams,
  redirectUri: string,
): Effect.fn.Return<
  IntegrationLandingStatus,
  HostedRefusal,
  DatabaseServices | SlackApp | HttpClient.HttpClient | HostedEnvironment
> {
  const state = query.get(CALLBACK_QUERY.STATE);

  if (state === null) return INTEGRATION_LANDING_STATUS.EXPIRED;

  const intent = yield* hostedStoreOrUnavailable(
    spendIntegrationInstallIntent(INSTALL_INTENT_PROVIDER.SLACK, state),
  );

  if (Option.isNone(intent)) return INTEGRATION_LANDING_STATUS.EXPIRED;
  const { userId, organizationId } = intent.value;
  const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, organizationId));

  if (Option.isNone(workspace) || !managesWorkspace(workspace.value)) {
    return INTEGRATION_LANDING_STATUS.NOT_PERMITTED;
  }

  const error = query.get(CALLBACK_QUERY.ERROR);

  if (error !== null) return yield* landedOnSlackError(error);
  const code = query.get(CALLBACK_QUERY.CODE);

  if (code === null || !GRANT_CODE.test(code)) return INTEGRATION_LANDING_STATUS.NOT_COMPLETED;
  const settings = yield* Effect.result((yield* SlackApp).settings);

  if (Result.isFailure(settings)) return INTEGRATION_LANDING_STATUS.UNAVAILABLE;

  const granted = yield* Effect.result(
    grantedLanding(settings.success, userId, organizationId, code, redirectUri),
  );

  if (Result.isSuccess(granted)) return granted.success;
  const failure = granted.failure;

  if (!(failure instanceof SlackInstallFailure)) return yield* Effect.fail(failure);
  // Note that only the method and Slack's code are logged, never the code or a token.
  yield* Effect.logWarning("Slack did not grant an install", failure.message);

  return failure.answered
    ? INTEGRATION_LANDING_STATUS.NOT_COMPLETED
    : INTEGRATION_LANDING_STATUS.UNAVAILABLE;
});

/** GET: the Redirect URL. Whatever Slack sent, the browser lands on the page with a word. */
const callbackEndpoint = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const web = yield* Effect.orDie(HttpServerRequest.toWeb(request));
  const url = new URL(web.url);

  const status = yield* callbackLanding(url.searchParams, slackInstallCallback(url.origin)).pipe(
    Effect.catch(() => Effect.succeed(INTEGRATION_LANDING_STATUS.UNAVAILABLE)),
  );

  return HttpServerResponse.redirect(integrationLandingPath(SLACK, status), { status: SEE_OTHER });
});

/** The route: the Redirect URL, and the hosted vocabulary's own refusal for any other path. */
export function slackInstallApp(): WebRoutes<
  DatabaseServices | SlackApp | HttpClient.HttpClient | HostedEnvironment
> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, HOSTED_SERVICE_PATH.SLACK_OAUTH_CALLBACK, callbackEndpoint),
    hostedNotFoundRoute,
  );
}
