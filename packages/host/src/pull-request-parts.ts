/**
 * pull-request-parts.ts -- the pull requests the windows hold: each agent's own as its card draws it, and the parts of each pull request a Pull request tab names by its repository and number, fetched while held and asked again as they move.
 *
 * What an agent published, its branch and the pull request from it as the
 * service last read it from GitHub, is held by the agent alone for the
 * card that draws it (`agentPullRequests`). It is a fetch the host holds
 * (`heldFetch`), asked as a window first holds it, as a window comes
 * forward, and on its own Try again, and asked again as the agent's status
 * moves, which is how its end is heard, as the task list first names a
 * pull request the agent published, or another in its place, or as the
 * list's line for it moves: its state, checks, merge queue, or head commit,
 * which a push moves. Note that the line is found by the pull request's
 * address, from the published read's own answer, or from the agent's listed
 * pull request before it answers. An ask that fails after one answered keeps
 * that answer, as a fetch the host holds does; one that fails before any
 * answered holds the failure, so its card says why.
 *
 * A Pull request tab that names its pull request by its repository and
 * number, with no agent, holds the same six parts by the workspace whose
 * installation reaches the repository, the repository, and the number
 * (`repositoryPullRequestParts`). Nothing of it is tied to an agent: while
 * a window holds any of its parts, the host follows when GitHub last said
 * the pull request moved (`REPOSITORY_PULL_REQUEST_MOVED_READ`), which every
 * delivery about it, its reviews, its comments, its review threads, or its
 * checks moves, whoever opened it. Its first four parts are asked again
 * together as that moves; its viewed marks as the head GitHub names moves
 * too; and its pickers' options on focus and Try again alone. A follow the
 * service refused for good, a workspace the reader is no member of, stops,
 * and its parts are asked again on focus and Try again alone.
 */

import {
  AGENT_CALL_FAILURE,
  type AgentPullRequestAnswerView,
  PULL_REQUEST_PART,
  type PullRequestPart,
} from "@repo/features/agent-view";
import type { AgentPullRequest, ListedAgent } from "@repo/features/agent-wire";
import { LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  type PullRequestMoved,
  pullRequestMovedOfLive,
  type RepositoryPullRequestMovedLiveAnswer,
} from "@repo/features/pull-request-moved-live";
import type {
  RepositoryOverviewChecksAnswerView,
  RepositoryOverviewConversationAnswerView,
  RepositoryOverviewPullRequestAnswerView,
  RepositoryPullRequestAnswerView,
  RepositoryPullRequestParams,
  RepositoryPullRequestPartParams,
  RepositoryPullRequestViewedAnswerView,
  RepositoryReviewOptionsAnswerView,
} from "@repo/features/pull-request-view";
import type { ListedPullRequest } from "@repo/features/task-wire";
import { Data, Effect, Equal, FiberMap, MutableHashMap, Option, type Scope, Stream } from "effect";
import { type AppHeldById, type AppRepositoryPullRequestParts, NO_KEYS_HELD } from "./app-state.js";
import { type HeldFetch, heldFetch } from "./held-fetch.js";
import { type ListMove, movesBetween } from "./list-moves.js";
import { pushLive } from "./live-push.js";
import type { WindowFocus } from "./window-focus.js";

/** Whose part: one pull request named by its repository and number, by the workspace whose installation reaches the repository, the repository's full name, and the number. */
export class RepositoryPullRequestKey extends Data.Class<{
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}> {}

/** The task list's agents and their pull requests as one drawing of it holds them. */
export interface ListDrawing {
  readonly taskAgents: readonly ListedAgent[];
  readonly agentPullRequests: readonly ListedPullRequest[];
}

/**
 * One drawing of the task list as the parts read it: the agents and the
 * pull requests that moved since the drawing before, each as it stood and
 * as it stands, told by the list's live queries (`list-moves.ts`), or every
 * pull request as come where the drawing starts the list anew.
 */
export interface PullRequestListing {
  /** Whether the drawing starts the list anew, the first of a session or one no drawing before it can be told the moves since, so nothing in it moved. */
  readonly whole: boolean;
  readonly agents: readonly ListMove<ListedAgent>[];
  readonly pullRequests: readonly ListMove<ListedPullRequest>[];
}

/** The listing of the drawing `after`, told the moves since `before`; whole where there is no drawing before it or the moves since it cannot be told. */
export function pullRequestListing(
  before: ListDrawing | undefined,
  after: ListDrawing,
): PullRequestListing {
  const agents = before && movesBetween(before.taskAgents, after.taskAgents);
  const pullRequests = before && movesBetween(before.agentPullRequests, after.agentPullRequests);

  if (agents === undefined || pullRequests === undefined) {
    return {
      whole: true,
      agents: [],
      pullRequests: after.agentPullRequests.map((now) => ({ was: undefined, now })),
    };
  }

  return { whole: false, agents: agents.moves, pullRequests: pullRequests.moves };
}

export interface AgentPullRequestsDependencies {
  /** Whether the account gate stands open, so a read may be asked. */
  readonly gate: () => boolean;
  readonly focus: WindowFocus;
  /** One ask of what `agentId` published: what the service answered, or why there is none. */
  readonly ask: (agentId: string) => Effect.Effect<AgentPullRequestAnswerView>;
  /** The task list each time it is drawn, from the caller's listening on. */
  readonly listings: Effect.Effect<Stream.Stream<PullRequestListing>, never, Scope.Scope>;
  /** How the slice is told, whole, each time any agent's read moves. */
  readonly tell: (held: AppHeldById<AgentPullRequestAnswerView>) => void;
}

/** The reads the windows hold, by what names them, and what the host does for them. */
export interface PullRequestParts<Params> {
  /** Holds one part for the caller's scope, asking it where no window held it; let go with the last scope holding it, it is kept a while among those let go lately. */
  readonly hold: (params: Params) => Effect.Effect<void, never, Scope.Scope>;
  /** Asks one held part again at once, as Try again asks; answers once that ask has landed. */
  readonly retry: (params: Params) => Effect.Effect<void>;
  /** Follows every held part anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Lets every part go and tells none held: the session ended. */
  readonly end: Effect.Effect<void>;
}

export interface RepositoryPullRequestPartsDependencies {
  /** Whether the account gate stands open, so a part may be asked. */
  readonly gate: () => boolean;
  readonly focus: WindowFocus;
  /** One ask of each part of `key`'s pull request: what the service answered, or why there is none. */
  readonly ask: {
    readonly pullRequest: (
      key: RepositoryPullRequestKey,
    ) => Effect.Effect<RepositoryOverviewPullRequestAnswerView>;
    readonly checks: (
      key: RepositoryPullRequestKey,
    ) => Effect.Effect<RepositoryOverviewChecksAnswerView>;
    readonly conversation: (
      key: RepositoryPullRequestKey,
    ) => Effect.Effect<RepositoryOverviewConversationAnswerView>;
    readonly published: (
      key: RepositoryPullRequestKey,
    ) => Effect.Effect<RepositoryPullRequestAnswerView>;
    readonly reviewOptions: (
      key: RepositoryPullRequestKey,
    ) => Effect.Effect<RepositoryReviewOptionsAnswerView>;
    readonly viewed: (
      key: RepositoryPullRequestKey,
    ) => Effect.Effect<RepositoryPullRequestViewedAnswerView>;
  };
  /** When GitHub last said a pull request moved, followed for each pull request a window holds. */
  readonly moved: {
    /** The read of `key`'s moves sealed for `userId`, its rows inline at the poll address where it polls, held past `after` where it names one. */
    readonly seal: (
      key: RepositoryPullRequestKey,
      poll: boolean,
      userId: string,
      after?: string,
    ) => Effect.Effect<RepositoryPullRequestMovedLiveAnswer | { readonly failure: string }>;
    /** The account signed in, which every seal names; none while nobody is. */
    readonly accountId: () => string | undefined;
  };
  /** How each part's slice is told, whole, each time any of its keys moves. */
  readonly tell: {
    readonly [Slice in keyof AppRepositoryPullRequestParts]: (
      held: AppRepositoryPullRequestParts[Slice],
    ) => void;
  };
}

/** One part's fetch as the windows' holds, Try again, and the list's moves reach it, by its key, whatever it holds. */
type PartFetchOf<Key> = Omit<HeldFetch<Key, unknown>, "answered">;

/** Where a repository key's part stands on its slice: under the workspace, then the repository, then the number. */
function repositoryPathOf(key: RepositoryPullRequestKey): readonly [string, string, string] {
  return [key.workspaceId, key.repository, String(key.number)];
}

/** The key of the pull request a window named by its repository and number, whatever else it named beside them. */
export function repositoryKeyOf(params: RepositoryPullRequestParams): RepositoryPullRequestKey {
  const { workspaceId, repository, number } = params;

  return new RepositoryPullRequestKey({ workspaceId, repository, number });
}

/** A refusal that names nothing the account reaches, after which a pull request's moves are followed no longer. */
function goneAfter(failure: string): boolean {
  return failure === AGENT_CALL_FAILURE.NOT_FOUND || failure === LIVE_SIGNED_OUT.failure;
}

/** Which of a pull request's parts a move asks again: the four that move with it, and its viewed marks. */
interface MoveAsks {
  readonly moved: boolean;
  readonly pushed: boolean;
}

/** What a move GitHub said asks again of a pull request's parts: all four that move with it where it moved, and its viewed marks where its head did too; nothing at the first answer, which stands where the parts were just asked. */
function movedSince(
  was: PullRequestMoved | null | undefined,
  now: PullRequestMoved | null,
): MoveAsks {
  if (was === undefined || now === null) return { moved: false, pushed: false };
  const moved = was === null || now.movedAt !== was.movedAt;

  return { moved, pushed: moved && now.headSha !== null && now.headSha !== was?.headSha };
}

/** What a part holds after an ask: the answer, but where it failed over an answer the part already held, nothing, so that answer stands. */
function keptOver<Answer extends object>(
  answer: Answer,
  held: Answer | undefined,
): Option.Option<Answer> {
  if (!("failure" in answer)) return Option.some(answer);

  return held !== undefined && !("failure" in held) ? Option.none() : Option.some(answer);
}

/** Whether the list says a pull request moved: its state, checks, merge queue, or head. */
function lineMoved(before: AgentPullRequest, after: AgentPullRequest | undefined): boolean {
  return (
    after === undefined ||
    after.state !== before.state ||
    after.checks !== before.checks ||
    after.queued !== before.queued ||
    after.headSha !== before.headSha
  );
}

type Moved = {
  readonly agents: ReadonlySet<string>;
  readonly opened: ReadonlySet<string>;
  readonly urls: ReadonlySet<string>;
};

/** What a drawing of the list moved: the agents whose status moved, those it names a pull request of anew, and the addresses of the pull requests whose line moved or left. */
function movedIn(listing: PullRequestListing): Moved {
  const agents = new Set<string>();

  for (const { was, now } of listing.agents) {
    if (was !== undefined && now?.status !== was.status) agents.add(was.id);
  }

  const opened = new Set<string>();
  const urls = new Set<string>();

  for (const { was, now } of listing.pullRequests) {
    if (now !== undefined && was?.pullRequest.url !== now.pullRequest.url) opened.add(now.agentId);

    if (was === undefined) continue;
    const line = was.pullRequest;
    const after = now?.pullRequest.url === line.url ? now.pullRequest : undefined;

    if (lineMoved(line, after)) urls.add(line.url);
  }

  return { agents, opened, urls };
}

/**
 * Follows the address of each agent's pull request the list names across
 * its drawings: each drawing laid over the addresses held, answering each
 * agent's address as the drawing before it left it, so a pull request its
 * line no longer names is still heard as left.
 */
function agentAddresses(): (
  listing: PullRequestListing,
) => (agentId: string) => string | undefined {
  /** The address of each agent's pull request the list names, as the drawings so far left it. */
  const agentUrls = new Map<string, string>();

  return (listing) => {
    const wasUrls = new Map(
      listing.pullRequests.map(({ was, now }) => [
        (now ?? was)?.agentId ?? "",
        was?.pullRequest.url,
      ]),
    );

    if (listing.whole) agentUrls.clear();

    for (const { was, now } of listing.pullRequests) {
      if (now !== undefined) agentUrls.set(now.agentId, now.pullRequest.url);
      else if (was !== undefined) agentUrls.delete(was.agentId);
    }

    return (agentId) => (wasUrls.has(agentId) ? wasUrls.get(agentId) : agentUrls.get(agentId));
  };
}

/** What each agent the windows hold published, for as long as the scope that made it stands. */
export function agentPullRequests(
  dependencies: AgentPullRequestsDependencies,
): Effect.Effect<PullRequestParts<{ readonly agentId: string }>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { gate, focus, ask, tell } = dependencies;
    /** Each held agent's pull request's address, as its read last answered it. */
    const urls = new Map<string, string>();

    const published = yield* heldFetch<typeof LIVE_READ.PULL_REQUEST_PUBLISHED, string>({
      empty: NO_KEYS_HELD,
      path: (agentId) => [agentId],
      gate,
      focus,
      fetch: (agentId, held) =>
        Effect.map(ask(agentId), (answer) => {
          if (!("failure" in answer) && answer.pullRequest !== null) {
            urls.set(agentId, answer.pullRequest.url);
          }

          return keptOver(answer, held);
        }),
      tell,
    });

    const addresses = agentAddresses();

    // Note that a drawing that starts the list anew asks nothing, since nothing moved yet that a read was asked before.
    const heard = (listing: PullRequestListing) =>
      Effect.suspend(() => {
        const moved = movedIn(listing);
        const wasUrlOf = addresses(listing);

        if (listing.whole) return Effect.void;

        if (moved.agents.size === 0 && moved.opened.size === 0 && moved.urls.size === 0) {
          return Effect.void;
        }

        const named = (agentId: string) => {
          if (moved.agents.has(agentId) || moved.opened.has(agentId)) return true;
          const url = urls.get(agentId) ?? wasUrlOf(agentId);

          return url !== undefined && moved.urls.has(url);
        };

        return published.wake(named);
      });

    yield* Effect.forkScoped(Stream.runForEach(yield* dependencies.listings, heard));

    return {
      hold: ({ agentId }) => published.hold(agentId),
      retry: ({ agentId }) => published.retry(agentId),
      open: published.open,
      end: published.end,
    };
  });
}

/**
 * The parts of the pull requests the windows hold by their repository and
 * number, for as long as the scope that made them stands: asked as a window
 * first holds one, as a window comes forward, and on its own Try again, and
 * asked again as GitHub says the pull request moved.
 */
export function repositoryPullRequestParts(
  dependencies: RepositoryPullRequestPartsDependencies,
): Effect.Effect<PullRequestParts<RepositoryPullRequestPartParams>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { gate, focus, ask, tell } = dependencies;

    const pullRequest = yield* heldFetch<
      typeof LIVE_READ.REPOSITORY_PULL_REQUEST,
      RepositoryPullRequestKey
    >({
      empty: NO_KEYS_HELD,
      path: repositoryPathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.pullRequest(key), (answer) => keptOver(answer, held)),
      tell: tell[LIVE_READ.REPOSITORY_PULL_REQUEST],
    });

    const checks = yield* heldFetch<
      typeof LIVE_READ.REPOSITORY_PULL_REQUEST_CHECKS,
      RepositoryPullRequestKey
    >({
      empty: NO_KEYS_HELD,
      path: repositoryPathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.checks(key), (answer) => keptOver(answer, held)),
      tell: tell[LIVE_READ.REPOSITORY_PULL_REQUEST_CHECKS],
    });

    const conversation = yield* heldFetch<
      typeof LIVE_READ.REPOSITORY_PULL_REQUEST_CONVERSATION,
      RepositoryPullRequestKey
    >({
      empty: NO_KEYS_HELD,
      path: repositoryPathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.conversation(key), (answer) => keptOver(answer, held)),
      tell: tell[LIVE_READ.REPOSITORY_PULL_REQUEST_CONVERSATION],
    });

    const published = yield* heldFetch<
      typeof LIVE_READ.REPOSITORY_PULL_REQUEST_PUBLISHED,
      RepositoryPullRequestKey
    >({
      empty: NO_KEYS_HELD,
      path: repositoryPathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.published(key), (answer) => keptOver(answer, held)),
      tell: tell[LIVE_READ.REPOSITORY_PULL_REQUEST_PUBLISHED],
    });

    const reviewOptions = yield* heldFetch<
      typeof LIVE_READ.REPOSITORY_REVIEW_OPTIONS,
      RepositoryPullRequestKey
    >({
      empty: NO_KEYS_HELD,
      path: repositoryPathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.reviewOptions(key), (answer) => keptOver(answer, held)),
      tell: tell[LIVE_READ.REPOSITORY_REVIEW_OPTIONS],
    });

    const viewed = yield* heldFetch<
      typeof LIVE_READ.REPOSITORY_PULL_REQUEST_VIEWED,
      RepositoryPullRequestKey
    >({
      empty: NO_KEYS_HELD,
      path: repositoryPathOf,
      gate,
      focus,
      fetch: (key) => Effect.map(ask.viewed(key), Option.some),
      tell: tell[LIVE_READ.REPOSITORY_PULL_REQUEST_VIEWED],
    });

    const fetches: Readonly<Record<PullRequestPart, PartFetchOf<RepositoryPullRequestKey>>> = {
      [PULL_REQUEST_PART.PULL_REQUEST]: pullRequest,
      [PULL_REQUEST_PART.CHECKS]: checks,
      [PULL_REQUEST_PART.CONVERSATION]: conversation,
      [PULL_REQUEST_PART.PUBLISHED]: published,
      [PULL_REQUEST_PART.REVIEW_OPTIONS]: reviewOptions,
      [PULL_REQUEST_PART.VIEWED]: viewed,
    };

    const every = Object.values(fetches);

    /** The parts asked again together as GitHub says the pull request moved. */
    const moving: readonly PartFetchOf<RepositoryPullRequestKey>[] = [
      pullRequest,
      checks,
      conversation,
      published,
    ];

    const follows = yield* FiberMap.make<RepositoryPullRequestKey>();

    /** How many of the windows' holds of a part stand on each pull request, which its follow stands for. */
    const holders = MutableHashMap.empty<RepositoryPullRequestKey, number>();

    const holdersOf = (key: RepositoryPullRequestKey) =>
      Option.getOrElse(MutableHashMap.get(holders, key), () => 0);

    /** `key`'s moves followed until let go, its parts asked again as each lands. */
    const followMoved = (key: RepositoryPullRequestKey): Effect.Effect<void> => {
      // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
      const userId = dependencies.moved.accountId();
      const named = (other: RepositoryPullRequestKey) => Equal.equals(other, key);
      let last: PullRequestMoved | null | undefined;

      return pushLive({
        seal: (poll, after) =>
          gate() && userId !== undefined
            ? Effect.map(dependencies.moved.seal(key, poll, userId, after), (sealed) =>
                "failure" in sealed
                  ? { failure: sealed.failure, gone: goneAfter(sealed.failure) }
                  : sealed,
              )
            : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
        decode: (parts) => pullRequestMovedOfLive(parts.moved),
        publish: (now) =>
          Effect.suspend(() => {
            if (now === undefined) return Effect.void;
            const { moved, pushed } = movedSince(last, now);
            last = now;

            if (!moved) return Effect.void;

            return Effect.andThen(
              Effect.forEach(moving, (fetch) => fetch.wake(named), { discard: true }),
              pushed ? viewed.wake(named) : Effect.void,
            );
          }),
      });
    };

    /** Holds `key`'s moves for the caller's scope, following them unless they stand; let go with the last hold. */
    const holdMoved = (key: RepositoryPullRequestKey) =>
      Effect.gen(function* () {
        MutableHashMap.set(holders, key, holdersOf(key) + 1);
        yield* FiberMap.run(follows, key, followMoved(key), { onlyIfMissing: true });
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => {
            const left = holdersOf(key) - 1;

            if (left > 0) {
              MutableHashMap.set(holders, key, left);

              return Effect.void;
            }

            MutableHashMap.remove(holders, key);

            return FiberMap.remove(follows, key);
          }),
        );
      });

    /** Every held pull request's moves followed anew, as the account gate opening asks. */
    const reopen = Effect.suspend(() =>
      Effect.forEach(
        [...MutableHashMap.keys(holders)],
        (key) => FiberMap.run(follows, key, followMoved(key)),
        { discard: true },
      ),
    );

    return {
      hold: (params) =>
        Effect.andThen(
          holdMoved(repositoryKeyOf(params)),
          fetches[params.part].hold(repositoryKeyOf(params)),
        ),
      retry: (params) => fetches[params.part].retry(repositoryKeyOf(params)),
      open: Effect.andThen(
        Effect.forEach(every, (fetch) => fetch.open, { discard: true }),
        reopen,
      ),
      end: Effect.andThen(
        FiberMap.clear(follows),
        Effect.forEach(every, (fetch) => fetch.end, { discard: true }),
      ),
    };
  });
}
