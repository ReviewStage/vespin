/**
 * github.ts -- the `GitHub` service: every request to GitHub's API, as the App, an installation, or a member, sent through one Octokit per identity and run as an Effect.
 *
 * Octokit is the client, configured only through its documented options:
 * `@octokit/auth-app` signs the App's JWT and mints installation tokens,
 * kept in its own per-instance cache by installation, repositories, and
 * permissions, and never by member, since an installation token is the same
 * token whoever asked. `@octokit/plugin-throttling` is GitHub's request
 * guidance as Octokit implements it: requests are queued per identity
 * (`throttle.id`), one out at a time (`throttle.global`, a group of
 * `maxConcurrent: 1`, since GitHub asks for serial requests), with its
 * defaults otherwise: a second between writes and between GraphQL requests,
 * three between requests that notify, two between searches, and a GraphQL
 * `RATE_LIMITED` read even under a 200. Its rate-limit handlers hold the
 * identity (`github-rate.ts`) and answer `false`, so nothing is retried
 * inside a request and the caller reads `GitHubRateLimited`. The plugin's
 * queues are the instance's alone; the holds are every instance's, through
 * `GitHubHoldStore`, and Bottleneck's Redis clustering is not used.
 *
 * Inside the throttle's queue, so a request that waited behind a refusal is
 * not sent after it, a hook of this module's own (`conduct`) refuses a
 * request while a hold stands on its identity, reads GitHub's counters off
 * every answer for the members' reserve, and holds for a rate-limit refusal
 * the throttle does not read as one: a 429 or a 403 with `retry-after` that
 * names neither a secondary limit nor an empty quota. The reserve itself is
 * read where the caller's `GitHubPriority` is known, as the call starts.
 *
 * Every request leaves through `githubFetch`, on the `HttpClient` the layer
 * was built over, under the fiber context of the call that asked; a token
 * mint the auth strategy sends on its own leaves under the layer's.
 */

import { createHash } from "node:crypto";
import { createAppAuth, type InstallationAuthOptions } from "@octokit/auth-app";
import { Octokit, type OctokitOptions } from "@octokit/core";
import { type PaginatingEndpoints, paginateRest } from "@octokit/plugin-paginate-rest";
import { type ThrottlingOptions, throttling } from "@octokit/plugin-throttling";
import type { EndpointOptions, Endpoints, RequestInterface } from "@octokit/types";
import Bottleneck from "bottleneck";
import { Clock, Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import {
  type GitHubFailure,
  GitHubForbidden,
  GitHubNotFound,
  GitHubRateLimited,
  GitHubRejected,
  GitHubUnauthorized,
  GitHubUnavailable,
  GitHubUnreadable,
} from "./github-failure.js";
import { githubFetch } from "./github-fetch.js";
import type { GitHubHoldStore } from "./github-hold-store.js";
import {
  type GitHubIdentity,
  type GitHubIdentityKind,
  IDENTITY_KIND,
  RATE_SCOPE_KIND,
} from "./github-identity.js";
import {
  type AnswerHeaders,
  answered,
  GitHubPriority,
  HeldRequest,
  type HoldState,
  heldUntil,
  holdStateOf,
  type IdentityState,
  PRIORITY,
  type RouteOf,
  recordRate,
  refused,
  reservedUntil,
} from "./github-rate.js";

/** The REST API version every request names (https://docs.github.com/en/rest/about-the-rest-api/api-versions). */
const API_VERSION = "2022-11-28";

/** The member identities an instance keeps state for, least recently used first out. */
const MEMBERS_KEPT = 128;

const STATUS = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  FIRST_CLIENT_ERROR: 400,
  FIRST_SERVER_ERROR: 500,
} as const;

/** GitHub's GraphQL error types the failure union reads. */
const GRAPHQL_ERROR = {
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  FORBIDDEN: "FORBIDDEN",
} as const;

/** The words of a rate-limit refusal that sends neither header, and of a secondary limit, as the throttle reads it. */
const RATE_LIMIT_WORDS = /rate limit/iu;
const SECONDARY_LIMIT_WORDS = /\bsecondary rate\b/iu;

/** A `link` header naming a next page (https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api). */
const NEXT_PAGE = /rel="next"/u;

/** The header GitHub answers a token not authorized for an organization's SAML SSO with. */
const SSO_HEADER = "x-github-sso";

const GRAPHQL_RESOURCE = "graphql";
const CORE_RESOURCE = "core";

const MintedToken = Schema.Struct({ token: Schema.String, expiresAt: Schema.String });

/** The App the layer acts as. `userAgent` names the deployment to GitHub, as GitHub asks every client to. */
export interface GitHubAppOptions {
  readonly appId: number | string;
  readonly privateKey: Redacted.Redacted<string>;
  readonly userAgent: string;
  /**
   * The throttle's spacing groups, where they are not the plugin's own: the
   * plugin's documented `write`, `search`, and `notifications` options. A test
   * hands groups with no `minTime`, since the plugin spaces on real time.
   */
  readonly throttleGroups?: GitHubThrottleGroups;
}

/** The throttle's spacing groups, as `@octokit/plugin-throttling` takes them. */
export interface GitHubThrottleGroups {
  readonly write?: Bottleneck.Group;
  readonly search?: Bottleneck.Group;
  readonly notifications?: Bottleneck.Group;
}

/** An installation token to hand to something outside the module, such as `git`, and when GitHub expires it. */
export interface InstallationToken {
  readonly token: Redacted.Redacted<string>;
  readonly expiresAt: Date;
}

/** An installation token's reach: the installation, and the repositories and permissions it is minted for, all of them where left out. */
export interface InstallationGrant {
  readonly installationId: number;
  readonly repositoryIds?: ReadonlyArray<number>;
  readonly repositoryNames?: ReadonlyArray<string>;
  readonly permissions?: Readonly<Record<string, string>>;
}

/** A value a GraphQL document's variables hold. */
export type GraphqlVariable =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<GraphqlVariable>
  | { readonly [name: string]: GraphqlVariable };

/** The keys of a listing's page that are not its items, as Octokit's paginator leaves them out. */
type PageMetadataKey =
  | "total_count"
  | "incomplete_results"
  | "repository_selection"
  | "total_commits";

type PageData<R extends keyof PaginatingEndpoints> = PaginatingEndpoints[R]["response"]["data"];

/** One item of a listing: the page's array, or the one array a wrapped page holds. */
export type GitHubPageItem<R extends keyof PaginatingEndpoints> =
  PageData<R> extends ReadonlyArray<infer Item>
    ? Item
    : PageData<R>[Exclude<keyof PageData<R>, PageMetadataKey>] extends ReadonlyArray<infer Item>
      ? Item
      : never;

/** How far a listing is read: never past `maxPages`, and no further than the items read are `enough`. */
export interface GitHubPaging<Item> {
  readonly maxPages: number;
  readonly enough?: (items: ReadonlyArray<Item>) => boolean;
}

/**
 * What a request names beside its route's own parameters: the headers it
 * adds, such as an `accept` naming one of GitHub's media types
 * (https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api#media-types),
 * as Octokit's `headers` request option takes them.
 */
export interface GitHubRequestOptions {
  readonly headers?: Readonly<Record<string, string>>;
}

/** One identity's requests to GitHub. Answers are typed by Octokit's route table and decoded by the caller. */
export interface GitHubClient {
  readonly request: <R extends keyof Endpoints>(
    route: R,
    parameters?: Endpoints[R]["parameters"] & GitHubRequestOptions,
  ) => Effect.Effect<Endpoints[R]["response"], GitHubFailure>;
  /**
   * Every item of a listing, following GitHub's `link` headers, or as many
   * as are `enough` for the caller. A listing whose `link` still names a next
   * page after `maxPages` did not end, and fails as unreadable rather than
   * answering the part of it read.
   */
  readonly paginate: <R extends keyof PaginatingEndpoints>(
    route: R,
    parameters: PaginatingEndpoints[R]["parameters"] & GitHubRequestOptions,
    options: GitHubPaging<GitHubPageItem<R>>,
  ) => Effect.Effect<ReadonlyArray<GitHubPageItem<R>>, GitHubFailure>;
  /** A GraphQL document's `data`, decoded by `schema`. */
  readonly graphql: <A>(
    document: string,
    variables: Readonly<Record<string, GraphqlVariable>>,
    schema: Schema.Decoder<A>,
  ) => Effect.Effect<A, GitHubFailure>;
}

const HeaderValue = Schema.Union([Schema.String, Schema.Number, Schema.Undefined]);

/**
 * What an Octokit call rejects with, as far as the module reads it: a
 * `RequestError`'s status, message, and answer headers; a GraphQL answer's
 * errors, on Octokit's `GraphqlResponseError` or the throttle's own error for
 * a 200; or the module's own refusal of a held request.
 */
const Rejection = Schema.Struct({
  message: Schema.optional(Schema.String),
  status: Schema.optional(Schema.Number),
  response: Schema.optional(
    Schema.Struct({ headers: Schema.optional(Schema.Record(Schema.String, HeaderValue)) }),
  ),
  errors: Schema.optional(Schema.Array(Schema.Unknown)),
  data: Schema.optional(Schema.Unknown),
  held: Schema.optional(
    Schema.Struct({
      identity: Schema.Literals([
        IDENTITY_KIND.APP,
        IDENTITY_KIND.INSTALLATION,
        IDENTITY_KIND.MEMBER,
      ]),
      until: Schema.Number,
    }),
  ),
});

type Rejection = typeof Rejection.Type;

const decodeRejection = Schema.decodeUnknownOption(Rejection);

/** What a rejection that is no object reads as: nothing GitHub said. */
const UNREAD_REJECTION: Rejection = { message: "GitHub request failed" };

/** A GraphQL error, as far as its type. */
const TypedError = Schema.Struct({ type: Schema.String });

/** An answer's data that names errors, as GraphQL answers do. */
const ErroredData = Schema.Struct({ errors: Schema.Array(Schema.Unknown) });

/** What `conduct` is handed for one identity: run before each send, and after each answer or refusal. */
interface Conduct {
  readonly before: () => Promise<void>;
  readonly answered: (route: RouteOf, headers: AnswerHeaders) => Promise<void>;
  readonly refused: (route: RouteOf, rejection: Rejection) => Promise<void>;
}

declare module "@octokit/core" {
  interface OctokitOptions {
    conduct?: Conduct;
  }
}

/** The per-call `request` options Octokit takes: the fetch to send on, and the signal that aborts it. */
interface CallOptions {
  readonly fetch: ReturnType<typeof githubFetch>;
  readonly signal: AbortSignal;
}

/**
 * The module's own plugin, named before the throttle so its hook runs
 * inside the throttle's queue, after the request's turn came: refuse while
 * held, and read every answer and refusal.
 */
function conduct(octokit: Octokit, options: OctokitOptions): Record<string, never> {
  const handed = options.conduct;

  if (handed === undefined) return {};
  octokit.hook.wrap("request", async (request, endpoint) => {
    await handed.before();
    endpoint.headers["x-github-api-version"] ??= API_VERSION;
    const route = { method: endpoint.method, url: endpoint.url };

    try {
      const response = await request(endpoint);
      await handed.answered(route, response.headers);

      return response;
    } catch (error) {
      await handed.refused(
        route,
        Option.getOrElse(decodeRejection(error), () => UNREAD_REJECTION),
      );
      throw error;
    }
  });

  return {};
}

const GitHubOctokit = Octokit.plugin(paginateRest, conduct, throttling);

type GitHubOctokitInstance = InstanceType<typeof GitHubOctokit>;

/** The status, headers, and message of a rejection GitHub answered, where GitHub answered one. */
function refusalOf(
  rejection: Rejection,
): { status: number; headers: AnswerHeaders; message: string } | undefined {
  if (rejection.status === undefined) return undefined;

  return {
    status: rejection.status,
    headers: rejection.response?.headers ?? {},
    message: rejection.message ?? "",
  };
}

/** The GraphQL error types a rejection carries. */
function graphqlErrorTypes(rejection: Rejection): ReadonlyArray<string> {
  const errors =
    rejection.errors ??
    Option.match(Schema.decodeUnknownOption(ErroredData)(rejection.data), {
      onNone: () => [],
      onSome: (data) => data.errors,
    });

  return errors.flatMap((each) =>
    Option.match(Schema.decodeUnknownOption(TypedError)(each), {
      onNone: () => [],
      onSome: (error) => [error.type],
    }),
  );
}

/** Whether a refusal is GitHub's for a rate limit, as GitHub says it is. */
function rateLimitRefusal(status: number, headers: AnswerHeaders, message: string): boolean {
  if (status === STATUS.TOO_MANY_REQUESTS) return true;

  if (status !== STATUS.FORBIDDEN) return false;

  return (
    headers["retry-after"] !== undefined ||
    String(headers["x-ratelimit-remaining"]) === "0" ||
    RATE_LIMIT_WORDS.test(message)
  );
}

/** Whether the throttle's own handlers read the refusal, and so hold for it. */
function throttleReads(headers: AnswerHeaders, message: string): boolean {
  return SECONDARY_LIMIT_WORDS.test(message) || String(headers["x-ratelimit-remaining"]) === "0";
}

/** The `retry-after` GitHub named, where it named one in seconds. */
function retryAfterOf(headers: AnswerHeaders): Duration.Duration | undefined {
  const seconds = Number(headers["retry-after"]);

  return Number.isInteger(seconds) && seconds >= 0 ? Duration.seconds(seconds) : undefined;
}

/** What an Octokit call's rejection means, as the failure union says it. */
function failureOf(rejection: Rejection, identity: GitHubIdentityKind): GitHubFailure {
  if (rejection.held !== undefined) {
    return new GitHubRateLimited({
      identity: rejection.held.identity,
      resetsAt: new Date(rejection.held.until),
    });
  }

  const types = graphqlErrorTypes(rejection);
  const message = rejection.message ?? UNREAD_REJECTION.message ?? "";

  if (types.includes(GRAPHQL_ERROR.RATE_LIMITED)) {
    return new GitHubRateLimited({ identity, resource: GRAPHQL_RESOURCE });
  }

  if (types.includes(GRAPHQL_ERROR.NOT_FOUND)) return new GitHubNotFound({ message });

  if (types.includes(GRAPHQL_ERROR.FORBIDDEN)) return new GitHubForbidden({ message });

  if (types.length > 0) return new GitHubRejected({ status: 200, message });
  const refusal = refusalOf(rejection);

  if (refusal === undefined) return new GitHubUnavailable({ message });
  const { status, headers } = refusal;

  if (rateLimitRefusal(status, headers, message)) {
    const reset = Number(headers["x-ratelimit-reset"]);
    const resource = headers["x-ratelimit-resource"];
    const exhausted = String(headers["x-ratelimit-remaining"]) === "0" && Number.isFinite(reset);

    return new GitHubRateLimited({
      identity,
      resource: resource === undefined ? undefined : String(resource),
      resetsAt: exhausted ? new Date(reset * 1000) : undefined,
    });
  }

  if (status === STATUS.UNAUTHORIZED) return new GitHubUnauthorized({ message });

  if (status === STATUS.FORBIDDEN) {
    const sso = headers[SSO_HEADER];

    return new GitHubForbidden({ message, ...(sso !== undefined && { sso: String(sso) }) });
  }

  if (status === STATUS.NOT_FOUND) return new GitHubNotFound({ message });

  if (status >= STATUS.FIRST_SERVER_ERROR) return new GitHubUnavailable({ message });

  return new GitHubRejected({ status, message });
}

/** The App's identity, an installation's, and each member's, as this instance knows them. */
interface Identities {
  readonly app: IdentityState;
  readonly installations: Map<number, IdentityState>;
  readonly members: Map<string, IdentityState>;
}

function identityState(identity: GitHubIdentity, secondary?: HoldState): IdentityState {
  const own = holdStateOf(identity);

  return {
    identity,
    own,
    secondary: secondary ?? own,
    reserveUntil: undefined,
    rate: undefined,
    kept: new Map(),
  };
}

function identitiesOf(): Identities {
  const everyInstallation = holdStateOf({ kind: RATE_SCOPE_KIND.EVERY_INSTALLATION });

  return {
    app: identityState({ kind: IDENTITY_KIND.APP }, everyInstallation),
    installations: new Map(),
    members: new Map(),
  };
}

function installationIdentity(identities: Identities, installationId: number): IdentityState {
  const known = identities.installations.get(installationId);

  if (known !== undefined) return known;

  const state = identityState(
    { kind: IDENTITY_KIND.INSTALLATION, installationId },
    identities.app.secondary,
  );

  identities.installations.set(installationId, state);

  return state;
}

function memberIdentity(identities: Identities, digest: string): IdentityState {
  const state =
    identities.members.get(digest) ?? identityState({ kind: IDENTITY_KIND.MEMBER, digest });

  // Note that a member asked again moves to the back, so the least recently asked goes first.
  identities.members.delete(digest);
  identities.members.set(digest, state);

  for (const oldest of identities.members.keys()) {
    if (identities.members.size <= MEMBERS_KEPT) break;
    identities.members.delete(oldest);
  }

  return state;
}

/** What `auth-app` is asked for a grant's token. */
function mintingFor(grant: InstallationGrant): InstallationAuthOptions {
  const minting: InstallationAuthOptions = {
    type: "installation",
    installationId: grant.installationId,
  };

  // Note that the arrays are copied, because auth-app sorts what it is handed in place.
  if (grant.repositoryIds !== undefined) minting.repositoryIds = [...grant.repositoryIds];

  if (grant.repositoryNames !== undefined) minting.repositoryNames = [...grant.repositoryNames];

  if (grant.permissions !== undefined) minting.permissions = { ...grant.permissions };

  return minting;
}

/** A token for the grant from the App's `auth-app`: its cached one while it has time left, else one minted as the App. */
async function minted(app: GitHubOctokitInstance, grant: InstallationGrant, refresh = false) {
  return Schema.decodeUnknownSync(MintedToken)(await app.auth({ ...mintingFor(grant), refresh }));
}

/**
 * The installation auth strategy: each request carries a token for the
 * grant, minted and cached by the App's own `auth-app`, whose mint is sent
 * as the App, through the App's Octokit.
 */
function installationAuth(app: GitHubOctokitInstance, grant: InstallationGrant) {
  const authenticate = () => minted(app, grant);

  const hook = async (request: RequestInterface, endpoint: EndpointOptions) => {
    const { token } = await authenticate();

    return request({
      ...endpoint,
      headers: { ...endpoint.headers, authorization: `token ${token}` },
    });
  };

  return () => Object.assign(authenticate, { hook });
}

const make = Effect.fnUntraced(function* (options: GitHubAppOptions) {
  const client = yield* HttpClient.HttpClient;
  const layerContext = yield* Effect.context<GitHubHoldStore>();
  const run = Effect.runPromiseWith(layerContext);
  const identities = identitiesOf();
  // Note that the group is the instance's, so every identity's queue is one request out at a time.
  const global = new Bottleneck.Group({ maxConcurrent: 1 });

  const warn = (message: string) => {
    void run(Effect.logWarning("github: octokit", { message }));
  };

  const log = { debug: () => {}, info: () => {}, warn, error: warn };

  const conductFor = (state: IdentityState): Conduct => ({
    before: () =>
      run(heldUntil(state)).then((until) => {
        if (until !== undefined) throw new HeldRequest({ identity: state.identity.kind, until });
      }),
    answered: (route, headers) => run(answered(state, route, headers)),
    refused: (route, rejection) => {
      const refusal = refusalOf(rejection);

      if (refusal === undefined) return Promise.resolve();
      recordRate(state, refusal.headers);
      const { status, headers, message } = refusal;

      if (!rateLimitRefusal(status, headers, message) || throttleReads(headers, message)) {
        return Promise.resolve();
      }

      return run(refused(state, state.secondary, retryAfterOf(headers), route));
    },
  });

  const throttleFor = (state: IdentityState): ThrottlingOptions => {
    const throttle: ThrottlingOptions & { global: Bottleneck.Group } = {
      // Note that Bottleneck keys its queues by a string alone, so the identity is written as its JSON.
      id: JSON.stringify(state.identity),
      global,
      onRateLimit: (retryAfter, endpoint) =>
        run(refused(state, state.own, Duration.seconds(retryAfter), endpoint)).then(() => false),
      onSecondaryRateLimit: (retryAfter, endpoint) =>
        run(refused(state, state.secondary, Duration.seconds(retryAfter), endpoint)).then(
          () => false,
        ),
    };

    // Note that a group left out is the plugin's own, so its default spacing stands.
    if (options.throttleGroups?.write !== undefined) throttle.write = options.throttleGroups.write;

    if (options.throttleGroups?.search !== undefined)
      throttle.search = options.throttleGroups.search;

    if (options.throttleGroups?.notifications !== undefined) {
      throttle.notifications = options.throttleGroups.notifications;
    }

    return throttle;
  };

  const octokitFor = (state: IdentityState, auth: Pick<OctokitOptions, "auth" | "authStrategy">) =>
    new GitHubOctokit({
      ...auth,
      userAgent: options.userAgent,
      request: { fetch: githubFetch(client, layerContext, state.kept) },
      log,
      conduct: conductFor(state),
      throttle: throttleFor(state),
    });

  /** One call on Octokit as an Effect: refused at once where the reserve holds background work, sent on the caller's fiber context otherwise. */
  const called = <A>(state: IdentityState, send: (request: CallOptions) => Promise<A>) =>
    Effect.gen(function* () {
      if ((yield* GitHubPriority) === PRIORITY.BACKGROUND) {
        const until = yield* reservedUntil(state);

        if (until !== undefined) {
          return yield* new GitHubRateLimited({
            identity: state.identity.kind,
            resource: CORE_RESOURCE,
            resetsAt: new Date(until),
          });
        }
      }

      const context = yield* Effect.context<never>();

      return yield* Effect.tryPromise({
        try: (signal) => send({ fetch: githubFetch(client, context, state.kept), signal }),
        catch: (error) =>
          failureOf(
            Option.getOrElse(decodeRejection(error), () => UNREAD_REJECTION),
            state.identity.kind,
          ),
      });
    });

  const clientFor = (state: IdentityState, octokit: GitHubOctokitInstance): GitHubClient => ({
    request: <R extends keyof Endpoints>(
      route: R,
      parameters?: Endpoints[R]["parameters"] & GitHubRequestOptions,
    ) =>
      called(state, (request) => {
        // SAFETY: Octokit's `request` answers `Endpoints[R]["response"]` for a route of its table, with that route's parameters; its conditional overload cannot see that through the generic `R`.
        const send = octokit.request as (
          route: R,
          parameters: Endpoints[R]["parameters"] &
            GitHubRequestOptions & { readonly request: CallOptions },
        ) => Promise<Endpoints[R]["response"]>;

        return send(route, { ...parameters, request });
      }),
    paginate: (route, parameters, { maxPages, enough }) =>
      Effect.flatMap(
        called(state, async (request) => {
          const items: Array<GitHubPageItem<typeof route>> = [];
          let pages = 0;

          for await (const page of octokit.paginate.iterator(route, { ...parameters, request })) {
            // SAFETY: the paginator answers every page's data as the listing's one array of items, a wrapped page's included.
            items.push(...(page.data as ReadonlyArray<GitHubPageItem<typeof route>>));
            pages += 1;

            if (enough?.(items) === true) return { items, ended: true };

            if (pages >= maxPages) {
              return { items, ended: !NEXT_PAGE.test(String(page.headers.link ?? "")) };
            }
          }

          return { items, ended: true };
        }),
        ({ items, ended }) =>
          ended
            ? Effect.succeed(items)
            : Effect.fail(
                new GitHubUnreadable({ message: `the listing ran past ${maxPages} pages` }),
              ),
      ),
    graphql: (document, variables, schema) =>
      Effect.flatMap(
        called(state, (request) => octokit.graphql<unknown>(document, { ...variables, request })),
        (data) =>
          Effect.mapError(
            Schema.decodeUnknownEffect(schema)(data),
            (error) => new GitHubUnreadable({ message: error.message }),
          ),
      ),
  });

  const appOctokit = octokitFor(identities.app, {
    authStrategy: createAppAuth,
    auth: { appId: options.appId, privateKey: Redacted.value(options.privateKey) },
  });

  return GitHub.of({
    asApp: clientFor(identities.app, appOctokit),
    asInstallation: (grant) => {
      const state = installationIdentity(identities, grant.installationId);

      return clientFor(
        state,
        octokitFor(state, { authStrategy: installationAuth(appOctokit, grant) }),
      );
    },
    installationToken: (grant, { minimumLifetime } = {}) =>
      Effect.gen(function* () {
        const cached = yield* called(identities.app, () => minted(appOctokit, grant));
        const now = yield* Clock.currentTimeMillis;
        const least = minimumLifetime === undefined ? 0 : Duration.toMillis(minimumLifetime);

        // Note that a token with too little time left is minted afresh, which replaces it in the cache `asInstallation` signs from.
        const token =
          Date.parse(cached.expiresAt) - now >= least
            ? cached
            : yield* called(identities.app, () => minted(appOctokit, grant, true));

        return { token: Redacted.make(token.token), expiresAt: new Date(token.expiresAt) };
      }),
    asMember: (token) => {
      const digest = createHash("sha256").update(Redacted.value(token)).digest("hex");
      const state = memberIdentity(identities, digest);

      return clientFor(state, octokitFor(state, { auth: Redacted.value(token) }));
    },
  });
});

/** Every request the deployment sends GitHub's API, as the App, an installation, or a member. */
export class GitHub extends Context.Service<
  GitHub,
  {
    /** As the App itself, by its JWT: the App's installations and their token mints. */
    readonly asApp: GitHubClient;
    /** As one installation, by a token for the grant. */
    readonly asInstallation: (grant: InstallationGrant) => GitHubClient;
    /** As a member, by the token the caller hands in. */
    readonly asMember: (token: Redacted.Redacted<string>) => GitHubClient;
    /**
     * A token for the grant to hand outside the module: the one `asInstallation`
     * signs with, reused while it has time left, else minted as the App under
     * the App's hold and throttle; one with less than `minimumLifetime` left
     * is minted afresh.
     */
    readonly installationToken: (
      grant: InstallationGrant,
      options?: { readonly minimumLifetime?: Duration.Duration },
    ) => Effect.Effect<InstallationToken, GitHubFailure>;
  }
>()("@repo/github/GitHub") {
  /** The service for one App, built once per instance over the instance's `HttpClient` and the shared holds. */
  static readonly layer = (
    options: GitHubAppOptions,
  ): Layer.Layer<GitHub, never, HttpClient.HttpClient | GitHubHoldStore> =>
    Layer.effect(GitHub, make(options));
}
