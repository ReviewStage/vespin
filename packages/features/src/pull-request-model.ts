import { AGENT_CALL_FAILURE, type AgentPullRequestWriteAnswerView } from "./agent-view.js";
import {
  type AgentOverviewConversation,
  type AgentOverviewPullRequest,
  CHANGES_BOUNDS,
  CHECK_STATE,
  CHECK_SUMMARY,
  type CheckState,
  type CheckSummary,
  MERGE_STATE,
  type MergeState,
  PULL_REQUEST_STATE,
  type PullRequestCheck,
  type PullRequestMerging,
  type PullRequestReviewer,
  type PullRequestState,
  REVIEW_DECISION,
  REVIEW_STATE,
  type ReviewState,
} from "./agent-wire.js";
import { saidWords } from "./integration-health.js";
import {
  MERGE_METHOD,
  type MergeMethod,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestAction,
} from "./pull-request-write-wire.js";

/**
 * pull-request-model.ts -- an agent's pull request as every client's Pull request surface reads it: where it stands in a word, what its merge control offers and says, how its checks went, and who reviewed it.
 *
 * The panel's Pull request tab (`@repo/panel`'s `merge-box.tsx` and
 * `agent-pull-request-tab.tsx`) and the iPhone's pull request screen draw
 * the same pull request from the same three reads (the pull request, its
 * checks, its conversation), so what each offers and says is decided here
 * once, and each draws it its own way.
 *
 * The merge control offers the one press that may be made from where the
 * pull request stands (`mergeActionFor`), as stage-cli's merge status does:
 * ready to merge, the method chosen as its words ("Squash and merge"),
 * merging at once; on a base merged through a merge queue, Merge when
 * ready, which turns auto-merge on with no method, so GitHub queues it once
 * it is ready, as `gh pr merge --auto` does; with checks still running and
 * auto-merge allowed, Enable auto-merge; with auto-merge on, Disable
 * auto-merge; in the merge queue, Remove from queue, which asks first,
 * since leaving the queue may hold up the pull requests behind it; and,
 * blocked by a rule or behind its base with nothing else to offer, for a
 * member GitHub lets merge past the base's rules as it lets an admin
 * (`canBypassRules`, read on their own sign-in), Bypass rules and merge…,
 * which asks first, naming what it bypasses (`bypassSentence`).
 */

/** Where a pull request stands, in the word its pill and its row say. */
export const PULL_REQUEST_STATE_LABEL = {
  [PULL_REQUEST_STATE.OPEN]: "Open",
  [PULL_REQUEST_STATE.DRAFT]: "Draft",
  [PULL_REQUEST_STATE.MERGED]: "Merged",
  [PULL_REQUEST_STATE.CLOSED]: "Closed",
} as const satisfies Record<PullRequestState, string>;

/** What a mark is drawn for beyond where a pull request stands: an open one in the merge queue. */
export const PULL_REQUEST_MARK_QUEUED = "queued";

/** What a pull request's mark is drawn for: where it stands, or queued. */
export type PullRequestMarkState = PullRequestState | typeof PULL_REQUEST_MARK_QUEUED;

/** Where a pull request's mark says it stands, on the panel and the iPhone alike: queued where it is open and the merge queue holds it, else where it stands. */
export function pullRequestMarkState(pullRequest: {
  readonly state: PullRequestState;
  readonly queued?: boolean | undefined;
}): PullRequestMarkState {
  return pullRequest.queued === true && pullRequest.state === PULL_REQUEST_STATE.OPEN
    ? PULL_REQUEST_MARK_QUEUED
    : pullRequest.state;
}

/** What the row says of an open pull request GitHub's merge queue holds, as its tab's pill says it. */
export const QUEUED_LABEL = "Queued";

/** Where a pull request's mark says it stands, in the word a row is heard by: Queued for an open one the merge queue holds, else its state's word. */
export function pullRequestMarkLabel(pullRequest: {
  readonly state: PullRequestState;
  readonly queued?: boolean | undefined;
}): string {
  const mark = pullRequestMarkState(pullRequest);

  return mark === PULL_REQUEST_MARK_QUEUED ? QUEUED_LABEL : PULL_REQUEST_STATE_LABEL[mark];
}

/** How a pull request the merge queue holds is said where its place is known: "Queued #3", else "Queued". */
export function queuedLabel(position: number | undefined): string {
  return position === undefined ? QUEUED_LABEL : `${QUEUED_LABEL} #${position}`;
}

/** What leaving GitHub's merge queue costs the pull requests behind it, said as Remove from queue and a queued Close each ask. */
export const QUEUE_WARNING =
  "Removing this pull request from the queue could impact other pull requests in the queue.";

/** Where a reviewer stands, in the words their face's pill, a comment's line, and their row say it. */
export const REVIEW_WORDS = {
  [REVIEW_STATE.APPROVED]: "Approved",
  [REVIEW_STATE.CHANGES_REQUESTED]: "Changes requested",
  [REVIEW_STATE.DISMISSED]: "Dismissed",
  [REVIEW_STATE.COMMENTED]: "Commented",
  [REVIEW_STATE.REQUESTED]: "Review requested",
} as const satisfies Record<ReviewState, string>;

/* ----- The merge control ----- */

/** What the control offers from where the pull request stands. */
export const MERGE_ACTION = {
  MERGE: "merge",
  MERGE_WHEN_READY: "merge-when-ready",
  ENABLE_AUTO_MERGE: "enable-auto-merge",
  DISABLE_AUTO_MERGE: "disable-auto-merge",
  DEQUEUE: "dequeue",
  BYPASS: "bypass",
} as const;

export type MergeAction = (typeof MERGE_ACTION)[keyof typeof MERGE_ACTION];

/** Each method as the press says it, as GitHub's own merge button does. */
export const MERGE_PRESS_WORDS = {
  [MERGE_METHOD.MERGE]: "Merge pull request",
  [MERGE_METHOD.SQUASH]: "Squash and merge",
  [MERGE_METHOD.REBASE]: "Rebase and merge",
} as const satisfies Record<MergeMethod, string>;

/** Each method as the chooser offers it, as GitHub's own does. */
export const MERGE_METHOD_WORDS = {
  [MERGE_METHOD.MERGE]: "Create a merge commit",
  [MERGE_METHOD.SQUASH]: "Squash and merge",
  [MERGE_METHOD.REBASE]: "Rebase and merge",
} as const satisfies Record<MergeMethod, string>;

/** Each method's word where it says how auto-merge will merge. */
const METHOD_NOUNS = {
  [MERGE_METHOD.MERGE]: "merge commit",
  [MERGE_METHOD.SQUASH]: "squash",
  [MERGE_METHOD.REBASE]: "rebase",
} as const satisfies Record<MergeMethod, string>;

/** The control's own words. */
export const MERGE_WORDS = {
  MERGE_WHEN_READY: "Merge when ready",
  ENABLE_AUTO_MERGE: "Enable auto-merge",
  DISABLE_AUTO_MERGE: "Disable auto-merge",
  DEQUEUE: "Remove from queue",
  /** What Remove from queue asks first. */
  DEQUEUE_QUESTION: "Remove from the merge queue?",
  BYPASS: "Bypass rules and merge",
  /** What Bypass rules and merge asks first. */
  BYPASS_QUESTION: "Merge without waiting for requirements?",
  CHOOSE_METHOD: "Choose how to merge",
  autoMerge: (method: MergeMethod | null) =>
    method === null ? "Auto-merge is on" : `Auto-merge is on (${METHOD_NOUNS[method]})`,
} as const;

/** What the press says while a change it sent is out. */
export const MERGE_BUSY_WORDS = {
  [PULL_REQUEST_ACTION.MERGE]: "Merging",
  [PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE]: "Turning on auto-merge",
  [PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE]: "Turning off auto-merge",
  [PULL_REQUEST_ACTION.DEQUEUE]: "Removing from queue",
} as const;

/** The changes the control sends, whose answer it waits on busy. */
export type MergeWrite = keyof typeof MERGE_BUSY_WORDS;

export function isMergeWrite(action: PullRequestAction | undefined): action is MergeWrite {
  return action !== undefined && action in MERGE_BUSY_WORDS;
}

/** The states GitHub would merge in now: ready, or with checks nothing requires short of passing. */
const MERGEABLE: ReadonlySet<MergeState> = new Set([MERGE_STATE.CLEAN, MERGE_STATE.UNSTABLE]);

/** The states a member GitHub lets bypass the base's rules may merge in past them: held by a required review or check, or behind a base that must be merged in first. */
const BYPASSABLE: ReadonlySet<MergeState> = new Set([MERGE_STATE.BLOCKED, MERGE_STATE.BEHIND]);

/**
 * The one thing the control offers from where the pull request stands, or
 * nothing. Note that the bypass is offered only where nothing else would be,
 * so a member who may bypass still turns auto-merge on while checks run, and
 * a base merged through a queue still queues.
 */
function mergeActionOf(
  merge: MergeState,
  merging: PullRequestMerging,
  canBypassRules: boolean,
): MergeAction | undefined {
  if (merging.queued !== null) return MERGE_ACTION.DEQUEUE;

  if (merging.autoMerge !== null) return MERGE_ACTION.DISABLE_AUTO_MERGE;

  if (merge === MERGE_STATE.CONFLICTS || merge === MERGE_STATE.DRAFT) return undefined;

  if (merging.queue) return MERGE_ACTION.MERGE_WHEN_READY;

  if (merging.methods.length === 0) return undefined;

  if (MERGEABLE.has(merge)) return MERGE_ACTION.MERGE;
  const waiting = merging.checks === CHECK_SUMMARY.PENDING;

  if (merging.autoMergeAllowed && waiting) return MERGE_ACTION.ENABLE_AUTO_MERGE;

  return canBypassRules && BYPASSABLE.has(merge) ? MERGE_ACTION.BYPASS : undefined;
}

/** The press a pull request offers as it stands: none for one not open, or whose merge read has not landed. */
export function mergeActionFor(pullRequest: AgentOverviewPullRequest): MergeAction | undefined {
  const { merging } = pullRequest;

  if (merging === undefined || pullRequest.state !== PULL_REQUEST_STATE.OPEN) return undefined;

  return mergeActionOf(pullRequest.merge, merging, pullRequest.canBypassRules === true);
}

/** Whether a pull request may still merge: open, or a draft. */
export function isLivePullRequest(pullRequest: AgentOverviewPullRequest): boolean {
  return (
    pullRequest.state === PULL_REQUEST_STATE.OPEN || pullRequest.state === PULL_REQUEST_STATE.DRAFT
  );
}

/** What a merge held up by its reviews leaves the reader, where no press stands in its place. */
const HELD_WORDS = ", so it can't be merged yet";

/**
 * What a merge GitHub says is blocked waits on, where the reviews or checks
 * say; none where neither does. Where its reviews hold it up and no press
 * stands (`held`), it says too that it can't be merged, so a reader shown no
 * merge press is told why there is none.
 */
function blockedWords(merging: PullRequestMerging | undefined, held: boolean): string | undefined {
  if (merging === undefined) return undefined;
  const plain = (words: string) => (held ? `${words}${HELD_WORDS}` : words);

  if (merging.review === REVIEW_DECISION.CHANGES_REQUESTED) return plain("Changes were requested");

  if (merging.review === REVIEW_DECISION.REVIEW_REQUIRED) {
    return plain("A required review is missing");
  }

  if (merging.checks === CHECK_SUMMARY.PENDING) return "Waiting on required checks";

  if (merging.checks === CHECK_SUMMARY.FAILING) return "Required checks are failing";

  return undefined;
}

/** Whether the pull request would merge as it stands, as GitHub's own box under a pull request says it, its base named where it matters. */
function mergeWords(merge: MergeState, base: string): string {
  switch (merge) {
    case MERGE_STATE.CLEAN:
      return "Ready to merge";
    case MERGE_STATE.UNSTABLE:
      return "Can merge, though some checks are not passing";
    case MERGE_STATE.BLOCKED:
      return "Merging is blocked by a required review or check";
    case MERGE_STATE.BEHIND:
      return `Behind ${base}; it must be brought up to date`;
    case MERGE_STATE.CONFLICTS:
      return `Conflicts with ${base}`;
    case MERGE_STATE.DRAFT:
      return "A draft; mark it ready for review to merge";
    case MERGE_STATE.UNKNOWN:
      return "GitHub is still checking whether it merges";
  }
}

/**
 * GitHub's whole sentence for the merge: what it waits on, or where the
 * queue or auto-merge has it, then the mergeability beside it where that
 * says something else; where its reviews hold it up and no press is
 * offered (`action`), that it can't be merged yet.
 */
export function mergeSentence(
  pullRequest: AgentOverviewPullRequest,
  action: MergeAction | undefined,
): string {
  const { merge, merging } = pullRequest;
  const line = mergeWords(merge, pullRequest.base);
  const blocked = merge === MERGE_STATE.BLOCKED;
  const standing = (blocked ? blockedWords(merging, action === undefined) : undefined) ?? line;
  const queued = merging?.queued ?? null;
  const autoMerge = merging?.autoMerge ?? null;

  const lead =
    queued !== null
      ? queuedLabel(queued.position)
      : autoMerge !== null
        ? MERGE_WORDS.autoMerge(autoMerge.method)
        : undefined;

  return lead === undefined ? standing : `${lead}. ${standing}`;
}

/** What Bypass rules and merge asks first: what it bypasses, in GitHub's sentence for the merge, and how and where it merges. */
export function bypassSentence(pullRequest: AgentOverviewPullRequest, method: MergeMethod): string {
  const { base } = pullRequest;

  return `${mergeSentence(pullRequest, MERGE_ACTION.BYPASS)}. This merges it into ${base} now by ${METHOD_NOUNS[method]}, as you on GitHub, bypassing the rules ${base} requires.`;
}

/* ----- The checks ----- */

/** Where a check stands, in the words its glyph says to a reader who cannot see it and the count says. */
export const CHECK_WORDS = {
  [CHECK_STATE.FAILED]: "failed",
  [CHECK_STATE.PENDING]: "running",
  [CHECK_STATE.PASSED]: "passed",
  [CHECK_STATE.SKIPPED]: "skipped",
} as const satisfies Record<CheckState, string>;

/** How the checks went as one word, which the Checks tab's glyph, a pull request's card, and its mark each say to a reader. */
export const CHECK_SUMMARY_WORDS = {
  [CHECK_SUMMARY.FAILING]: "failing",
  [CHECK_SUMMARY.PENDING]: "running",
  [CHECK_SUMMARY.PASSING]: "passing",
  [CHECK_SUMMARY.NONE]: "none",
} as const satisfies Record<CheckSummary, string>;

/** The checks as one word, as the pull request's mark wears it: a failure beats a wait beats a pass. */
export function checksSummaryOf(checks: readonly PullRequestCheck[]): CheckSummary {
  if (checks.some((check) => check.state === CHECK_STATE.FAILED)) return CHECK_SUMMARY.FAILING;

  if (checks.some((check) => check.state === CHECK_STATE.PENDING)) return CHECK_SUMMARY.PENDING;

  return checks.length === 0 ? CHECK_SUMMARY.NONE : CHECK_SUMMARY.PASSING;
}

/** How many checks the checks' count says: those that failed beside a failure, those still running beside a wait, and every one where all passed. */
export function checksCountOf(checks: readonly PullRequestCheck[], summary: CheckSummary): number {
  if (summary === CHECK_SUMMARY.FAILING) {
    return checks.filter((check) => check.state === CHECK_STATE.FAILED).length;
  }

  if (summary === CHECK_SUMMARY.PENDING) {
    return checks.filter((check) => check.state === CHECK_STATE.PENDING).length;
  }

  return checks.length;
}

/* ----- The reviews ----- */

/**
 * Who the pull request names as its reviewers, as stage-cli's header names
 * them: where each stands by their reviews, as its conversation's read
 * says, with those it still asks for a review, as its own read says,
 * standing asked whatever they said before, as GitHub shows a re-requested
 * reviewer, save one whose changes asked for still stand; its author left
 * out, and Apps' bots after the people; up to the bound. Until the reviews
 * land, those it asks stand asked.
 */
export function reviewersOf(
  requested: readonly AgentOverviewPullRequest["requested"][number][],
  standings: readonly PullRequestReviewer[],
  author: string | undefined,
): readonly PullRequestReviewer[] {
  const by = new Map<string, PullRequestReviewer>();

  for (const reviewer of standings) by.set(reviewer.by.login, reviewer);

  for (const person of requested) {
    if (by.get(person.login)?.state === REVIEW_STATE.CHANGES_REQUESTED) continue;
    by.set(person.login, { by: person, state: REVIEW_STATE.REQUESTED });
  }

  const named = [...by.values()].filter((reviewer) => reviewer.by.login !== author);

  return [
    ...named.filter((reviewer) => !reviewer.by.bot),
    ...named.filter((reviewer) => reviewer.by.bot),
  ].slice(0, CHANGES_BOUNDS.MAX_PEOPLE);
}

/** How many comments a pull request's conversation holds: its entries, the review threads on its lines, and those a read left on GitHub. */
export function conversationCount(conversation: AgentOverviewConversation): number {
  const threads = conversation.conversation.reduce(
    (sum, entry) => sum + (entry.threads?.length ?? 0),
    0,
  );

  return conversation.earlier + conversation.conversation.length + threads;
}

/* ----- A change's answer ----- */

/** What a surface says of a change GitHub did not make. */
export const PULL_REQUEST_WRITE_WORDS = {
  SIGN_IN: "Sign in with GitHub to make this change as you.",
  /** Our sentence on a change GitHub refused, which GitHub's own words follow on a line of their own. */
  REFUSED: "GitHub refused this change.",
  /** Who said the words quoted under a refusal. */
  SOURCE: "GitHub",
  NOT_FOUND: "This pull request can no longer be found.",
  UNREACHED: "GitHub could not be reached. Try again in a moment.",
} as const;

/**
 * What a surface says of a change's answer where GitHub did not make it:
 * our sentence, and GitHub's own words quoted under it where it refused;
 * none where it made it. A repository out of the workspace's reach is said
 * as any other answer the service could not give, where a surface offers
 * nothing that mends it.
 */
export function pullRequestWriteWords(
  answer: AgentPullRequestWriteAnswerView,
): { readonly words: string; readonly said?: string } | undefined {
  if ("failure" in answer) {
    return {
      words:
        answer.failure === AGENT_CALL_FAILURE.NOT_FOUND
          ? PULL_REQUEST_WRITE_WORDS.NOT_FOUND
          : PULL_REQUEST_WRITE_WORDS.UNREACHED,
    };
  }

  switch (answer.outcome) {
    case PULL_REQUEST_WRITE_OUTCOME.DONE:
      return undefined;
    case PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED:
      return { words: PULL_REQUEST_WRITE_WORDS.SIGN_IN };
    case PULL_REQUEST_WRITE_OUTCOME.REFUSED:
      return {
        words: PULL_REQUEST_WRITE_WORDS.REFUSED,
        said: saidWords(PULL_REQUEST_WRITE_WORDS.SOURCE, answer.words),
      };
  }
}

/* ----- A read's words ----- */

/** What a Pull request surface says while a part is read, where it could not be, and where it holds nothing. */
export const PULL_REQUEST_READ_WORDS = {
  READING: "Reading pull request",
  READING_CHECKS: "Reading checks",
  READING_CONVERSATION: "Reading conversation",
  FAILED: "The pull request could not be read.",
  CHECKS_FAILED: "The checks could not be read.",
  CONVERSATION_FAILED: "The conversation could not be read.",
  NO_PULL_REQUEST: "No pull request yet.",
  NO_CHECKS: "No checks have run on this pull request.",
  NO_CONVERSATION: "Nobody has commented yet.",
  /** How many comments a thread or a conversation holds. */
  commentCount: (count: number) => `${count} ${count === 1 ? "comment" : "comments"}`,
} as const;
