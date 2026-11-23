/**
 * fixture-pull-requests.ts -- the pull requests the Inbox fixture's invitations agent opened, as the host holds their parts for a Pull request surface: one ready to merge with its checks green, one whose checks failed, and one second in its merge queue; and how a change made to one moves it.
 *
 * The Inbox fixture lays them on the document where the host holds a pull
 * request's parts by its repository (`LIVE_READ.REPOSITORY_PULL_REQUEST`,
 * its checks, its conversation), each under the fixture's workspace, the
 * agent's repository, and its number, so the iPhone's pull request screen
 * reads them as it reads a live run's. A fixture run asks GitHub nothing, so
 * a change a screen makes is answered as made (`fixture-inbox.ts`'s act
 * door) and handed back here as a move (`pullRequestMovedBy`), which the run
 * keeps and lays over the parts: merged, out of the merge queue, into it,
 * closed, reopened, or turned to a draft and back, and its title as it was
 * last edited. Every person, repository, and line here is invented.
 */

import {
  type AgentOverviewPullRequest,
  CHECK_STATE,
  CHECK_SUMMARY,
  type CheckState,
  CONVERSATION_ENTRY,
  type GitHubPerson,
  MERGE_STATE,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
  REVIEW_DECISION,
  REVIEW_STATE,
} from "@repo/features/agent-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import type {
  RepositoryOverviewChecksAnswerView,
  RepositoryOverviewConversationAnswerView,
  RepositoryOverviewPullRequestAnswerView,
} from "@repo/features/pull-request-view";
import {
  MERGE_METHOD,
  PULL_REQUEST_ACTION,
  type PullRequestActionRequest,
} from "@repo/features/pull-request-write-wire";
import type { AppRepositoryPullRequestHeld, AppStateSnapshot } from "./app-state.js";
import { FIXTURE_IDS } from "./fixture-stage.js";

/** The repository the invitations agent the Inbox fixture stages works in (`fixture-inbox.ts`), in the fixture's workspace. */
const REPOSITORY = "ada/relay";

const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** When the fixture's chunk landed, which every instant here is counted back from. */
const LANDED = Date.now();

const ADA: GitHubPerson = { login: "ada", bot: false };
const GRACE: GitHubPerson = { login: "grace", bot: false };
const LINUS: GitHubPerson = { login: "linus", bot: false };
const REVIEW_BOT: GitHubPerson = { login: "relay-review[bot]", bot: true };

/** The pull requests, by their numbers. */
export const FIXTURE_PULL_REQUEST = {
  /** Open, its checks green and approved, ready to merge at once. */
  READY: 128,
  /** Open, a check failed and another still running, changes asked for. */
  FAILING: 127,
  /** Open, its checks green and approved, second in the merge queue. */
  QUEUED: 126,
} as const;

/** How a change a screen made moved a pull request. */
export const PULL_REQUEST_MOVE = {
  MERGED: "merged",
  DEQUEUED: "dequeued",
  QUEUED: "queued",
  CLOSED: "closed",
  REOPENED: "reopened",
  READY: "ready",
  DRAFTED: "drafted",
} as const;

export type PullRequestMove = (typeof PULL_REQUEST_MOVE)[keyof typeof PULL_REQUEST_MOVE];

/** What a fixture run's changes left of one pull request: the last move of where it stands, and the title it was last given. */
export interface PullRequestMoved {
  readonly move?: PullRequestMove | undefined;
  readonly title?: string | undefined;
}

/** What a fixture run's changes left, by the pull request's number. */
export type PullRequestMoves = ReadonlyMap<number, PullRequestMoved>;

/** How a change moves where its pull request stands, as GitHub would take it; none for a change that moves no state. */
function pullRequestMoveOf(request: PullRequestActionRequest): PullRequestMove | undefined {
  switch (request.action) {
    case PULL_REQUEST_ACTION.MERGE:
      return PULL_REQUEST_MOVE.MERGED;
    case PULL_REQUEST_ACTION.DEQUEUE:
      return PULL_REQUEST_MOVE.DEQUEUED;
    case PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE:
      return PULL_REQUEST_MOVE.QUEUED;
    case PULL_REQUEST_ACTION.CLOSE:
      return PULL_REQUEST_MOVE.CLOSED;
    case PULL_REQUEST_ACTION.REOPEN:
      return PULL_REQUEST_MOVE.REOPENED;
    case PULL_REQUEST_ACTION.READY_FOR_REVIEW:
      return PULL_REQUEST_MOVE.READY;
    case PULL_REQUEST_ACTION.CONVERT_TO_DRAFT:
      return PULL_REQUEST_MOVE.DRAFTED;
    default:
      return undefined;
  }
}

/** What `moved` becomes once `request` lands, as GitHub would take it: a new title kept, or where it stands moved; none for a change that moves nothing a screen draws. */
export function pullRequestMovedBy(
  moved: PullRequestMoved | undefined,
  request: PullRequestActionRequest,
): PullRequestMoved | undefined {
  if (request.action === PULL_REQUEST_ACTION.EDIT_TITLE) return { ...moved, title: request.title };
  const move = pullRequestMoveOf(request);

  return move === undefined ? undefined : { ...moved, move };
}

/** One check, begun `ago` before the fixture landed and run for `ran`; one still running has run for none. */
function check(name: string, state: CheckState, ago: number, ran: number): PullRequestCheck {
  const startedAt = LANDED - ago;

  return {
    name,
    app: "GitHub Actions",
    state,
    url: `${REPOSITORY_URL}/actions/runs/${name}`,
    startedAt,
    completedAt: state === CHECK_STATE.PENDING ? null : startedAt + ran,
  };
}

/** A pull request with no description, as GitHub answers one: both forms empty. */
const NO_DESCRIPTION = { body: "", html: "" } as const;

/** A pull request as its own read answers it, open, before any move. */
function pullRequestOf(
  number: number,
  title: string,
  head: string,
  standing: Pick<AgentOverviewPullRequest, "merge" | "merging" | "requested"> &
    Partial<Pick<AgentOverviewPullRequest, "labels">>,
  description: Pick<AgentOverviewPullRequest, "body" | "html"> = NO_DESCRIPTION,
): AgentOverviewPullRequest {
  return {
    number,
    title,
    url: `${REPOSITORY_URL}/pull/${number}`,
    state: PULL_REQUEST_STATE.OPEN,
    ...description,
    base: "main",
    head,
    createdAt: LANDED - 3 * HOUR,
    mergedAt: null,
    author: ADA,
    labels: [],
    ...standing,
  };
}

/** The ready pull request's description, as its agent wrote it and as GitHub renders it, so its page draws one. */
const READY_DESCRIPTION = {
  body: [
    "Adds **Invite by email** to Settings › Members, which sends the invitation through Resend.",
    "",
    "- Checks the address before it sends",
    "- Shows the invitation as pending until it's accepted",
  ].join("\n"),
  html: [
    "<p>Adds <strong>Invite by email</strong> to Settings › Members, which sends the invitation through Resend.</p>",
    "<ul><li>Checks the address before it sends</li><li>Shows the invitation as pending until it's accepted</li></ul>",
  ].join("\n"),
} as const;

const READY = pullRequestOf(
  FIXTURE_PULL_REQUEST.READY,
  "Invite a teammate by email",
  "agent/invites",
  {
    merge: MERGE_STATE.CLEAN,
    requested: [],
    // Note that its labels run from a light fill to a dark one, so a shot shows each kind of words, dark and white.
    labels: [
      { name: "enhancement", color: "a2eeef" },
      { name: "invites", color: "1d76db" },
      { name: "needs design", color: "1d1d1f" },
    ],
    merging: {
      methods: [MERGE_METHOD.SQUASH, MERGE_METHOD.MERGE],
      autoMergeAllowed: true,
      queue: false,
      queued: null,
      autoMerge: null,
      headSha: "4f1c2d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e",
      review: REVIEW_DECISION.APPROVED,
      checks: CHECK_SUMMARY.PASSING,
    },
  },
  READY_DESCRIPTION,
);

const FAILING = pullRequestOf(
  FIXTURE_PULL_REQUEST.FAILING,
  "Expire an invite after seven days",
  "agent/invite-expiry",
  {
    merge: MERGE_STATE.BLOCKED,
    requested: [LINUS],
    merging: {
      methods: [MERGE_METHOD.SQUASH, MERGE_METHOD.MERGE],
      autoMergeAllowed: true,
      queue: false,
      queued: null,
      autoMerge: null,
      headSha: "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b",
      review: REVIEW_DECISION.CHANGES_REQUESTED,
      checks: CHECK_SUMMARY.FAILING,
    },
  },
);

const QUEUED = pullRequestOf(
  FIXTURE_PULL_REQUEST.QUEUED,
  "Send the invite email from the workspace",
  "agent/invite-email",
  {
    merge: MERGE_STATE.CLEAN,
    requested: [],
    merging: {
      methods: [MERGE_METHOD.SQUASH],
      autoMergeAllowed: true,
      queue: true,
      queued: { position: 2 },
      autoMerge: null,
      headSha: "1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c",
      review: REVIEW_DECISION.APPROVED,
      checks: CHECK_SUMMARY.PASSING,
    },
  },
);

/** The checks each ran, failed first and then running, as the service lists them. */
const CHECKS: ReadonlyMap<number, readonly PullRequestCheck[]> = new Map([
  [
    FIXTURE_PULL_REQUEST.READY,
    [
      check("build", CHECK_STATE.PASSED, 40 * MINUTE, 2 * MINUTE),
      check("lint", CHECK_STATE.PASSED, 40 * MINUTE, MINUTE),
      check("typecheck", CHECK_STATE.PASSED, 40 * MINUTE, 3 * MINUTE),
      check("test", CHECK_STATE.PASSED, 40 * MINUTE, 5 * MINUTE),
      check("bench", CHECK_STATE.SKIPPED, 40 * MINUTE, 0),
    ],
  ],
  [
    FIXTURE_PULL_REQUEST.FAILING,
    [
      check("test", CHECK_STATE.FAILED, 25 * MINUTE, 4 * MINUTE),
      check("e2e", CHECK_STATE.PENDING, 6 * MINUTE, 0),
      check("build", CHECK_STATE.PASSED, 25 * MINUTE, 2 * MINUTE),
      check("lint", CHECK_STATE.PASSED, 25 * MINUTE, MINUTE),
      check("typecheck", CHECK_STATE.PASSED, 25 * MINUTE, 3 * MINUTE),
    ],
  ],
  [
    FIXTURE_PULL_REQUEST.QUEUED,
    [
      check("build", CHECK_STATE.PASSED, 2 * HOUR, 2 * MINUTE),
      check("lint", CHECK_STATE.PASSED, 2 * HOUR, MINUTE),
      check("typecheck", CHECK_STATE.PASSED, 2 * HOUR, 3 * MINUTE),
      check("test", CHECK_STATE.PASSED, 2 * HOUR, 6 * MINUTE),
    ],
  ],
]);

/** A comment or a review on one of them, `ago` before the fixture landed. */
function entry(
  number: number,
  by: GitHubPerson,
  body: string,
  ago: number,
  state?: (typeof REVIEW_STATE)[keyof typeof REVIEW_STATE],
) {
  const url = `${REPOSITORY_URL}/pull/${number}#${state === undefined ? "issuecomment" : "pullrequestreview"}-${ago}`;
  const at = LANDED - ago;

  return state === undefined
    ? { kind: CONVERSATION_ENTRY.COMMENT, by, html: `<p>${body}</p>`, body, at, url }
    : { kind: CONVERSATION_ENTRY.REVIEW, by, state, html: `<p>${body}</p>`, body, at, url };
}

/** Each one's conversation: where its reviewers stand, and its comments and reviews, oldest first. */
const CONVERSATIONS: ReadonlyMap<number, RepositoryOverviewConversationAnswerView> = new Map([
  [
    FIXTURE_PULL_REQUEST.READY,
    {
      pullRequest: {
        reviewers: [
          { by: GRACE, state: REVIEW_STATE.APPROVED },
          { by: REVIEW_BOT, state: REVIEW_STATE.COMMENTED },
        ],
        conversation: [
          entry(
            128,
            REVIEW_BOT,
            "One note on the expiry check; the rest reads well.",
            30 * MINUTE,
            REVIEW_STATE.COMMENTED,
          ),
          entry(
            128,
            GRACE,
            "Reusing memberships keeps removal simple. Ship it.",
            20 * MINUTE,
            REVIEW_STATE.APPROVED,
          ),
          entry(128, ADA, "Thanks, merging once CI is green.", 10 * MINUTE),
        ],
        earlier: 0,
      },
    },
  ],
  [
    FIXTURE_PULL_REQUEST.FAILING,
    {
      pullRequest: {
        reviewers: [{ by: GRACE, state: REVIEW_STATE.CHANGES_REQUESTED }],
        conversation: [
          entry(
            127,
            GRACE,
            "An invite made just under seven days ago expires mid-accept.",
            15 * MINUTE,
            REVIEW_STATE.CHANGES_REQUESTED,
          ),
        ],
        earlier: 0,
      },
    },
  ],
  [
    FIXTURE_PULL_REQUEST.QUEUED,
    {
      pullRequest: {
        reviewers: [
          { by: GRACE, state: REVIEW_STATE.APPROVED },
          { by: LINUS, state: REVIEW_STATE.APPROVED },
        ],
        conversation: [
          entry(126, LINUS, "Looks good.", 90 * MINUTE, REVIEW_STATE.APPROVED),
          entry(126, GRACE, "Approved.", 80 * MINUTE, REVIEW_STATE.APPROVED),
          entry(126, ADA, "Queued.", 70 * MINUTE),
        ],
        earlier: 2,
      },
    },
  ],
]);

/** A pull request under the title it was last given, where it was given one, as `movedState` leaves where it stands. */
function moved(
  pullRequest: AgentOverviewPullRequest,
  changes: PullRequestMoved | undefined,
): AgentOverviewPullRequest {
  const stands = movedState(pullRequest, changes?.move);

  return changes?.title === undefined ? stands : { ...stands, title: changes.title };
}

/** A pull request as a move left it: merged, out of the queue and ready to queue again, into the queue last, closed and out of the queue, open again and still out of it, since GitHub never queues a reopened one again, or a draft and open again. */
function movedState(
  pullRequest: AgentOverviewPullRequest,
  move: PullRequestMove | undefined,
): AgentOverviewPullRequest {
  const { merging } = pullRequest;

  if (move === undefined || merging === undefined) return pullRequest;

  switch (move) {
    case PULL_REQUEST_MOVE.MERGED:
      return { ...pullRequest, state: PULL_REQUEST_STATE.MERGED, mergedAt: LANDED };
    case PULL_REQUEST_MOVE.DEQUEUED:
      return { ...pullRequest, merging: { ...merging, queued: null } };
    case PULL_REQUEST_MOVE.QUEUED:
      return { ...pullRequest, merging: { ...merging, queued: { position: 3 } } };
    case PULL_REQUEST_MOVE.CLOSED:
      return {
        ...pullRequest,
        state: PULL_REQUEST_STATE.CLOSED,
        merging: { ...merging, queued: null },
      };
    case PULL_REQUEST_MOVE.REOPENED:
    case PULL_REQUEST_MOVE.READY:
      return {
        ...pullRequest,
        state: PULL_REQUEST_STATE.OPEN,
        merging: { ...merging, queued: null },
      };
    case PULL_REQUEST_MOVE.DRAFTED:
      return { ...pullRequest, state: PULL_REQUEST_STATE.DRAFT };
  }
}

/** One slice's reads as last laid, by the read the host held, with the moves laid over it. */
type LaidReads = WeakMap<object, { readonly moves: PullRequestMoves; readonly staged: object }>;

/**
 * Each slice's reads as last laid, so laying the same again hands the store
 * the very object it holds. Note that each slice keeps its own, because a
 * launch holds every part on one shared empty slice (`NO_KEYS_HELD`), which
 * one cache would answer with the first part laid over it for all three.
 */
const LAID = {
  [LIVE_READ.REPOSITORY_PULL_REQUEST]: new WeakMap(),
  [LIVE_READ.REPOSITORY_PULL_REQUEST_CHECKS]: new WeakMap(),
  [LIVE_READ.REPOSITORY_PULL_REQUEST_CONVERSATION]: new WeakMap(),
} as const satisfies Record<string, LaidReads>;

/** Every part held of one read, its staged pull requests laid over the repository's in the fixture's workspace. */
function laid<Part>(
  cache: LaidReads,
  held: AppRepositoryPullRequestHeld<Part>,
  moves: PullRequestMoves,
  parts: () => ReadonlyMap<number, Part>,
): AppRepositoryPullRequestHeld<Part> {
  const kept = cache.get(held);

  if (kept?.moves === moves) {
    // SAFETY: a read's entry is only ever written below, from that same read.
    return kept.staged as AppRepositoryPullRequestHeld<Part>;
  }

  const rows = Object.fromEntries(
    [...parts()].map(([number, each]) => [String(number), { rows: each }]),
  );

  const workspace = held[FIXTURE_IDS.WORKSPACE];

  const staged = {
    ...held,
    [FIXTURE_IDS.WORKSPACE]: {
      ...workspace,
      [REPOSITORY]: { ...workspace?.[REPOSITORY], ...rows },
    },
  };

  cache.set(held, { moves, staged });

  return staged;
}

/**
 * The document with the invitations agent's pull requests' parts, by their repository, laid over
 * the host's, each as `moves` left it, so a fixture run's screen reads them
 * as the host would hold them read.
 */
export function pullRequestPartsAppState(
  state: AppStateSnapshot,
  moves: PullRequestMoves,
): AppStateSnapshot {
  const pullRequests = () =>
    new Map<number, RepositoryOverviewPullRequestAnswerView>(
      [READY, FAILING, QUEUED].map((each) => [
        each.number,
        { pullRequest: moved(each, moves.get(each.number)) },
      ]),
    );

  const checks = () =>
    new Map<number, RepositoryOverviewChecksAnswerView>(
      [...CHECKS].map(([number, each]) => [number, { pullRequest: { checks: each } }]),
    );

  return {
    ...state,
    [LIVE_READ.REPOSITORY_PULL_REQUEST]: laid(
      LAID[LIVE_READ.REPOSITORY_PULL_REQUEST],
      state[LIVE_READ.REPOSITORY_PULL_REQUEST],
      moves,
      pullRequests,
    ),
    [LIVE_READ.REPOSITORY_PULL_REQUEST_CHECKS]: laid(
      LAID[LIVE_READ.REPOSITORY_PULL_REQUEST_CHECKS],
      state[LIVE_READ.REPOSITORY_PULL_REQUEST_CHECKS],
      moves,
      checks,
    ),
    [LIVE_READ.REPOSITORY_PULL_REQUEST_CONVERSATION]: laid(
      LAID[LIVE_READ.REPOSITORY_PULL_REQUEST_CONVERSATION],
      state[LIVE_READ.REPOSITORY_PULL_REQUEST_CONVERSATION],
      moves,
      () => CONVERSATIONS,
    ),
  };
}
