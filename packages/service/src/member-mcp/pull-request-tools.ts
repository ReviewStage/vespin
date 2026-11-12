/**
 * pull-request-tools.ts -- `read_pull_request` and `mark_pull_request_files_viewed`: a coding agent's pull request by the agent's id, or any pull request of a repository the member's workspace reaches by its repository and number, read a part at a time and its files marked viewed, as the hosted pull request reads and change make them.
 *
 * A pull request named by its repository and number is reached through the
 * operation the hosted procedures run (`../github/repository-pull-request.ts`),
 * so a call refuses exactly what `GET /api/pull-requests` refuses: a
 * workspace the member is not in and a number the repository holds none
 * under alike, as no pull request. One named by an agent is the one its
 * Pull request tab reads, through the operations `agentPullRequests.*` run
 * (`../agents/agent-pull-request-procedures.ts`): what the agent published,
 * or another of its repository by its number; an agent that opened none yet
 * is refused as such.
 *
 * A read answers one part a call, so a long conversation or a large diff
 * never lands whole in a model's context: the overview (the pull request
 * and its description), its checks and deployments, its conversation a
 * page at a time, newest first, each page held to a bound of characters,
 * or its changed files a page at a time, each with where the member's
 * viewed mark stands, and one file's patch where the call names its path.
 * A file is marked viewed or unmarked as the member, on their own GitHub
 * sign-in, as GitHub's own Viewed box does.
 */

import type { Agent } from "@repo/database/models/agent-store";
import type {
  AgentOverviewConversation,
  AgentOverviewPullRequest,
  AgentPullRequest,
  AgentPullRequestAnswer,
  ConversationEntry,
  ReviewThread,
} from "@repo/features/agent-wire";
import { githubPullRequestNumberSchema } from "@repo/features/github-repositories-wire";
import { githubRepositoryFullNameSchema } from "@repo/features/link-grammar";
import { MEMBER_MCP_TOOL } from "@repo/features/member-mcp-tool";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  FILE_VIEWED_STATE,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_BOUNDS,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestActionRequest,
  type PullRequestWriteAnswer,
} from "@repo/features/pull-request-write-wire";
import { describeWire } from "@repo/wire/effect";
import { Effect, Schema } from "effect";
import {
  actionOnAgentPullRequest,
  askedOfAgent,
  type OverviewRead,
  overviewChecksRead,
  overviewConversationRead,
  overviewPart,
  overviewPullRequestRead,
  viewedOfAgent,
} from "../agents/agent-pull-request-procedures.js";
import { agentToolRejected, cutOnLine, READ_PAGE_CHARS } from "../agents/agent-tools.js";
import { agentChangesOf } from "../agents/agents-procedures.js";
import type { PublishedCache } from "../agents/coder-host/published.js";
import { ACTION_RESULT_STATUS, HOSTED_API_ERROR, wireUuidSchema } from "../core.js";
import {
  actionOn,
  changesOf,
  overviewOf,
  type PullRequestQuery,
  publishedOf,
  type ReachedPullRequest,
  reachedPullRequest,
  viewedOf,
} from "../github/repository-pull-request.js";
import { HOSTED_REFUSAL, type HostedRefusal } from "../http/http-effect.js";

/** The part of a pull request one read answers. */
export const PULL_REQUEST_PART = {
  OVERVIEW: "overview",
  CHECKS: "checks",
  CONVERSATION: "conversation",
  CHANGES: "changes",
} as const;

type PullRequestPart = (typeof PULL_REQUEST_PART)[keyof typeof PULL_REQUEST_PART];

/** The most changed files one page lists. */
const FILES_PAGE = 100;

/** Why the member's viewed marks were not read where GitHub or the store did not answer their read, beside the outcomes a read that landed may say. */
const VIEWED_UNREAD = { UNANSWERED: "unanswered" } as const;

/** The most conversation entries one page carries, before its bound of characters. */
const ENTRIES_PAGE = 20;

/** The most characters of one comment's or review's words a page carries, and of a description. */
const WORDS_CHARS = 8_000;

/** The most characters of a review thread's frozen hunk a page carries, its end kept, where the line it is on stands. */
const HUNK_CHARS = 2_000;

/** The most paths one call marks. */
const MAX_MARKED_PATHS = 50;

/** Why a call answered nothing, in words for one acting for the member. */
const PULL_REQUEST_TOOL_REFUSAL = {
  NOT_FOUND: (not: string) =>
    `${not}: the member belongs to no such workspace, or the repository holds no pull request ` +
    "of that number.",
  NO_PULL_REQUEST: (not: string) =>
    `${not}: that agent has opened no pull request yet, or its repository holds none of that ` +
    "number.",
  NOT_REACHABLE: (not: string) =>
    `${not}: the GitHub installation connected to the workspace does not reach that repository.`,
  UNANSWERED: (not: string) =>
    `${not}: GitHub could not be asked just now. The call may be made again.`,
  NO_FILE:
    "Not read: the pull request changes no file at that path among those GitHub lists; leave " +
    "path out to list them.",
  SIGN_IN:
    "Not marked: sign in with GitHub to mark files as the member. They hold no GitHub sign-in " +
    `GitHub takes, which signing in with GitHub again in ${PRODUCT_NAME} mends.`,
  REFUSED: (words: string) => `Not marked: GitHub refused, saying: ${words}`,
} as const;

/** The pull request a call names: an agent's by the agent's id, or a repository's by its number, beside the workspace the caller names. */
export const PULL_REQUEST_FIELDS = {
  agentId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `A coding agent whose pull request it is, by its id as ${MEMBER_MCP_TOOL.LIST_AGENTS} ` +
        "answered it; leave it out to name a repository's pull request instead.",
    ),
  ),
  repository: Schema.optionalKey(
    describeWire(
      githubRepositoryFullNameSchema,
      "The pull request's repository, as owner/name, one the workspace's GitHub installation " +
        "reaches, with number; leave it out with agentId.",
    ),
  ),
  number: Schema.optionalKey(
    describeWire(
      githubPullRequestNumberSchema,
      "The pull request's number: with repository, the one meant; with agentId, another pull " +
        "request of the agent's repository, left out for the agent's own.",
    ),
  ),
};

/** What a read names beside the pull request: the part, and where in it. */
export const READ_PULL_REQUEST_FIELDS = {
  ...PULL_REQUEST_FIELDS,
  part: Schema.optionalKey(
    describeWire(
      Schema.Literals(Object.values(PULL_REQUEST_PART)),
      "What to read: overview (the default), checks, conversation, or changes.",
    ),
  ),
  path: Schema.optionalKey(
    describeWire(
      Schema.String.check(
        Schema.isNonEmpty(),
        Schema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_PATH_CHARS),
      ),
      "With changes, one file by its path as files names it, to read its patch as well.",
    ),
  ),
  offset: Schema.optionalKey(
    describeWire(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      "With conversation or changes, the nextOffset an earlier read answered, to read the next " +
        "page; leave it out for the first.",
    ),
  ),
};

/** What a mark names beside the pull request: its files, and whether to mark or unmark them. */
export const MARK_FILES_VIEWED_FIELDS = {
  ...PULL_REQUEST_FIELDS,
  paths: describeWire(
    Schema.Array(
      Schema.String.check(
        Schema.isNonEmpty(),
        Schema.isMaxLength(PULL_REQUEST_WRITE_BOUNDS.MAX_PATH_CHARS),
      ),
    ).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_MARKED_PATHS)),
    `The files, by their paths as ${MEMBER_MCP_TOOL.READ_PULL_REQUEST}'s changes name them.`,
  ),
  viewed: describeWire(Schema.Boolean, "true to mark them viewed, false to unmark them."),
};

const ReadPullRequestInputSchema = Schema.Struct(READ_PULL_REQUEST_FIELDS);
const MarkFilesViewedInputSchema = Schema.Struct(MARK_FILES_VIEWED_FIELDS);

/** A read's own fields, past the workspace and the pull request. */
type ReadPullRequestInput = Omit<typeof ReadPullRequestInputSchema.Type, PullRequestNamed>;

/** A mark's own fields, past the workspace and the pull request. */
type MarkFilesViewedInput = Omit<typeof MarkFilesViewedInputSchema.Type, PullRequestNamed>;

/** The fields that name the pull request, which the call resolves before its own. */
type PullRequestNamed = keyof typeof PULL_REQUEST_FIELDS;

/** The two ways a call reaches its pull request. */
const REACHED_BY = { REPOSITORY: "repository", AGENT: "agent" } as const;

/**
 * The pull request a call reached: by its repository and number, read
 * afresh; or by the agent that published it, or another of the agent's
 * repository, as its Pull request tab asks.
 */
type Reached =
  | {
      readonly by: typeof REACHED_BY.REPOSITORY;
      readonly reached: ReachedPullRequest;
      readonly query: PullRequestQuery;
    }
  | {
      readonly by: typeof REACHED_BY.AGENT;
      readonly agent: Agent;
      readonly published: AgentPullRequestAnswer & { readonly pullRequest: AgentPullRequest };
    };

/** A reach or a read that did not land, in the model's words, opening on what was not done; not found as the way it was reached says it. */
function unreachedWords(not: string, by: Reached["by"], refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return by === REACHED_BY.AGENT
        ? PULL_REQUEST_TOOL_REFUSAL.NO_PULL_REQUEST(not)
        : PULL_REQUEST_TOOL_REFUSAL.NOT_FOUND(not);
    case HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE:
      return PULL_REQUEST_TOOL_REFUSAL.NOT_REACHABLE(not);
    default:
      return PULL_REQUEST_TOOL_REFUSAL.UNANSWERED(not);
  }
}

/** Words cut on a line to a bound, with how many were left out where any were. */
function cutWords(text: string, maximumChars: number) {
  const cut = cutOnLine(text, maximumChars);

  return cut.leftOutChars === 0
    ? { body: cut.text }
    : { body: cut.text, leftOutChars: cut.leftOutChars };
}

/** A hunk's last lines up to a bound, since it ends on the line its thread is on. */
function hunkTail(hunk: string): string {
  if (hunk.length <= HUNK_CHARS) return hunk;
  const from = hunk.indexOf("\n", hunk.length - HUNK_CHARS);

  return hunk.slice(from < 0 ? hunk.length - HUNK_CHARS : from + 1);
}

/** The overview as a model reads it: its description as written, cut to a bound, and none of GitHub's rendering. */
function overviewWords(overview: AgentOverviewPullRequest) {
  const { html: _html, body, ...rest } = overview;

  if (body === undefined) return rest;
  const { body: kept, leftOutChars } = cutWords(body, WORDS_CHARS);

  return {
    ...rest,
    body: kept,
    ...(leftOutChars === undefined ? {} : { bodyLeftOutChars: leftOutChars }),
  };
}

/** A review thread as a page carries it: its comments' words cut, its hunk's end. */
function threadWords(thread: ReviewThread) {
  return {
    ...thread,
    diffHunk: hunkTail(thread.diffHunk),
    comments: thread.comments.map(({ html: _html, subject: _subject, body, ...comment }) => ({
      ...comment,
      ...cutWords(body, WORDS_CHARS),
    })),
  };
}

/** One entry of the conversation as a page carries it: its words cut, and none of GitHub's rendering. */
function entryWords({
  html: _html,
  subject: _subject,
  body,
  threads,
  ...entry
}: ConversationEntry) {
  return {
    ...entry,
    ...cutWords(body, WORDS_CHARS),
    ...(threads === undefined ? {} : { threads: threads.map(threadWords) }),
  };
}

/**
 * One page of the conversation, newest first from `offset`: up to the
 * page's count, and as many as fit the page's bound of characters, one at
 * least; and the offset of the next page where more stand.
 */
function conversationPage(conversation: AgentOverviewConversation, offset: number) {
  const newestFirst = conversation.conversation.toReversed();
  const entries: ReturnType<typeof entryWords>[] = [];
  let chars = 0;

  for (const entry of newestFirst.slice(offset, offset + ENTRIES_PAGE)) {
    const words = entryWords(entry);
    const size = JSON.stringify(words).length;

    if (entries.length > 0 && chars + size > READ_PAGE_CHARS) break;
    entries.push(words);
    chars += size;
  }

  const next = offset + entries.length;

  return {
    reviewers: conversation.reviewers,
    entries,
    ...(next < newestFirst.length ? { nextOffset: next } : {}),
    // Note that GitHub holds entries older than the read carries, which no page reaches.
    earlier: conversation.earlier,
    ...(conversation.pendingReview === undefined || conversation.pendingReview === null
      ? {}
      : { pendingReviewComments: conversation.pendingReview.comments }),
  };
}

/** The pull request reached as GitHub holds it now, with its head's checks, and the branch it is from. */
function publishedPart(reached: Reached) {
  return reached.by === REACHED_BY.REPOSITORY ? publishedOf(reached.reached) : reached.published;
}

/** One part of the overview of the pull request reached; none where the repository no longer holds it. */
const overviewOfReached = <A, R>(reached: Reached, userId: string, read: OverviewRead<A, R>) =>
  reached.by === REACHED_BY.REPOSITORY
    ? overviewOf(reached.reached, userId, read)
    : overviewPart(reached.agent, reached.published.pullRequest, userId, read);

/** The changed files of the pull request reached, who it names, and the commits they are read at. */
const changesOfReached = (reached: Reached, userId: string) =>
  reached.by === REACHED_BY.REPOSITORY
    ? changesOf(reached.reached)
    : agentChangesOf(userId, reached.agent, reached.published.pullRequest);

/** Which of the files of the pull request reached the member marked viewed, on their own GitHub sign-in. */
const viewedOfReached = (reached: Reached, userId: string) =>
  reached.by === REACHED_BY.REPOSITORY
    ? viewedOf(userId, reached.query)
    : viewedOfAgent(userId, reached.agent, reached.published.pullRequest);

/** The changed files from `offset`, each with the member's viewed mark where it was read, and one file's patch where a path is named. */
const changesPart = (reached: Reached, userId: string, asked: ReadPullRequestInput) =>
  Effect.gen(function* () {
    const { pullRequest: changes } = yield* changesOfReached(reached, userId);

    // An agent with no repository names no pull request to list the files of.
    if (changes === null) {
      return agentToolRejected(PULL_REQUEST_TOOL_REFUSAL.NO_PULL_REQUEST("Not read"));
    }

    // Note that the files are answered even where the marks could not be read, since they were read already.
    const viewed = yield* viewedOfReached(reached, userId).pipe(
      Effect.orElseSucceed(() => ({ outcome: VIEWED_UNREAD.UNANSWERED })),
    );

    const marks =
      "files" in viewed ? new Map(viewed.files.map((file) => [file.path, file.state])) : undefined;

    const offset = asked.offset ?? 0;

    const files = changes.files.slice(offset, offset + FILES_PAGE).map((file) => ({
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      ...(marks === undefined
        ? {}
        : { viewed: marks.get(file.path) ?? FILE_VIEWED_STATE.UNVIEWED }),
    }));

    const named =
      asked.path === undefined ? undefined : changes.files.find((file) => file.path === asked.path);

    if (asked.path !== undefined && named === undefined) {
      return agentToolRejected(PULL_REQUEST_TOOL_REFUSAL.NO_FILE);
    }

    const patch = named?.patch == null ? undefined : cutOnLine(named.patch, READ_PAGE_CHARS);
    const next = offset + files.length;

    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      ...(changes.headSha === undefined ? {} : { headSha: changes.headSha }),
      files,
      ...(next < changes.files.length ? { nextOffset: next } : {}),
      truncated: changes.truncated,
      ...(marks === undefined ? { viewedUnread: viewed.outcome } : {}),
      ...(changes.reviewers === undefined ? {} : { reviewers: changes.reviewers }),
      ...(changes.comments === undefined ? {} : { reviews: changes.comments }),
      ...(named === undefined
        ? {}
        : {
            file: {
              path: named.path,
              patch: patch?.text ?? null,
              omitted: named.omitted,
              leftOutChars: patch?.leftOutChars ?? 0,
            },
          }),
    };
  });

/** One part of the pull request reached, as the call asked for it. */
const partOf = (
  part: PullRequestPart,
  reached: Reached,
  userId: string,
  asked: ReadPullRequestInput,
) => {
  const accepted = { status: ACTION_RESULT_STATUS.ACCEPTED };

  switch (part) {
    case PULL_REQUEST_PART.OVERVIEW:
      return Effect.map(
        overviewOfReached(reached, userId, overviewPullRequestRead),
        ({ pullRequest }) => ({
          ...accepted,
          ...publishedPart(reached),
          overview: pullRequest === null ? null : overviewWords(pullRequest),
        }),
      );
    case PULL_REQUEST_PART.CHECKS:
      return Effect.map(
        overviewOfReached(reached, userId, overviewChecksRead),
        ({ pullRequest }) => ({ ...accepted, checks: pullRequest }),
      );
    case PULL_REQUEST_PART.CONVERSATION:
      return Effect.map(
        overviewOfReached(reached, userId, overviewConversationRead),
        ({ pullRequest }) => ({
          ...accepted,
          conversation:
            pullRequest === null ? null : conversationPage(pullRequest, asked.offset ?? 0),
        }),
      );
    case PULL_REQUEST_PART.CHANGES:
      return changesPart(reached, userId, asked);
  }
};

/** The pull request a repository's number names, reached in the workspace given. */
const reachedByRepository = (userId: string, query: PullRequestQuery) =>
  Effect.map(
    reachedPullRequest(userId, query),
    (reached): Reached => ({ by: REACHED_BY.REPOSITORY, reached, query }),
  );

/** The pull request asked about of an agent the member reached; not found where it names none yet. */
const reachedByAgent = (
  published: Effect.Effect<PublishedCache>,
  userId: string,
  agent: Agent,
  number: number | undefined,
) =>
  Effect.flatMap(askedOfAgent(published, userId, agent, number), (answer) => {
    const { pullRequest } = answer;

    return pullRequest === null
      ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND)
      : Effect.succeed<Reached>({
          by: REACHED_BY.AGENT,
          agent,
          published: { ...answer, pullRequest },
        });
  });

/** A read of the part asked of the pull request reached, or why there is none. */
const readReached = <E extends HostedRefusal, R>(
  by: Reached["by"],
  reach: Effect.Effect<Reached, E, R>,
  userId: string,
  asked: ReadPullRequestInput,
) =>
  Effect.gen(function* () {
    const reached = yield* reach;

    return yield* partOf(asked.part ?? PULL_REQUEST_PART.OVERVIEW, reached, userId, asked);
  }).pipe(
    Effect.catch((refusal) =>
      Effect.succeed(agentToolRejected(unreachedWords("Not read", by, refusal))),
    ),
  );

/** One call of `read_pull_request` naming a repository's pull request, as the member, in the workspace given: the part asked, or why there is none. */
export const runReadPullRequest = (
  userId: string,
  workspaceId: string,
  named: { readonly repository: string; readonly number: number },
  asked: ReadPullRequestInput,
) =>
  readReached(
    REACHED_BY.REPOSITORY,
    reachedByRepository(userId, { workspaceId, ...named }),
    userId,
    asked,
  );

/** One call of `read_pull_request` naming an agent's pull request, as the member: the part asked of what it published, or of the one `number` names, or why there is none. */
export const runReadAgentPullRequest = (
  published: Effect.Effect<PublishedCache>,
  userId: string,
  agent: Agent,
  number: number | undefined,
  asked: ReadPullRequestInput,
) => readReached(REACHED_BY.AGENT, reachedByAgent(published, userId, agent, number), userId, asked);

/** A mark GitHub did not make, in the model's words, with the paths marked before it. */
function unmarkedWords(answer: PullRequestWriteAnswer, done: readonly string[]) {
  const words =
    answer.outcome === PULL_REQUEST_WRITE_OUTCOME.REFUSED
      ? PULL_REQUEST_TOOL_REFUSAL.REFUSED(answer.words)
      : PULL_REQUEST_TOOL_REFUSAL.SIGN_IN;

  return done.length === 0 ? words : `${words} Marked before it: ${done.join(", ")}.`;
}

/** Each path marked or unmarked in turn through `change`, stopping at the first GitHub did not take, or why none was. */
const markEach = <E extends HostedRefusal, R>(
  by: Reached["by"],
  asked: MarkFilesViewedInput,
  change: (request: PullRequestActionRequest) => Effect.Effect<PullRequestWriteAnswer, E, R>,
) => {
  const action = asked.viewed
    ? PULL_REQUEST_ACTION.MARK_FILE_VIEWED
    : PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED;

  return Effect.gen(function* () {
    const done: string[] = [];

    for (const path of asked.paths) {
      const written = yield* change({ action, path });

      if (written.outcome !== PULL_REQUEST_WRITE_OUTCOME.DONE) {
        return agentToolRejected(unmarkedWords(written, done));
      }

      done.push(path);
    }

    return { status: ACTION_RESULT_STATUS.ACCEPTED, paths: done, viewed: asked.viewed };
  }).pipe(
    Effect.catch((refusal) =>
      Effect.succeed(agentToolRejected(unreachedWords("Not marked", by, refusal))),
    ),
  );
};

/** One call of `mark_pull_request_files_viewed` naming a repository's pull request, as the member, in the workspace given. */
export const runMarkFilesViewed = (
  userId: string,
  workspaceId: string,
  named: { readonly repository: string; readonly number: number },
  asked: MarkFilesViewedInput,
) => {
  const query: PullRequestQuery = { workspaceId, ...named };

  return markEach(REACHED_BY.REPOSITORY, asked, (request) => actionOn(userId, query, request));
};

/**
 * One call of `mark_pull_request_files_viewed` naming an agent's pull
 * request, as the member: the pull request asked once, then each path
 * changed on it as its Pull request tab's Viewed box changes it.
 */
export const runMarkAgentFilesViewed = (
  published: Effect.Effect<PublishedCache>,
  userId: string,
  agent: Agent,
  number: number | undefined,
  asked: MarkFilesViewedInput,
) =>
  Effect.flatMap(askedOfAgent(published, userId, agent, number), ({ pullRequest }) =>
    markEach(REACHED_BY.AGENT, asked, (request) =>
      actionOnAgentPullRequest(published, userId, agent, pullRequest, request),
    ),
  ).pipe(
    Effect.catch((refusal) =>
      Effect.succeed(agentToolRejected(unreachedWords("Not marked", REACHED_BY.AGENT, refusal))),
    ),
  );
