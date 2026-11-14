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
 */

import {
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
import { LIVE_READ } from "@repo/features/live-wire";
import type { ListedPullRequest } from "@repo/features/task-wire";
import { Data, Effect, MutableHashMap, Option, type Scope, Stream } from "effect";
import { type AppPullRequestParts, NO_KEYS_HELD, OWN_PULL_REQUEST } from "./app-state.js";
import { type HeldFetch, heldFetch } from "./held-fetch.js";
import { type ListMove, movesBetween } from "./list-moves.js";
import type { WindowFocus } from "./window-focus.js";

/** Whose part: one agent's pull request, by the agent's id and the number its tab names, none for the agent's own. */
export class PullRequestKey extends Data.Class<{
  readonly agentId: string;
  readonly number: number | undefined;
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

/** The parts the windows hold, and what the host does for them. */
export interface PullRequestParts {
  /** Holds one part for the caller's scope, asking it where no window held it; let go with the last scope holding it, it is kept a while among those let go lately. */
  readonly hold: (params: PullRequestPartParams) => Effect.Effect<void, never, Scope.Scope>;
  /** Asks one held part again at once, as Try again asks; answers once that ask has landed. */
  readonly retry: (params: PullRequestPartParams) => Effect.Effect<void>;
  /** Follows every held part anew, as the account gate opening asks. */
  readonly open: Effect.Effect<void>;
  /** Lets every part go and tells none held: the session ended. */
  readonly end: Effect.Effect<void>;
}

/** One part's fetch as the windows' holds, Try again, and the list's moves reach it, whatever it holds. */
type PartFetch = Omit<HeldFetch<PullRequestKey, unknown>, "answered">;

/** Where a key's part stands on its slice: under the agent, then the pull request's number, or the agent's own. */
function pathOf(key: PullRequestKey): readonly [string, string] {
  return [key.agentId, key.number === undefined ? OWN_PULL_REQUEST : String(key.number)];
}

function keyOf(params: PullRequestPartParams): PullRequestKey {
  return new PullRequestKey({ agentId: params.agentId, number: params.number });
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

    /** The address of each agent's pull request the list names, as the drawings so far left it. */
    const agentUrls = new Map<string, string>();

    /** Lays a drawing's moved pull requests over the addresses held. */
    const relisted = (listing: PullRequestListing) => {
      if (listing.whole) agentUrls.clear();

      for (const { was, now } of listing.pullRequests) {
        if (now !== undefined) agentUrls.set(now.agentId, now.pullRequest.url);
        else if (was !== undefined) agentUrls.delete(was.agentId);
      }
    };

    // Note that a drawing that starts the list anew asks nothing, since nothing moved yet that a part was read before.
    const heard = (listing: PullRequestListing) =>
      Effect.suspend(() => {
        const moved = movedIn(listing);

        // Note that an agent's address is read as the drawing before left it, so a pull request its line no longer names is still heard as left.
        const wasUrls = new Map(
          listing.pullRequests.map(({ was, now }) => [
            (now ?? was)?.agentId ?? "",
            was?.pullRequest.url,
          ]),
        );

        const wasUrlOf = (agentId: string) =>
          wasUrls.has(agentId) ? wasUrls.get(agentId) : agentUrls.get(agentId);

        relisted(listing);

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
