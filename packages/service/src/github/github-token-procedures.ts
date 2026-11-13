/**
 * github-token-procedures.ts -- the member's own classic GitHub personal access token: read what it is, save one, remove it.
 *
 * `GET /api/github/token` answers the member's token as its login, hint,
 * status, and expiry; `PUT` saves one, first asking GitHub whose it is with
 * one `GET /user` on it, and keeps it sealed
 * (`@repo/database/models/provider-key-seal`) only where GitHub accepts it
 * and it carries the `repo` scope, with the GitHub user GitHub named it as;
 * `DELETE` removes it. The token stands on its own: it need not match a
 * GitHub account linked to the member's, since holding it is what grants
 * what it reaches. A fine-grained token is refused before it
 * is sent anywhere. Every answer is the token as it then stands and none
 * carries it: the one body that holds a token is the `PUT`'s own, it is
 * sealed the moment it is checked, and neither it nor what GitHub said of it
 * is logged. A save whose body its schema refuses is answered as the bare
 * `invalid-request` slug (`orpc/errors.ts`), so what the schema said of the
 * token never leaves the function.
 *
 * A deployment holding no ring, or one it cannot parse, answers every
 * request unavailable. The caller and then the ring are checked on the
 * resource's implementer, so they run before oRPC decodes the save's body
 * against its schema. A save is braked per member, ten an hour, as the
 * provider keys' is, so the endpoint is no oracle for tokens that are not
 * the caller's.
 */

import {
  type GitHubTokenRow,
  readGitHubTokenRow,
  removeGitHubToken,
  saveGitHubToken,
} from "@repo/database/models/github-token-store";
import {
  type KeyRing,
  openGitHubToken,
  sealGitHubToken,
} from "@repo/database/models/provider-key-seal";
import {
  GITHUB_TOKEN_REJECTION,
  GITHUB_TOKEN_STATUS,
  type GitHubTokenAnswer,
  type GitHubTokenRejection,
  type GitHubTokenSummary,
} from "@repo/features/github-token-wire";
import { CLASSIC_TOKEN_PREFIX, formatRefusal } from "@repo/github";
import { DateTime, Duration, Effect, Redacted, Result } from "effect";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import { hostedStoreOrUnavailable, type UserIdResolver } from "../http/http-effect.js";
import { createRateBrake } from "../http/rate-brake.js";
import { accountMiddleware, hosted, keyRingMiddleware } from "../orpc/base.js";
import { GitHubApp } from "./github-app.js";

const SAVE_BRAKE = {
  windowMs: Duration.toMillis(Duration.hours(1)),
  maxRequestsPerWindow: 10,
  maxTrackedUsers: 10_000,
} as const;

/** How long GitHub is given to answer before the save is answered unreachable. */
const CHECK_TIMEOUT = Duration.seconds(10);

const HINT_TAIL_CHARS = 4;

export interface GitHubTokenProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The hint a member is shown of a token: the classic prefix where it has it and its last four characters, as `ghp_…abcd`. */
function tokenHint(token: Redacted.Redacted<string>): string {
  const revealed = Redacted.value(token);
  const prefix = revealed.startsWith(CLASSIC_TOKEN_PREFIX) ? CLASSIC_TOKEN_PREFIX : "";

  return `${prefix}…${revealed.slice(-HINT_TAIL_CHARS)}`;
}

/**
 * Asks GitHub whose the token is (`@repo/github`'s `checkMemberToken`):
 * what it said of a token it accepted, or why it is not kept. Never fails,
 * since every outcome is an answer: an App not configured, or a GitHub
 * that did not answer within `CHECK_TIMEOUT`, is unreachable. Nothing of
 * the exchange is logged.
 */
const checkGitHubToken = (token: Redacted.Redacted<string>) => {
  const unkept = formatRefusal(token);

  // Note that a token refused by its form is answered before the App is needed, so a deployment without one still says why.
  if (unkept !== undefined) return Effect.succeed(Result.fail<GitHubTokenRejection>(unkept));

  return Effect.flatMap(GitHubApp, (app) =>
    app.checkMemberToken(token).pipe(
      Effect.timeout(CHECK_TIMEOUT),
      Effect.orElseSucceed(() =>
        Result.fail<GitHubTokenRejection>(GITHUB_TOKEN_REJECTION.UNREACHABLE),
      ),
    ),
  );
};

/** The token as the member is shown it, answered unreadable where the ring cannot open it. */
function summaryOf(userId: string, ring: KeyRing, row: GitHubTokenRow): GitHubTokenSummary {
  const readable = Result.isSuccess(openGitHubToken(ring, userId, row));

  return {
    login: row.githubLogin,
    hint: row.hint,
    status: readable ? row.status : GITHUB_TOKEN_STATUS.UNREADABLE,
    statusAt: row.statusAt.getTime(),
    addedAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt?.getTime() ?? null,
  };
}

const tokenAnswer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  ring: KeyRing,
  rejected?: GitHubTokenRejection,
) {
  const row = yield* hostedStoreOrUnavailable(readGitHubTokenRow(userId));

  return {
    token: row === undefined ? null : summaryOf(userId, ring, row),
    ...(rejected === undefined ? undefined : { rejected }),
  } satisfies GitHubTokenAnswer;
});

/** The token's three procedures, braked per instance, each to a signed-in member, on a deployment that holds a ring. */
export function githubTokenProcedures(seams: GitHubTokenProcedureSeams) {
  const brake = createRateBrake(SAVE_BRAKE);

  const held = hosted.githubToken
    .use(accountMiddleware(seams.resolveUserId))
    .use(keyRingMiddleware);

  return {
    read: held.read.effect(function* ({ context }) {
      return yield* tokenAnswer(context.userId, context.ring);
    }),

    /** A save: braked, checked with GitHub, and kept sealed only where GitHub accepts it. */
    save: held.save.effect(function* ({ context, input }) {
      const { userId, ring } = context;
      const token = Redacted.make(input.token);

      if (!(yield* brake.check(userId))) {
        return yield* tokenAnswer(userId, ring, GITHUB_TOKEN_REJECTION.TOO_MANY_TRIES);
      }

      const checked = yield* checkGitHubToken(token);

      if (Result.isFailure(checked)) return yield* tokenAnswer(userId, ring, checked.failure);
      const now = yield* DateTime.nowAsDate;
      const facts = { hint: tokenHint(token), ...checked.success };
      yield* hostedStoreOrUnavailable(
        saveGitHubToken(userId, sealGitHubToken(ring, userId, token), facts, now),
      );
      yield* recordServerEvent(SERVER_EVENT.GITHUB_TOKEN_SAVE, { userId }, {});

      return yield* tokenAnswer(userId, ring);
    }),

    remove: held.remove.effect(function* ({ context }) {
      yield* hostedStoreOrUnavailable(removeGitHubToken(context.userId));

      return yield* tokenAnswer(context.userId, context.ring);
    }),
  };
}
