import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { it } from "@effect/vitest";
import {
  AGENT_CALL_FAILURE,
  type AgentOverviewPullRequestAnswerView,
  type AgentPullRequestAnswerView,
  PULL_REQUEST_PART,
  type PullRequestPart,
} from "@repo/features/agent-view";
import {
  AGENT_STATUS,
  type AgentPullRequest,
  type AgentStatus,
  CHECK_SUMMARY,
  type ListedAgent,
  MERGE_STATE,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import { PULL_REQUEST_WRITE_OUTCOME } from "@repo/features/pull-request-write-wire";
import { listedAgentOf } from "@repo/features/task-list-live";
import { Duration, Effect, PubSub, Stream } from "effect";
import { TestClock } from "effect/testing";
import type { AppHeldById, AppRepositoryPullRequestParts } from "./app-state.js";
import type { ListMove } from "./list-moves.js";
import {
  agentPullRequests,
  type ListDrawing,
  type PullRequestListing,
  type RepositoryPullRequestKey,
  repositoryPullRequestParts,
} from "./pull-request-parts.js";
import { polledLive } from "./testing/polled-live.js";
import { agentListRow } from "./testing/task-list-rows.js";
import { windowFocus } from "./window-focus.js";

/**
 * pull-request-parts.test.ts -- what an agent published is asked again as the task list says its pull request or the agent moved, or first names it, and keeps an answer over a later failure; the parts of a pull request a Pull request tab holds by its repository and number are asked again as GitHub says it moved, and its viewed marks hold every answer.
 */

const AGENT = "3c2e1d0f-9a8b-4c7d-8e6f-5a4b3c2d1e0f";
const REVIEWER = "7d6c5b4a-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
const TASK = "5e4d3c2b-1a0f-4e9d-8c7b-6a5f4e3d2c1b";
const OWN = "https://github.com/acme/relay/pull/42";
const OTHER = "https://github.com/acme/relay/pull/7";
const WORKSPACE = "9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

/** A pull request as the task list's line for it stands. */
function line(
  url: string,
  number: number,
  moved: Partial<AgentPullRequest> = {},
): AgentPullRequest {
  return {
    number,
    title: "Send the invite once",
    url,
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PENDING,
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    headSha: "a1b2c3d",
    ...moved,
  };
}

/** The pull request part as the service answers it for the pull request at `url`. */
function overview(url: string, number: number): AgentOverviewPullRequestAnswerView {
  return {
    pullRequest: {
      number,
      title: "Send the invite once",
      url,
      state: PULL_REQUEST_STATE.OPEN,
      html: "<p>Sends the invite once.</p>",
      base: "main",
      head: "agent/invite-once",
      createdAt: 1_800_000_000_000,
      mergedAt: null,
      merge: MERGE_STATE.CLEAN,
      requested: [],
    },
  };
}

/** An agent of the list as it lists it, in `status`. */
function agent(id: string, status: AgentStatus): ListedAgent {
  return { ...listedAgentOf(agentListRow(TASK, 1_000), true, undefined), id, status };
}

/** The list with the agent working on its own pull request, and the reviewer's pull request beside it. */
function listing(
  moved: { own?: Partial<AgentPullRequest>; other?: Partial<AgentPullRequest> } = {},
  status: AgentStatus = AGENT_STATUS.RUNNING,
): ListDrawing {
  return {
    taskAgents: [agent(AGENT, status), agent(REVIEWER, AGENT_STATUS.COMPLETED)],
    agentPullRequests: [
      { agentId: AGENT, taskId: TASK, pullRequest: line(OWN, 42, moved.own) },
      { agentId: REVIEWER, taskId: TASK, pullRequest: line(OTHER, 7, moved.other) },
    ],
  };
}

/** Each row of `after` that is not equal to the one of `before` keyed alike, and each of `before` that `after` lets go, as the list's live queries tell them. */
function movesOf<Row>(
  before: readonly Row[],
  after: readonly Row[],
  keyOf: (row: Row) => string,
): ListMove<Row>[] {
  const was = new Map(before.map((row) => [keyOf(row), row]));
  const now = new Map(after.map((row) => [keyOf(row), row]));

  return [...new Set([...was.keys(), ...now.keys()])].flatMap((key) => {
    const move = { was: was.get(key), now: now.get(key) };

    return isDeepStrictEqual(move.was, move.now) ? [] : [move];
  });
}

/** The listing of the drawing `after`, told what moved since `before`, or whole where it is the first. */
function listingOf(before: ListDrawing | undefined, after: ListDrawing): PullRequestListing {
  if (before === undefined) {
    return {
      whole: true,
      agents: [],
      pullRequests: after.agentPullRequests.map((now) => ({ was: undefined, now })),
    };
  }

  return {
    whole: false,
    agents: movesOf(before.taskAgents, after.taskAgents, (row) => row.id),
    pullRequests: movesOf(before.agentPullRequests, after.agentPullRequests, (row) => row.agentId),
  };
}

const PARTS = Object.values(PULL_REQUEST_PART);

/** The parts asked again together as the pull request or its agent moves; the viewed marks move with its head alone, and the pickers' options with nothing. */
const MOVING = [
  PULL_REQUEST_PART.PULL_REQUEST,
  PULL_REQUEST_PART.CHECKS,
  PULL_REQUEST_PART.CONVERSATION,
  PULL_REQUEST_PART.PUBLISHED,
];

const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/** What the agent published as the service answers it: its pull request at `url`. */
function published(url: string, number: number) {
  return { repository: "acme/relay", branch: "agent/invite-once", pullRequest: line(url, number) };
}

/** What each agent published over a fake service, each ask written down by the agent, with the list's drawings handed through `draw`. */
function subject(failing: { failing: boolean } = { failing: false }) {
  return Effect.gen(function* () {
    const asked: string[] = [];
    const told: AppHeldById<AgentPullRequestAnswerView>[] = [];
    const drawings = yield* PubSub.unbounded<PullRequestListing>();

    const parts = yield* agentPullRequests({
      gate: () => true,
      focus: yield* windowFocus,
      ask: (agentId) =>
        Effect.sync(() => {
          asked.push(agentId);

          return failing.failing
            ? { failure: AGENT_CALL_FAILURE.UNANSWERED }
            : published(agentId === AGENT ? OWN : OTHER, agentId === AGENT ? 42 : 7);
        }),
      listings: Effect.map(PubSub.subscribe(drawings), Stream.fromSubscription),
      tell: (held) => void told.push(held),
    });

    let drawnBefore: ListDrawing | undefined;

    return {
      parts,
      asked,
      told,
      draw: (drawn: ListDrawing) =>
        Effect.suspend(() => {
          const listed = listingOf(drawnBefore, drawn);
          drawnBefore = drawn;

          return Effect.andThen(PubSub.publish(drawings, listed), settled);
        }),
    };
  });
}

it.effect(
  "what an agent published is asked again as the list's line for its pull request moves, a head moved by a push among it, and nothing is asked where nothing moved or another's line did",
  () =>
    Effect.gen(function* () {
      const { parts, asked, draw } = yield* subject();
      yield* parts.hold({ agentId: AGENT });
      yield* settled;
      yield* draw(listing());
      asked.length = 0;

      yield* draw(listing());
      yield* draw(listing({ other: { checks: CHECK_SUMMARY.PASSING } }));
      assert.deepEqual(asked, []);

      yield* draw(
        listing({ own: { headSha: "e4f5a6b" }, other: { checks: CHECK_SUMMARY.PASSING } }),
      );
      assert.deepEqual(asked, [AGENT]);
    }),
);

it.effect(
  "what an agent published is asked again as the agent's status moves, its end among it",
  () =>
    Effect.gen(function* () {
      const { parts, asked, draw } = yield* subject();
      yield* parts.hold({ agentId: AGENT });
      yield* settled;
      yield* draw(listing());
      asked.length = 0;

      yield* draw(listing({}, AGENT_STATUS.COMPLETED));

      assert.deepEqual(asked, [AGENT]);
    }),
);

it.effect(
  "what an agent published is asked again as the list first names a pull request it published, which is how a window drawing it from the list hears its branch",
  () =>
    Effect.gen(function* () {
      const { parts, asked, draw } = yield* subject();
      yield* parts.hold({ agentId: AGENT });
      yield* settled;
      const listed = listing();
      yield* draw({
        ...listed,
        agentPullRequests: listed.agentPullRequests.filter((each) => each.agentId !== AGENT),
      });
      asked.length = 0;

      yield* draw(listed);

      assert.deepEqual(asked, [AGENT]);
    }),
);

it.effect(
  "a read whose ask fails holds why until one answers, and an answer stands over a later failure",
  () =>
    Effect.gen(function* () {
      const failing = { failing: true };
      const { parts, told } = yield* subject(failing);

      yield* parts.hold({ agentId: AGENT });
      yield* settled;
      assert.deepEqual(told.at(-1), {
        [AGENT]: { rows: { failure: AGENT_CALL_FAILURE.UNANSWERED } },
      });

      failing.failing = false;
      yield* parts.retry({ agentId: AGENT });
      failing.failing = true;
      yield* parts.retry({ agentId: AGENT });

      assert.deepEqual(told.at(-1), { [AGENT]: { rows: published(OWN, 42) } });
    }),
);

const nextPoll = Effect.andThen(
  settled,
  Effect.andThen(TestClock.adjust(Duration.millis(500)), settled),
);

/** The pull request's row as GitHub's deliveries left it: the minute it last moved, and its head. */
const movedRow = (minute: number, headSha: string) => ({
  number: 42,
  headSha,
  movedAt: Date.UTC(2026, 10, 16, 12, minute),
});

/** One part's slice as the host tells it. */
type ToldPart = AppRepositoryPullRequestParts[keyof AppRepositoryPullRequestParts];

/** The pull request a window holds by its repository, in every part below. */
const HELD = { workspaceId: WORKSPACE, repository: "acme/relay", number: 42 } as const;

/** The parts of a pull request held by its repository over a fake service, each ask written down by its part, each part's telling kept by its read, its moves as `live` answers them, and each part in `failing` failing. */
function repositorySubject(failing: Set<PullRequestPart> = new Set()) {
  return Effect.gen(function* () {
    const asked: string[] = [];
    const told = new Map<string, ToldPart>();
    const live = polledLive(["moved"] as const);
    live.set({ moved: [movedRow(0, "a1b2c3d")] });

    const answering =
      <Answer>(part: PullRequestPart, answer: Answer) =>
      (_key: RepositoryPullRequestKey) =>
        Effect.sync(() => {
          asked.push(part);

          return failing.has(part) ? { failure: AGENT_CALL_FAILURE.UNANSWERED } : answer;
        });

    const telling = (read: string) => (held: ToldPart) => void told.set(read, held);

    const parts = yield* repositoryPullRequestParts({
      gate: () => true,
      focus: yield* windowFocus,
      ask: {
        pullRequest: answering(PULL_REQUEST_PART.PULL_REQUEST, overview(OWN, 42)),
        checks: answering(PULL_REQUEST_PART.CHECKS, { pullRequest: { checks: [] } }),
        conversation: answering(PULL_REQUEST_PART.CONVERSATION, {
          pullRequest: { reviewers: [], conversation: [], earlier: 0 },
        }),
        published: answering(PULL_REQUEST_PART.PUBLISHED, published(OWN, 42)),
        reviewOptions: answering(PULL_REQUEST_PART.REVIEW_OPTIONS, {
          labels: [],
          users: [],
          teams: [],
        }),
        viewed: answering(PULL_REQUEST_PART.VIEWED, {
          outcome: PULL_REQUEST_WRITE_OUTCOME.DONE,
          files: [],
        }),
      },
      moved: {
        seal: (_key, poll, _userId, after) =>
          poll ? live.poll(after) : Effect.succeed(live.first()),
        accountId: () => "user-reader",
      },
      tell: {
        [LIVE_READ.REPOSITORY_PULL_REQUEST]: telling(LIVE_READ.REPOSITORY_PULL_REQUEST),
        [LIVE_READ.REPOSITORY_PULL_REQUEST_CHECKS]: telling(
          LIVE_READ.REPOSITORY_PULL_REQUEST_CHECKS,
        ),
        [LIVE_READ.REPOSITORY_PULL_REQUEST_CONVERSATION]: telling(
          LIVE_READ.REPOSITORY_PULL_REQUEST_CONVERSATION,
        ),
        [LIVE_READ.REPOSITORY_PULL_REQUEST_PUBLISHED]: telling(
          LIVE_READ.REPOSITORY_PULL_REQUEST_PUBLISHED,
        ),
        [LIVE_READ.REPOSITORY_REVIEW_OPTIONS]: telling(LIVE_READ.REPOSITORY_REVIEW_OPTIONS),
        [LIVE_READ.REPOSITORY_PULL_REQUEST_VIEWED]: telling(
          LIVE_READ.REPOSITORY_PULL_REQUEST_VIEWED,
        ),
      },
    });

    return { parts, asked, told, live };
  });
}

it.effect(
  "a pull request held by its repository is asked again as GitHub says it moved, its viewed marks only as its head moved with it, and nothing at the first answer",
  () =>
    Effect.gen(function* () {
      const { parts, asked, live } = yield* repositorySubject();
      yield* Effect.forEach(PARTS, (part) => parts.hold({ part, ...HELD }));
      yield* nextPoll;
      asked.length = 0;

      live.set({ moved: [movedRow(5, "a1b2c3d")] });
      yield* nextPoll;
      assert.deepEqual(asked.toSorted(), MOVING.toSorted());

      asked.length = 0;
      live.set({ moved: [movedRow(9, "e4f5a6b")] });
      yield* nextPoll;
      assert.deepEqual(asked.toSorted(), [...MOVING, PULL_REQUEST_PART.VIEWED].toSorted());
    }),
);

it.effect(
  "the viewed marks hold every answer, so a read that fails after one landed takes the marks away",
  () =>
    Effect.gen(function* () {
      const failing = new Set<PullRequestPart>();
      const { parts, told } = yield* repositorySubject(failing);
      const key = { part: PULL_REQUEST_PART.VIEWED, ...HELD } as const;

      yield* parts.hold(key);
      yield* settled;
      failing.add(PULL_REQUEST_PART.VIEWED);
      yield* parts.retry(key);

      assert.deepEqual(told.get(LIVE_READ.REPOSITORY_PULL_REQUEST_VIEWED), {
        [WORKSPACE]: {
          "acme/relay": { "42": { rows: { failure: AGENT_CALL_FAILURE.UNANSWERED } } },
        },
      });
    }),
);
