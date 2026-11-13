import type { DatabaseServices } from "@repo/database/core/query";
import { readGitHubTokenRow, setGitHubTokenStatus } from "@repo/database/models/github-token-store";
import { openGitHubToken, parseKeyRing } from "@repo/database/models/provider-key-seal";
import type { TaskStoreEffect, TaskStoreFailure } from "@repo/database/models/task-store";
import { GITHUB_TOKEN_STATUS } from "@repo/features/github-token-wire";
import {
  GitHubMemberTokens,
  GitHubMemberTokensUnavailable,
  MEMBER_TOKEN_ABSENCE,
  type MemberTokenAbsence,
} from "@repo/github";
import { DateTime, Effect, type Redacted, Result } from "effect";
import { HostedEnvironment } from "../environment.js";

/**
 * github-token.ts -- a member's own GitHub personal access token, opened for the one call that needs it.
 *
 * The store behind `@repo/github`'s `GitHubMemberTokens`, which decides
 * where a member's token is used: the token as a `Redacted` where the
 * member keeps one GitHub has not refused, or why there is none to use. A use that GitHub answers 401 marks the
 * token invalid through the read's own `markInvalid`, which names the seal
 * the read opened, so a token the member replaced meanwhile is left as it
 * stands. Read afresh for every use, so a token saved, replaced, or removed
 * in Settings is the one the next use takes.
 */

/** A member's token GitHub has not refused, opened, with whose it is and how to mark it refused. */
export interface MemberGitHubToken {
  readonly token: Redacted.Redacted<string>;
  readonly githubUserId: string;
  readonly githubLogin: string;
  /** Marks this token invalid, after GitHub answered a use of it 401. */
  readonly markInvalid: TaskStoreEffect<void>;
}

/** The member's token to use, or why there is none. */
export function memberGitHubToken(
  userId: string,
): Effect.Effect<
  Result.Result<MemberGitHubToken, MemberTokenAbsence>,
  TaskStoreFailure,
  DatabaseServices | HostedEnvironment
> {
  return Effect.gen(function* () {
    const environment = yield* HostedEnvironment;

    return yield* openMemberGitHubToken(environment.providerKeyEncryptionKeys, userId);
  });
}

/** The same read under the ring given, the deployment's `providerKeyEncryptionKeys`, for a service built over it. */
export function openMemberGitHubToken(
  configured: Redacted.Redacted | undefined,
  userId: string,
): Effect.Effect<
  Result.Result<MemberGitHubToken, MemberTokenAbsence>,
  TaskStoreFailure,
  DatabaseServices
> {
  return Effect.gen(function* () {
    const row = yield* readGitHubTokenRow(userId);

    if (row === undefined) return Result.fail(MEMBER_TOKEN_ABSENCE.NONE);

    if (row.status === GITHUB_TOKEN_STATUS.INVALID)
      return Result.fail(MEMBER_TOKEN_ABSENCE.INVALID);
    const ring = configured === undefined ? undefined : parseKeyRing(configured);

    if (ring === undefined || Result.isFailure(ring)) {
      return Result.fail(MEMBER_TOKEN_ABSENCE.UNREADABLE);
    }

    const opened = openGitHubToken(ring.success, userId, row);

    if (Result.isFailure(opened)) return Result.fail(MEMBER_TOKEN_ABSENCE.UNREADABLE);

    return Result.succeed({
      token: opened.success,
      githubUserId: row.githubUserId,
      githubLogin: row.githubLogin,
      markInvalid: Effect.flatMap(DateTime.nowAsDate, (now) =>
        setGitHubTokenStatus(userId, row.sealedToken, GITHUB_TOKEN_STATUS.INVALID, now),
      ),
    });
  });
}

/**
 * `@repo/github`'s `GitHubMemberTokens` over the store, under the ring
 * given and the store the caller runs on: the read above, its store
 * failures failed as the module's `GitHubMemberTokensUnavailable`.
 */
export function memberTokensOver(configured: Redacted.Redacted | undefined) {
  return Effect.map(Effect.context<DatabaseServices>(), (store) => {
    const unavailable = <A>(effect: Effect.Effect<A, TaskStoreFailure, DatabaseServices>) =>
      effect.pipe(
        Effect.provideContext(store),
        Effect.mapError((cause) => new GitHubMemberTokensUnavailable({ cause })),
      );

    return GitHubMemberTokens.of({
      token: (member) =>
        unavailable(
          Effect.map(
            openMemberGitHubToken(configured, member),
            Result.map((held) => ({ ...held, markInvalid: unavailable(held.markInvalid) })),
          ),
        ),
    });
  });
}
