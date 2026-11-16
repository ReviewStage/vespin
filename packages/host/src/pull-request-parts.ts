/**
 * pull-request-parts.ts -- the parts of each agent's pull request the windows' Pull request tabs hold, fetched while held and asked again together as the pull request moves.
 *
 * A Pull request tab holds six reads of its pull request: the pull request
 * itself, its checks, its conversation, what the agent published, what its
 * reviewer and label pickers offer, and which of its files the member marked
 * viewed, each by the agent and then the pull request's number, or `OWN_PULL_REQUEST`
 * for the agent's own, which the service resolves from the agent's branch.
 * Each is a fetch the host holds (`heldFetch`), asked as a window first
 * holds it, as a window comes forward, and on its own Try again. The first
 * four parts a window holds of one pull request are asked again together as
 * its agent's status moves, which is how its end is heard, or as the task
 * list's line for it moves: its state, checks, merge queue, or head commit,
 * which a push moves, or, for an agent's own, as the list first names a pull
 * request the agent published, or another in its place, which is how a
 * window drawing the pull request from the list hears its branch; the viewed
 * marks only as its head moves, since a push is what unmarks a file; and the
 * pickers' options on nothing but focus and Try again, since they are the
 * repository's. Note that the line is found by the pull request's address,
 * from the pull request or published part's own answer, or from the agent's
 * listed pull request for its own, so a pull request no agent of the list
 * published, or one not answered yet, is asked again on nothing but focus
 * and Try again. A part whose ask fails after one answered keeps that answer, as a
 * fetch the host holds does; one that fails before any answered holds the
 * failure, so its tab says why; but the viewed marks hold every answer,
 * since marks a read can no longer vouch for are taken away until one does.
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
  type AgentOverviewChecksAnswerView,
  type AgentOverviewConversationAnswerView,
  type AgentOverviewPullRequestAnswerView,
  type AgentPullRequestAnswerView,
  type AgentPullRequestViewedAnswerView,
  type AgentReviewOptionsAnswerView,
  PULL_REQUEST_PART,
  type PullRequestPart,
  type PullRequestPartParams,
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
import {
  type AppPullRequestParts,
  type AppRepositoryPullRequestParts,
  NO_KEYS_HELD,
  OWN_PULL_REQUEST,
} from "./app-state.js";
import { type HeldFetch, heldFetch } from "./held-fetch.js";
import { type ListMove, movesBetween } from "./list-moves.js";
import { pushLive } from "./live-push.js";
import type { WindowFocus } from "./window-focus.js";

/** Whose part: one agent's pull request, by the agent's id and the number its tab names, none for the agent's own. */
export class PullRequestKey extends Data.Class<{
  readonly agentId: string;
  readonly number: number | undefined;
}> {}

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

export interface PullRequestPartsDependencies {
  /** Whether the account gate stands open, so a part may be asked. */
  readonly gate: () => boolean;
  readonly focus: WindowFocus;
  /** One ask of each part of `key`'s pull request: what the service answered, or why there is none. */
  readonly ask: {
    readonly pullRequest: (
      key: PullRequestKey,
    ) => Effect.Effect<AgentOverviewPullRequestAnswerView>;
    readonly checks: (key: PullRequestKey) => Effect.Effect<AgentOverviewChecksAnswerView>;
    readonly conversation: (
      key: PullRequestKey,
    ) => Effect.Effect<AgentOverviewConversationAnswerView>;
    readonly published: (key: PullRequestKey) => Effect.Effect<AgentPullRequestAnswerView>;
    readonly reviewOptions: (key: PullRequestKey) => Effect.Effect<AgentReviewOptionsAnswerView>;
    readonly viewed: (key: PullRequestKey) => Effect.Effect<AgentPullRequestViewedAnswerView>;
  };
  /** The task list each time it is drawn, from the caller's listening on. */
  readonly listings: Effect.Effect<Stream.Stream<PullRequestListing>, never, Scope.Scope>;
  /** How each part's slice is told, whole, each time any of its keys moves. */
  readonly tell: {
    readonly [Slice in keyof AppPullRequestParts]: (held: AppPullRequestParts[Slice]) => void;
  };
}

/** The parts the windows hold, by what names their pull request, and what the host does for them. */
export interface PullRequestParts<Params = PullRequestPartParams> {
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

type PartFetch = PartFetchOf<PullRequestKey>;

/** Where a key's part stands on its slice: under the agent, then the pull request's number, or the agent's own. */
function pathOf(key: PullRequestKey): readonly [string, string] {
  return [key.agentId, key.number === undefined ? OWN_PULL_REQUEST : String(key.number)];
}

function keyOf(params: PullRequestPartParams): PullRequestKey {
  return new PullRequestKey({ agentId: params.agentId, number: params.number });
}

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
  readonly heads: ReadonlySet<string>;
};

/** What a drawing of the list moved: the agents whose status moved, those it names a pull request of anew, the addresses of the pull requests whose line moved or left, and of those whose head moved or left among them. */
function movedIn(listing: PullRequestListing): Moved {
  const agents = new Set<string>();

  for (const { was, now } of listing.agents) {
    if (was !== undefined && now?.status !== was.status) agents.add(was.id);
  }

  const opened = new Set<string>();
  const urls = new Set<string>();
  const heads = new Set<string>();

  for (const { was, now } of listing.pullRequests) {
    if (now !== undefined && was?.pullRequest.url !== now.pullRequest.url) opened.add(now.agentId);

    if (was === undefined) continue;
    const line = was.pullRequest;
    const after = now?.pullRequest.url === line.url ? now.pullRequest : undefined;

    if (lineMoved(line, after)) urls.add(line.url);

    if (after?.headSha !== line.headSha) heads.add(line.url);
  }

  return { agents, opened, urls, heads };
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

/** The parts of the pull requests the windows hold, for as long as the scope that made them stands. */
export function pullRequestParts(
  dependencies: PullRequestPartsDependencies,
): Effect.Effect<PullRequestParts, never, Scope.Scope> {
  return Effect.gen(function* () {
    const { gate, focus, ask, tell } = dependencies;
    /** Each held pull request's address, as its pull request or published part last answered it. */
    const urls = MutableHashMap.empty<PullRequestKey, string>();

    const pullRequest = yield* heldFetch<typeof LIVE_READ.PULL_REQUEST, PullRequestKey>({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key, held) =>
        Effect.map(ask.pullRequest(key), (answer) => {
          if (!("failure" in answer) && answer.pullRequest !== null) {
            MutableHashMap.set(urls, key, answer.pullRequest.url);
          }

          return keptOver(answer, held);
        }),
      tell: tell[LIVE_READ.PULL_REQUEST],
    });

    const checks = yield* heldFetch<typeof LIVE_READ.PULL_REQUEST_CHECKS, PullRequestKey>({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.checks(key), (answer) => keptOver(answer, held)),
      tell: tell[LIVE_READ.PULL_REQUEST_CHECKS],
    });

    const conversation = yield* heldFetch<
      typeof LIVE_READ.PULL_REQUEST_CONVERSATION,
      PullRequestKey
    >({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.conversation(key), (answer) => keptOver(answer, held)),
      tell: tell[LIVE_READ.PULL_REQUEST_CONVERSATION],
    });

    const published = yield* heldFetch<typeof LIVE_READ.PULL_REQUEST_PUBLISHED, PullRequestKey>({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key, held) =>
        Effect.map(ask.published(key), (answer) => {
          if (!("failure" in answer) && answer.pullRequest !== null) {
            MutableHashMap.set(urls, key, answer.pullRequest.url);
          }

          return keptOver(answer, held);
        }),
      tell: tell[LIVE_READ.PULL_REQUEST_PUBLISHED],
    });

    const reviewOptions = yield* heldFetch<typeof LIVE_READ.REVIEW_OPTIONS, PullRequestKey>({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key, held) => Effect.map(ask.reviewOptions(key), (answer) => keptOver(answer, held)),
      tell: tell[LIVE_READ.REVIEW_OPTIONS],
    });

    const viewed = yield* heldFetch<typeof LIVE_READ.PULL_REQUEST_VIEWED, PullRequestKey>({
      empty: NO_KEYS_HELD,
      path: pathOf,
      gate,
      focus,
      fetch: (key) => Effect.map(ask.viewed(key), Option.some),
      tell: tell[LIVE_READ.PULL_REQUEST_VIEWED],
    });

    const fetches: Readonly<Record<PullRequestPart, PartFetch>> = {
      [PULL_REQUEST_PART.PULL_REQUEST]: pullRequest,
      [PULL_REQUEST_PART.CHECKS]: checks,
      [PULL_REQUEST_PART.CONVERSATION]: conversation,
      [PULL_REQUEST_PART.PUBLISHED]: published,
      [PULL_REQUEST_PART.REVIEW_OPTIONS]: reviewOptions,
      [PULL_REQUEST_PART.VIEWED]: viewed,
    };

    const every = Object.values(fetches);
    /** The parts asked again together as the pull request or its agent moves. */
    const moving: readonly PartFetch[] = [pullRequest, checks, conversation, published];

    /** The address a key's pull request is listed by: its pull request or published part's answer, or for the agent's own, the pull request the list says it published. */
    const urlOf = (
      key: PullRequestKey,
      agentUrl: (agentId: string) => string | undefined,
    ): string | undefined =>
      Option.getOrUndefined(MutableHashMap.get(urls, key)) ??
      (key.number === undefined ? agentUrl(key.agentId) : undefined);

    const addresses = agentAddresses();

    // Note that a drawing that starts the list anew asks nothing, since nothing moved yet that a part was read before.
    const heard = (listing: PullRequestListing) =>
      Effect.suspend(() => {
        const moved = movedIn(listing);
        const wasUrlOf = addresses(listing);

        if (listing.whole) return Effect.void;

        if (moved.agents.size === 0 && moved.opened.size === 0 && moved.urls.size === 0) {
          return Effect.void;
        }

        const named = (key: PullRequestKey) => {
          if (moved.agents.has(key.agentId)) return true;

          if (key.number === undefined && moved.opened.has(key.agentId)) return true;
          const url = urlOf(key, wasUrlOf);

          return url !== undefined && moved.urls.has(url);
        };

        const pushed = (key: PullRequestKey) => {
          const url = urlOf(key, wasUrlOf);

          return url !== undefined && moved.heads.has(url);
        };

        return Effect.andThen(
          Effect.forEach(moving, (fetch) => fetch.wake(named), { discard: true }),
          viewed.wake(pushed),
        );
      });

    yield* Effect.forkScoped(Stream.runForEach(yield* dependencies.listings, heard));

    return {
      hold: (params) => fetches[params.part].hold(keyOf(params)),
      retry: (params) => fetches[params.part].retry(keyOf(params)),
      open: Effect.forEach(every, (fetch) => fetch.open, { discard: true }),
      end: Effect.forEach(every, (fetch) => fetch.end, { discard: true }),
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
