/**
 * sign-in-revocation.ts -- an account's sign-in grants revoked at the providers that issued them, once its deletion has erased them here.
 *
 * Better Auth's `deleteUser` deletes the account's `account` rows, so their
 * tokens leave our database, but the providers that issued them are never
 * told: a GitHub sign-in is an authorization of our GitHub App, whose user
 * token reaches repositories and pull requests for about eight hours, and
 * whose refresh token mints new ones for about six months. So an account's deletion reads each sign-in's token before
 * the delete (`grantsOf`) and revokes it at its provider after (`revoke`), as
 * it revokes an integration's grant at Vercel Connect
 * (`accounts/account-deletion.ts`).
 *
 * GitHub's is the App's own user token, read as every caller that acts as
 * the developer reads it (`GitHubApp.userToken`), refreshed where it is about
 * to expire, since GitHub takes only a live token as the grant's name, and the
 * whole grant it names is revoked under the App's client credentials
 * (`GitHubApp.revokeUserGrant`), which takes the refresh token with it; a
 * token revoked alone would leave the refresh token standing. Google's is
 * the access token, opened under the session secret Better Auth sealed it
 * under and revoked while it is unexpired, since an expired one reaches
 * nothing: our Google sign-in asks for no offline access, so Google issues no
 * refresh token to keep. Google is asked at its revocation endpoint
 * (https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke).
 * A provider is one row of each table below, so Sign in with Apple's revoke
 * (https://developer.apple.com/documentation/sign_in_with_apple/revoke_tokens)
 * joins as one more.
 *
 * Revoking is best effort and never holds the deletion up: each provider is
 * given `PROVIDER_DEADLINE` to read and again to revoke, and one that fails,
 * runs past it, or dies is logged and left. A token leaves only as a
 * `Redacted`, and a failure carries the provider's status or the kind of
 * failure, never the request that carried the token.
 */

import { Database, type DatabaseServices } from "@repo/database/core/query";
import { InstantColumnSchema } from "@repo/database/models/columns";
import { account } from "@repo/database/schemas/auth";
import { symmetricDecrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import {
  Clock,
  Config,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { SqlSchema } from "effect/sql";
import { text } from "../core.js";
import { GITHUB_PROVIDER_ID, GitHubApp, type GitHubAppService } from "../github/github-app.js";
import { AUTH_SECRET_ENVIRONMENT } from "./auth-deployment.js";

/** The sign-in providers whose grants a deletion revokes, by the provider id Better Auth writes on their rows. */
const SIGN_IN_PROVIDER = { GOOGLE: "google", GITHUB: GITHUB_PROVIDER_ID } as const;

type SignInProvider = (typeof SIGN_IN_PROVIDER)[keyof typeof SIGN_IN_PROVIDER];

/** Each provider as a log line names it. */
const SIGN_IN_PROVIDER_NAME = {
  [SIGN_IN_PROVIDER.GOOGLE]: "Google",
  [SIGN_IN_PROVIDER.GITHUB]: "GitHub",
} as const satisfies Record<SignInProvider, string>;

/** How long one provider is given to answer one read or one revoke, so a provider that hangs never holds a deletion's request open. */
const PROVIDER_DEADLINE = Duration.seconds(5);

/** Google's OAuth 2.0 revocation endpoint, which takes the token in a form. */
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";

/** The one status Google answers a revoked token with. */
const GOOGLE_REVOKED_STATUS = 200;

/** The tag of the GitHub failure that means the account holds no GitHub token to revoke, or none that will open. */
const GITHUB_SIGN_IN_REQUIRED_TAG = "GitHubSignInRequired";

/** One sign-in's token, opened, and the provider that issued it. */
export interface SignInGrant {
  readonly provider: SignInProvider;
  readonly token: Redacted.Redacted;
}

/** Why a provider did not revoke a token: the status it answered, or that it was never reached. */
class SignInRevokeRefused extends Data.TaggedError("SignInRevokeRefused")<{
  readonly status: number | undefined;
}> {
  override get message(): string {
    return this.status === undefined
      ? "The provider could not be reached"
      : `The provider answered ${this.status}`;
  }
}

const GoogleRowSchema = Schema.Struct({
  accessToken: Schema.NullOr(Schema.String),
  refreshToken: Schema.NullOr(Schema.String),
  accessTokenExpiresAt: Schema.NullOr(InstantColumnSchema),
});

type GoogleRow = typeof GoogleRowSchema.Type;

/** The account's Google rows, their tokens still sealed. */
const readGoogleRows = SqlSchema.findAll({
  Request: Schema.String,
  Result: GoogleRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select({
          accessToken: account.accessToken,
          refreshToken: account.refreshToken,
          accessTokenExpiresAt: account.accessTokenExpiresAt,
        })
        .from(account)
        .where(and(eq(account.userId, userId), eq(account.providerId, SIGN_IN_PROVIDER.GOOGLE))),
    ),
});

/** The sealed token a Google row is revoked by: its access token while unexpired, or a refresh token, which our sign-in never asks for but would revoke the grant were one kept. */
function sealedGoogleToken(row: GoogleRow, now: number): string | undefined {
  if (row.refreshToken !== null) return row.refreshToken;

  if (row.accessToken === null) return undefined;

  if (row.accessTokenExpiresAt !== null && row.accessTokenExpiresAt.getTime() <= now) {
    return undefined;
  }

  return row.accessToken;
}

/** A token Better Auth sealed, opened under the session secret; none where it will not open. */
function unsealed(
  sealed: string,
  secret: Redacted.Redacted,
): Effect.Effect<Option.Option<Redacted.Redacted>> {
  return Effect.tryPromise(() =>
    symmetricDecrypt({ key: Redacted.value(secret), data: sealed }),
  ).pipe(
    Effect.map((token) => Option.some(Redacted.make(token))),
    Effect.orElseSucceed(() => Option.none()),
  );
}

/** The token posted to Google's revocation endpoint; a request that never got an answer carries no status, since its cause may quote the form. */
const revokeAtGoogle = /* @__PURE__ */ Effect.fnUntraced(function* (token: Redacted.Redacted) {
  const client = yield* HttpClient.HttpClient;

  // The token is revealed here alone, into the one form Google reads it from.
  const request = HttpClientRequest.post(GOOGLE_REVOKE_ENDPOINT).pipe(
    HttpClientRequest.bodyUrlParams({ token: Redacted.value(token) }),
  );

  const status = yield* client.execute(request).pipe(
    Effect.map((response) => response.status),
    Effect.scoped,
    Effect.mapError(() => new SignInRevokeRefused({ status: undefined })),
  );

  if (status !== GOOGLE_REVOKED_STATUS) return yield* new SignInRevokeRefused({ status });
});

/** What a defect is logged as: its kind alone, since a thrown value's words or fields may quote whatever it was handed. */
function defectKind(defect: unknown): string {
  return typeof defect === "object" && defect !== null ? defect.constructor.name : typeof defect;
}

/**
 * The provider's step, under the deadline, a failure, an overrun, or a
 * defect logged and answered as the fallback. Note that we catch defects
 * too, because this runs inside an account's deletion: before the delete a
 * defect would refuse it, and after it a defect would answer a delete that
 * happened as one that failed. A failure is logged by its words, which carry
 * a status or a kind and never a token; a defect by its kind alone.
 */
function bestEffort<A, E extends { readonly message: string }, R>(
  provider: SignInProvider,
  step: Effect.Effect<A, E, R>,
  fallback: A,
): Effect.Effect<A, never, R> {
  const warning = `${SIGN_IN_PROVIDER_NAME[provider]} could not revoke a deleted account's sign-in`;

  return step.pipe(
    Effect.timeout(PROVIDER_DEADLINE),
    Effect.catch((failure) => Effect.as(Effect.logWarning(warning, failure.message), fallback)),
    Effect.catchDefect((defect) =>
      Effect.as(Effect.logWarning(warning, defectKind(defect)), fallback),
    ),
  );
}

export interface SignInRevocationService {
  /**
   * The account's sign-in grants as its rows hold them now, each token opened:
   * what its deletion revokes once the rows are gone. A provider whose token
   * cannot be read is logged and left out, and a row that holds none is
   * left out silently; nothing here fails.
   */
  readonly grantsOf: (
    userId: string,
  ) => Effect.Effect<readonly SignInGrant[], never, HttpClient.HttpClient | DatabaseServices>;
  /** Each grant revoked at its provider at once, each under its own deadline; a revoke that fails is logged by its words. */
  readonly revoke: (
    grants: readonly SignInGrant[],
  ) => Effect.Effect<void, never, HttpClient.HttpClient>;
}

function signInRevocation(
  sessionSecret: Redacted.Redacted | undefined,
  github: GitHubAppService,
): SignInRevocationService {
  const githubGrants = (userId: string) =>
    github.userToken(userId).pipe(
      Effect.map((token): readonly SignInGrant[] => [{ provider: SIGN_IN_PROVIDER.GITHUB, token }]),
      // An account with no GitHub token, or none that opens, has nothing at GitHub to revoke.
      Effect.catchTag(GITHUB_SIGN_IN_REQUIRED_TAG, () => Effect.succeed([])),
    );

  const googleGrants = (userId: string) =>
    Effect.gen(function* () {
      if (sessionSecret === undefined) return [];
      const now = yield* Clock.currentTimeMillis;
      const rows = yield* readGoogleRows(userId);
      const grants: SignInGrant[] = [];

      for (const row of rows) {
        const sealed = sealedGoogleToken(row, now);

        if (sealed === undefined) continue;
        const token = yield* unsealed(sealed, sessionSecret);

        if (Option.isSome(token))
          grants.push({ provider: SIGN_IN_PROVIDER.GOOGLE, token: token.value });
      }

      return grants;
    });

  const revokers: Record<
    SignInProvider,
    (
      token: Redacted.Redacted,
    ) => Effect.Effect<void, { readonly message: string }, HttpClient.HttpClient>
  > = {
    [SIGN_IN_PROVIDER.GOOGLE]: revokeAtGoogle,
    [SIGN_IN_PROVIDER.GITHUB]: github.revokeUserGrant,
  };

  return {
    grantsOf: (userId) =>
      Effect.map(
        Effect.all(
          [
            bestEffort(SIGN_IN_PROVIDER.GITHUB, githubGrants(userId), []),
            bestEffort(SIGN_IN_PROVIDER.GOOGLE, googleGrants(userId), []),
          ],
          { concurrency: "unbounded" },
        ),
        (byProvider) => byProvider.flat(),
      ),
    revoke: (grants) =>
      Effect.forEach(
        grants,
        (grant) => bestEffort(grant.provider, revokers[grant.provider](grant.token), undefined),
        { concurrency: "unbounded", discard: true },
      ),
  };
}

export class SignInRevocation extends Context.Service<SignInRevocation, SignInRevocationService>()(
  "SignInRevocation",
) {
  /** The service over the session secret Better Auth sealed the rows' tokens under, or none, which opens no Google token. */
  static layer(
    sessionSecret: Redacted.Redacted | undefined,
  ): Layer.Layer<SignInRevocation, never, GitHubApp> {
    return Layer.effect(
      SignInRevocation,
      Effect.map(Effect.service(GitHubApp), (github) => signInRevocation(sessionSecret, github)),
    );
  }
}

/** The service as this deployment's environment configures it, read as the services are built; a missing session secret opens no Google token. */
export const signInRevocationFromEnvironment: Layer.Layer<
  SignInRevocation,
  Config.ConfigError,
  GitHubApp
> = Layer.unwrap(
  Effect.map(Config.option(Config.Redacted(AUTH_SECRET_ENVIRONMENT.SESSION_SECRET)), (read) => {
    const named = text(Option.getOrUndefined(Option.map(read, Redacted.value)));

    return SignInRevocation.layer(named === undefined ? undefined : Redacted.make(named));
  }),
);
