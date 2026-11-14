/**
 * pull-request-links.ts -- the pull request a link draws, read once a minute per instance rather than once per link.
 *
 * A screen of plans and threads draws every pull request link as a chip, and
 * each chip asks `GET /api/github/repositories/pull-request` as it mounts,
 * so one desktop asks for the same pull request in bursts, and a burst of
 * reads is what GitHub's secondary rate limit answers 403 to.
 *
 * So the answer is kept on the instance, per pull request as one member
 * asked for it: concurrent asks join the one read under way, an answer is
 * kept for `KEPT_LINK.ANSWER_TTL`, and a refusal GitHub answers 403 or 429
 * is held for as long as its `Retry-After` asks, or `KEPT_LINK.REFUSAL_HOLD`
 * where it names none, never past `KEPT_LINK.REFUSAL_HOLD_MAX`, so the asks
 * that follow a refusal are answered with it rather than sent. Any other
 * failure is not kept, so the next ask reads afresh. A failure is logged
 * where it is read, once per read rather than once per ask it answers.
 *
 * Note that the member is part of the key, because a repository no
 * installation reaches may be read on the member's own token, and what that
 * token reads is not another member's to see. Who may ask at all is checked
 * on every ask, before the kept answer is read, and so is whether the
 * workspace's installation or the member's token still reaches the
 * repository: through `GitHubApp`'s own kept reach and token, which read the
 * store's links and the member's token on every ask and GitHub only when
 * their own keeping lapses, so an installation disconnected or a token
 * revoked stops the kept answer at once rather than when it lapses. A held
 * refusal is answered before that check, since it shows nothing of the pull
 * request and may outlast the reach `GitHubApp` keeps.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type { GitHubPullRequestSummary } from "@repo/features";
import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import {
  Cache,
  Clock,
  Context,
  Data,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Result,
} from "effect";
import type { HttpClient } from "effect/http";
import { GitHubApp, type GitHubWorkspaceReadFailure, markRefusedToken } from "./github-app.js";
import { logWorkspaceReadFailure } from "./github-refusal.js";
import { pullRequestQueued } from "./pull-request-merging.js";
import { pullRequestByNumber } from "./pull-requests.js";

/** How many links an instance keeps, and for how long an answer and a refusal are kept. */
export const KEPT_LINK = {
  CAPACITY: 2_048,
  ANSWER_TTL: Duration.minutes(1),
  REFUSAL_HOLD: Duration.minutes(3),
  REFUSAL_HOLD_MAX: Duration.minutes(15),
} as const;

/** What a read of a link may require of the function that stands it. */
type LinkServices = DatabaseServices | GitHubApp | HttpClient.HttpClient;

/** One pull request of one repository of one workspace, as one member asked for it. */
export class PullRequestLinkKey extends Data.Class<{
  readonly workspaceId: string;
  readonly repository: string;
  readonly member: string;
  readonly number: number;
}> {}

/** A link's read as kept: how it went, and how long it is kept from when it was read. */
interface KeptRead {
  readonly read: Result.Result<GitHubPullRequestSummary | null, GitHubWorkspaceReadFailure>;
  readonly keptFor: Duration.Duration;
}

/**
 * How long a read's outcome is kept, from `now`: an answer a minute,
 * GitHub's refusal (`GitHubForbidden`, or `GitHubRateLimited` until when
 * GitHub said it may be asked again, within the bound), anything else not
 * at all.
 */
function keptFor(
  read: Result.Result<unknown, GitHubWorkspaceReadFailure>,
  now: number,
): Duration.Duration {
  if (Result.isSuccess(read)) return KEPT_LINK.ANSWER_TTL;
  const failure = read.failure;

  if (Predicate.isTagged(failure, "GitHubForbidden")) return KEPT_LINK.REFUSAL_HOLD;

  if (!Predicate.isTagged(failure, "GitHubRateLimited")) return Duration.zero;
  const resetsAt = failure.resetsAt?.getTime();

  if (resetsAt === undefined) return KEPT_LINK.REFUSAL_HOLD;

  return Duration.min(Duration.millis(Math.max(resetsAt - now, 0)), KEPT_LINK.REFUSAL_HOLD_MAX);
}

/** A kept read answered as it went. */
function answered(kept: KeptRead) {
  return Result.isSuccess(kept.read)
    ? Effect.succeed(kept.read.success)
    : Effect.fail(kept.read.failure);
}

/**
 * The pull request of the number given, of a repository the workspace's
 * installation or the member's own token reaches, as much of it as a link
 * draws; none where neither reaches the repository or the repository holds
 * none of that number.
 */
const pullRequestOfLink = /* @__PURE__ */ Effect.fnUntraced(function* (
  key: PullRequestLinkKey,
): Effect.fn.Return<GitHubPullRequestSummary | null, GitHubWorkspaceReadFailure, LinkServices> {
  const app = yield* GitHubApp;

  const reached = yield* app.repositoryPullRequestToken(
    key.workspaceId,
    key.repository,
    key.member,
  );

  if (Option.isNone(reached)) return null;

  const found = yield* pullRequestByNumber(reached.value.bearer, key.repository, key.number).pipe(
    markRefusedToken(reached.value.access),
  );

  if (Option.isNone(found)) return null;
  const pull = found.value;

  // Note that a queue read GitHub could not answer draws the link as open rather than failing it.
  const queued =
    pull.state === PULL_REQUEST_STATE.OPEN &&
    (yield* pullRequestQueued(reached.value.bearer, key.repository, key.number).pipe(
      Effect.catch(() => Effect.succeed(false)),
    ));

  return {
    number: pull.number,
    title: pull.title,
    url: pull.url,
    state: pull.state,
    additions: pull.additions,
    deletions: pull.deletions,
    changedFiles: pull.changedFiles,
    headRef: pull.headRef,
    ...(pull.author === undefined ? undefined : { author: pull.author }),
    ...(pull.authorAvatarUrl === undefined ? undefined : { authorAvatarUrl: pull.authorAvatarUrl }),
    ...(pull.authorBot === undefined ? undefined : { authorBot: pull.authorBot }),
    ...(pull.openedAt === undefined ? undefined : { openedAt: pull.openedAt }),
    ...(pull.mergedAt === undefined ? undefined : { mergedAt: pull.mergedAt }),
    ...(pull.closedAt === undefined ? undefined : { closedAt: pull.closedAt }),
    ...(pull.baseRef === undefined ? undefined : { baseRef: pull.baseRef }),
    ...(pull.labels === undefined ? undefined : { labels: pull.labels }),
    ...(pull.comments === undefined ? undefined : { comments: pull.comments }),
    ...(pull.commits === undefined ? undefined : { commits: pull.commits }),
    ...(queued ? { queued: true } : undefined),
  };
});

/** The pull requests links draw, kept on the instance on the terms above. */
export class PullRequestLinks extends Context.Service<
  PullRequestLinks,
  {
    /** The pull request the key names, kept or read, where the repository is still reached; a failure is logged where it was read, not by the caller. */
    readonly read: (
      key: PullRequestLinkKey,
    ) => Effect.Effect<GitHubPullRequestSummary | null, GitHubWorkspaceReadFailure, LinkServices>;
  }
>()("PullRequestLinks") {}

/** The instance's kept links, empty at the start. */
export const pullRequestLinksLayer: Layer.Layer<PullRequestLinks> = Layer.effect(
  PullRequestLinks,
  Effect.gen(function* () {
    // Note that a read's outcome is kept as a value, so how long it is kept is read on the clock as it lands.
    const kept = yield* Cache.makeWith(
      (key: PullRequestLinkKey) =>
        pullRequestOfLink(key).pipe(
          Effect.tapError(logWorkspaceReadFailure),
          Effect.result,
          Effect.flatMap((read) =>
            Effect.map(
              Clock.currentTimeMillis,
              (now): KeptRead => ({ read, keptFor: keptFor(read, now) }),
            ),
          ),
        ),
      {
        capacity: KEPT_LINK.CAPACITY,
        requireServicesAt: "lookup",
        timeToLive: (exit) => (Exit.isSuccess(exit) ? exit.value.keptFor : Duration.zero),
      },
    );

    return {
      read: (key) =>
        Effect.gen(function* () {
          // Note that a held refusal is answered before the reach is read, because a hold may outlast the reach `GitHubApp` keeps, and a refusal shows nothing of the pull request.
          const held = yield* Cache.getOption(kept, key);

          if (Option.isSome(held) && Result.isFailure(held.value.read)) {
            return yield* answered(held.value);
          }

          const app = yield* GitHubApp;

          const reached = yield* app
            .repositoryPullRequestToken(key.workspaceId, key.repository, key.member)
            .pipe(Effect.tapError(logWorkspaceReadFailure));

          if (Option.isNone(reached)) return null;

          return yield* Effect.flatMap(Cache.get(kept, key), answered);
        }),
    };
  }),
);
