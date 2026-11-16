/**
 * github-member.ts -- a member's own saved GitHub token: which credential reaches a repository, and every read made on that token.
 *
 * The App's installation always reaches a repository first; a member's own
 * classic personal access token (`ghp_`) reaches it only where no
 * installation does, and only where GitHub answers the token with push to
 * it. A member who keeps no token gets the installation's why, since they
 * never chose one. A 401 is GitHub refusing the token, which marks it
 * invalid; a 403 naming the page that authorizes it for an organization's
 * SAML SSO answers with that page; any other 403, or a 404, is a repository
 * the token does not reach
 * (https://docs.github.com/en/rest/repos/repos#get-a-repository).
 *
 * The token itself is kept by the service, sealed, behind
 * `GitHubMemberTokens`, read afresh at every use so a token saved, replaced,
 * or removed in Settings is the one the next use takes. Every read on it is
 * sent as the member's identity (`GitHub.asMember`), under that identity's
 * throttle and holds.
 */

import { Context, Effect, Option, Predicate, Redacted, Result, Schema } from "effect";
import { GitHub } from "./github.js";
import { type GitHubFailure, GitHubUnreadable } from "./github-failure.js";

/**
 * The prefixes GitHub documents for a personal access token, classic and
 * fine-grained: https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github#githubs-token-formats
 */
const TOKEN_PREFIX = { CLASSIC: "ghp_", FINE_GRAINED: "github_pat_" } as const;

/** The scope a token is not kept without. */
const REQUIRED_SCOPE = "repo";

/**
 * The headers GitHub answers a classic token's read with: the scopes it
 * grants, comma-separated
 * (https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps),
 * and its expiry, sent only for a token that has one
 * (https://github.blog/changelog/2021-07-26-expiration-options-for-personal-access-tokens/).
 */
const TOKEN_HEADER = {
  SCOPES: "x-oauth-scopes",
  EXPIRATION: "github-authentication-token-expiration",
} as const;

/**
 * Where GitHub's SAML SSO authorization may live: a page of GitHub's own
 * site, with the query GitHub gives it; the same pattern the wire checks
 * the reason against (`@repo/features/repository-reach-wire`).
 */
const SSO_URL_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9/_.-]+(?:\?[A-Za-z0-9_.~=&%+-]*)?$/u;

/**
 * The one page of the member's own repositories a picker lists, as GitHub's
 * `GET /user/repos` takes it
 * (https://docs.github.com/en/rest/repos/repos#list-repositories-for-the-authenticated-user):
 * the ones they own, collaborate on, and reach as an organization's member,
 * most recently updated first.
 */
const MEMBER_REPOSITORIES_QUERY = {
  affiliation: "owner,collaborator,organization_member",
  sort: "updated",
  per_page: 100,
} as const;

/** A repository as a member's token reads it, and whether the token may push to it, absent where GitHub says nothing of it. */
const MemberRepositorySchema = Schema.Struct({
  /** GitHub's id for the repository, which a rename or a transfer keeps. */
  id: Schema.Number,
  name: Schema.String,
  full_name: Schema.String,
  owner: Schema.Struct({ login: Schema.String }),
  private: Schema.Boolean,
  default_branch: Schema.String,
  updated_at: Schema.NullOr(Schema.DateFromString),
  permissions: Schema.optional(Schema.Struct({ push: Schema.Boolean })),
});

/** A repository as a member's token reads it. */
export type MemberRepositoryRecord = typeof MemberRepositorySchema.Type;

const UserSchema = Schema.Struct({ id: Schema.Number, login: Schema.String });

/** Why a member has no token to use. */
export const MEMBER_TOKEN_ABSENCE = {
  /** The member keeps no token. */
  NONE: "none",
  /** GitHub refused the token at a use since its save. */
  INVALID: "invalid",
  /** The deployment cannot open the token. */
  UNREADABLE: "unreadable",
} as const;

export type MemberTokenAbsence = (typeof MEMBER_TOKEN_ABSENCE)[keyof typeof MEMBER_TOKEN_ABSENCE];

/** The store behind `GitHubMemberTokens` could not be read or written. */
export class GitHubMemberTokensUnavailable extends Schema.TaggedError<GitHubMemberTokensUnavailable>()(
  "GitHubMemberTokensUnavailable",
  { cause: Schema.Unknown },
) {
  override get message(): string {
    return "a member's GitHub token could not be read";
  }
}

/** A member's token GitHub has not refused, opened, with whose it is and how to mark it refused. */
export interface GitHubMemberToken {
  readonly token: Redacted.Redacted<string>;
  readonly githubUserId: string;
  readonly githubLogin: string;
  /** Marks this token invalid, after GitHub answered a use of it 401; a token the member replaced meanwhile is left as it stands. */
  readonly markInvalid: Effect.Effect<void, GitHubMemberTokensUnavailable>;
}

/** The members' saved tokens, kept sealed by the service: one member's token to use, or why there is none. */
export class GitHubMemberTokens extends Context.Service<
  GitHubMemberTokens,
  {
    readonly token: (
      member: string,
    ) => Effect.Effect<
      Result.Result<GitHubMemberToken, MemberTokenAbsence>,
      GitHubMemberTokensUnavailable
    >;
  }
>()("@repo/github/GitHubMemberTokens") {}

/** Why a member's own token does not reach a repository; the values the wire's reasons spell. */
export const MEMBER_TOKEN_UNREACHED = {
  /** The member's token cannot be opened, so there is none to use. */
  NO_TOKEN: "no-token",
  /** GitHub refused the member's token. */
  TOKEN_INVALID: "token-invalid",
  /** The member's token does not reach the repository. */
  TOKEN_NO_ACCESS: "token-no-access",
  /** The member's token reaches the repository but may not push to it. */
  TOKEN_CANNOT_PUSH: "token-cannot-push",
  /** The repository's organization enforces SAML SSO and the token is not authorized for it. */
  TOKEN_SSO: "token-sso",
} as const;

/** Why a member's own token does not reach a repository, with what its remedy needs; the repository GitHub answered where it read one. */
export type MemberTokenUnreached =
  | {
      readonly reason:
        | typeof MEMBER_TOKEN_UNREACHED.NO_TOKEN
        | typeof MEMBER_TOKEN_UNREACHED.TOKEN_INVALID
        | typeof MEMBER_TOKEN_UNREACHED.TOKEN_NO_ACCESS;
    }
  | {
      readonly reason: typeof MEMBER_TOKEN_UNREACHED.TOKEN_CANNOT_PUSH;
      readonly record: MemberRepositoryRecord;
    }
  | { readonly reason: typeof MEMBER_TOKEN_UNREACHED.TOKEN_SSO; readonly authorizeUrl: string };

/** Which credential answered a reach. */
export const REACHED_BY = {
  /** The installation's own answer stands: it reached the repository, or no member token was tried. */
  INSTALLATION: "installation",
  /** No installation reached it, and the member's token was tried. */
  MEMBER_TOKEN: "member-token",
} as const;

/** A repository reached, or why not, and which credential's answer it is. */
export type GitHubReach<A, U> =
  | { readonly by: typeof REACHED_BY.INSTALLATION; readonly answer: Result.Result<A, U> }
  | {
      readonly by: typeof REACHED_BY.MEMBER_TOKEN;
      readonly member: string;
      readonly answer: Result.Result<MemberRepositoryRecord, MemberTokenUnreached>;
    };

/** Why a token offered for saving is refused; the values the wire's rejections spell. */
export const MEMBER_TOKEN_REFUSAL = {
  /** A fine-grained token (`github_pat_…`), which is not taken; nothing was sent to GitHub. */
  FINE_GRAINED: "fine_grained",
  /** GitHub refused the token. */
  INVALID: "invalid",
  /** GitHub accepted the token, but it lacks the `repo` scope. */
  NO_REPO_SCOPE: "no_repo_scope",
  /** GitHub could not be asked, or did not answer. */
  UNREACHABLE: "unreachable",
} as const;

export type MemberTokenRefusal = (typeof MEMBER_TOKEN_REFUSAL)[keyof typeof MEMBER_TOKEN_REFUSAL];

/** What GitHub said of a token offered for saving that it accepted. */
export interface CheckedMemberToken {
  readonly githubUserId: string;
  readonly githubLogin: string;
  readonly expiresAt: Date | null;
}

/** The repository's `owner` and `repo`, as a route names them. */
function repositoryParts(fullName: string) {
  const [owner = "", repo = ""] = fullName.split("/");

  return { owner, repo };
}

/**
 * The page that authorizes a classic token for an organization's SAML SSO,
 * which GitHub names in the `X-GitHub-SSO` header of a 403
 * (https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api#personal-access-tokens-and-saml-sso),
 * as `required; url=<page>`; none where the header names none on GitHub's
 * own site, as its `partial-results` form does.
 */
function ssoAuthorizeUrl(header: string | undefined): string | undefined {
  const url = header
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("url="))
    ?.slice("url=".length);

  return url !== undefined && SSO_URL_PATTERN.test(url) ? url : undefined;
}

/** GitHub's expiry header as an instant, as `2021-03-31 21:46:14 UTC`, or null where it sent none or one that spells no instant. */
function expiryOf(header: string | undefined): Date | null {
  const parsed = header === undefined ? Number.NaN : Date.parse(header);

  return Number.isNaN(parsed) ? null : new Date(parsed);
}

/** One request's answer, its body read under its schema. */
function readAnswer<A>(
  request: Effect.Effect<{ readonly data: unknown }, GitHubFailure>,
  schema: Schema.Decoder<A>,
): Effect.Effect<A, GitHubFailure> {
  return Effect.flatMap(request, (answer) =>
    Effect.mapError(
      Schema.decodeUnknownEffect(schema)(answer.data),
      (error) => new GitHubUnreadable({ message: error.message }),
    ),
  );
}

/** A member token's answer for a repository, or none where the member keeps no token to try. */
type TokenAnswer = Option.Option<Result.Result<MemberRepositoryRecord, MemberTokenUnreached>>;

/** The member's token, where they keep one GitHub has not refused, with the module's client for it. */
const heldToken = (member: string) =>
  Effect.gen(function* () {
    const tokens = yield* GitHubMemberTokens;
    const github = yield* GitHub;
    const held = yield* tokens.token(member);

    return Result.map(held, (token) => ({ ...token, client: github.asMember(token.token) }));
  });

/**
 * The repository as the member's own token reads it, or why not: no token
 * the deployment can open, one GitHub refused before or refuses now (which
 * marks it invalid), no access, an SSO authorization still owed, or no push.
 */
const reachOnToken = (member: string, fullName: string) =>
  Effect.gen(function* () {
    const untried: TokenAnswer = Option.none();

    const unreached = (reason: MemberTokenUnreached): TokenAnswer =>
      Option.some(Result.fail(reason));

    const held = yield* heldToken(member);

    if (Result.isFailure(held)) {
      if (held.failure === MEMBER_TOKEN_ABSENCE.NONE) return untried;

      return unreached({
        reason:
          held.failure === MEMBER_TOKEN_ABSENCE.INVALID
            ? MEMBER_TOKEN_UNREACHED.TOKEN_INVALID
            : MEMBER_TOKEN_UNREACHED.NO_TOKEN,
      });
    }

    const read = yield* Effect.result(
      readAnswer(
        held.success.client.request("GET /repos/{owner}/{repo}", repositoryParts(fullName)),
        MemberRepositorySchema,
      ),
    );

    if (Result.isFailure(read)) {
      const refused = read.failure;

      if (Predicate.isTagged(refused, "GitHubUnauthorized")) {
        yield* held.success.markInvalid;

        return unreached({ reason: MEMBER_TOKEN_UNREACHED.TOKEN_INVALID });
      }

      const authorizeUrl = Predicate.isTagged(refused, "GitHubForbidden")
        ? ssoAuthorizeUrl(refused.sso)
        : undefined;

      if (authorizeUrl !== undefined) {
        return unreached({ reason: MEMBER_TOKEN_UNREACHED.TOKEN_SSO, authorizeUrl });
      }

      if (
        Predicate.isTagged(refused, "GitHubNotFound") ||
        Predicate.isTagged(refused, "GitHubForbidden")
      ) {
        return unreached({ reason: MEMBER_TOKEN_UNREACHED.TOKEN_NO_ACCESS });
      }

      return yield* Effect.fail(refused);
    }

    const record = read.success;

    if (record.permissions?.push !== true) {
      return unreached({ reason: MEMBER_TOKEN_UNREACHED.TOKEN_CANNOT_PUSH, record });
    }

    const reached: TokenAnswer = Option.some(Result.succeed(record));

    return reached;
  });

/**
 * The repository as the installation reaches it, which always wins; else,
 * for a member who keeps a token, as that token reaches it, the token's why
 * standing in the installation's. `throughInstallation` is the caller's
 * reach on the installations it tries, answered as it stands where it
 * reached the repository, where no member asked, or where the member keeps
 * no token.
 */
export const reachRepository = <A, U, E, R>(
  fullName: string,
  member: string | undefined,
  throughInstallation: Effect.Effect<Result.Result<A, U>, E, R>,
): Effect.Effect<
  GitHubReach<A, U>,
  E | GitHubFailure | GitHubMemberTokensUnavailable,
  R | GitHub | GitHubMemberTokens
> =>
  Effect.gen(function* () {
    const answer = yield* throughInstallation;

    const stands: GitHubReach<A, U> = { by: REACHED_BY.INSTALLATION, answer };

    if (Result.isSuccess(answer) || member === undefined) return stands;
    const onToken = yield* reachOnToken(member, fullName);

    if (Option.isNone(onToken)) return stands;

    const reached: GitHubReach<A, U> = {
      by: REACHED_BY.MEMBER_TOKEN,
      member,
      answer: onToken.value,
    };

    return reached;
  });

/**
 * The repositories the member's own token may push to, as GitHub lists them
 * for the token's user (`GET /user/repos`), most recently updated first, one
 * page; none where the member keeps no token GitHub accepts, a 401 marking
 * it invalid.
 */
export const memberRepositories = (member: string) =>
  Effect.gen(function* () {
    const held = yield* heldToken(member);

    if (Result.isFailure(held)) return Option.none<ReadonlyArray<MemberRepositoryRecord>>();

    return yield* readAnswer(
      held.success.client.request("GET /user/repos", MEMBER_REPOSITORIES_QUERY),
      Schema.Array(MemberRepositorySchema),
    ).pipe(
      Effect.map((all) => Option.some(all.filter((one) => one.permissions?.push === true))),
      Effect.catchTag("GitHubUnauthorized", () =>
        Effect.as(held.success.markInvalid, Option.none<ReadonlyArray<MemberRepositoryRecord>>()),
      ),
    );
  });

/**
 * Whether the member's own token reads the repository, as GitHub answers
 * `GET /repos/{owner}/{repo}` on it: a 2xx reads it, and a 403 or 404 does
 * not. None where the member keeps no token GitHub accepts, where GitHub
 * refuses it now (401), which marks it invalid, and where GitHub answered
 * anything else, which says neither.
 */
export const memberRepositoryReadable = (member: string, fullName: string) =>
  Effect.gen(function* () {
    const held = yield* heldToken(member);

    if (Result.isFailure(held)) return Option.none<boolean>();

    return yield* held.success.client
      .request("GET /repos/{owner}/{repo}", repositoryParts(fullName))
      .pipe(
        Effect.as(Option.some(true)),
        Effect.catchTags({
          GitHubUnauthorized: () => Effect.as(held.success.markInvalid, Option.none<boolean>()),
          GitHubForbidden: () => Effect.succeed(Option.some(false)),
          GitHubNotFound: () => Effect.succeed(Option.some(false)),
        }),
        Effect.orElseSucceed(() => Option.none<boolean>()),
      );
  });

/** The member's own token, read afresh, with the module's client for it; none where they keep no token GitHub accepts. */
export const memberToken = (member: string) =>
  Effect.map(heldToken(member), (held) => Result.getSuccess(held));

/** Why a token offered for saving is refused by its form alone, before anything is sent: a fine-grained token, which is not taken. */
export function formatRefusal(token: Redacted.Redacted<string>): MemberTokenRefusal | undefined {
  return Redacted.value(token).startsWith(TOKEN_PREFIX.FINE_GRAINED)
    ? MEMBER_TOKEN_REFUSAL.FINE_GRAINED
    : undefined;
}

/**
 * Asks GitHub whose a token offered for saving is, with one
 * `GET /user` on it (https://docs.github.com/en/rest/users/users#get-the-authenticated-user):
 * what it said of a token it accepted, or why the token is not kept. A
 * fine-grained token is refused before it is sent anywhere, and one without
 * the `repo` scope after. Never fails, since every outcome is an answer; the
 * caller bounds how long GitHub is given.
 */
export const checkMemberToken = (token: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const unkept = formatRefusal(token);

    if (unkept !== undefined) return Result.fail<MemberTokenRefusal>(unkept);

    const github = yield* GitHub;
    const answered = yield* Effect.result(github.asMember(token).request("GET /user"));

    if (Result.isFailure(answered)) {
      return Result.fail<MemberTokenRefusal>(
        Predicate.isTagged(answered.failure, "GitHubUnauthorized")
          ? MEMBER_TOKEN_REFUSAL.INVALID
          : MEMBER_TOKEN_REFUSAL.UNREACHABLE,
      );
    }

    const { headers } = answered.success;
    const user = Schema.decodeUnknownOption(UserSchema)(answered.success.data);

    if (Option.isNone(user))
      return Result.fail<MemberTokenRefusal>(MEMBER_TOKEN_REFUSAL.UNREACHABLE);

    const scopes = String(headers[TOKEN_HEADER.SCOPES] ?? "")
      .split(",")
      .map((scope) => scope.trim());

    if (!scopes.includes(REQUIRED_SCOPE)) {
      return Result.fail<MemberTokenRefusal>(MEMBER_TOKEN_REFUSAL.NO_REPO_SCOPE);
    }

    const expiration = headers[TOKEN_HEADER.EXPIRATION];

    return Result.succeed<CheckedMemberToken>({
      githubUserId: String(user.value.id),
      githubLogin: user.value.login,
      expiresAt: expiryOf(expiration === undefined ? undefined : String(expiration)),
    });
  });

/** The prefix a classic token carries, for the hint a member is shown of one. */
export const CLASSIC_TOKEN_PREFIX = TOKEN_PREFIX.CLASSIC;
