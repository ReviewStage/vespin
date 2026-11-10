import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  type AgentPullRequestRead,
  type AgentPullRequestRow,
  readAgentPullRequests,
  recordAgentPullRequests,
} from "@repo/database/models/agent-pull-requests";
import {
  type AgentRepositoryEntry,
  readAgentRepositories,
} from "@repo/database/models/agent-repositories";
import {
  type Agent,
  hasRepository,
  type KeptPublished,
  readAgent,
  readAgentKeptPublished,
  readAgentPublished,
  recordAgentPublishedRead,
  type WithRepository,
} from "@repo/database/models/agent-store";
import type { StoredPullRequest } from "@repo/database/schemas/agent";
import {
  type AgentPullRequest,
  type AgentPullRequestAnswer,
  PULL_REQUEST_STATE,
  pullRequestAuthorOf,
} from "@repo/features/agent-wire";
import { failureKind } from "@repo/runtime/effect";
import { Cache, Clock, Data, Duration, Effect, Exit, Option, type Redacted } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { reconsiderRunArchive } from "../../automations/run-archive.js";
import { recordServerEvent, SERVER_EVENT } from "../../events/server-events.js";
import {
  GITHUB_HTTP_STATUS,
  GitHubApp,
  type GitHubRepositoryToken,
  type GitHubWorkspaceReadFailure,
} from "../../github/github-app.js";
import { pullRequestQueued } from "../../github/pull-request-merging.js";
import {
  branchStands,
  checkSummaryOf,
  type GitHubPullRequest,
  type PullRequestReadFailure,
  pullRequestByNumber,
  pullRequestOfBranch,
} from "../../github/pull-requests.js";
import { agentMember, agentWorkspace } from "../../github/workspace-repository.js";
import { CODER } from "./bounds.js";

/**
 * published.ts -- what a coding agent published: the branch its sandbox stands on and the pull request from it, confirmed on GitHub.
 *
 * The agent pushes through `git` in its shell, and the service opens its
 * pull request and writes the branch it was opened from on the agent's row
 * (`pull-request.ts`'s `recordOpened`), and this module reads the row.
 * A row with no branch, as before the agent opens its pull request,
 * published nothing, and GitHub is not
 * asked. GitHub then says what stands, once the installation of the task's
 * workspace is confirmed to reach the repository as a Start confirms it,
 * on a token minted for that one repository with pull requests read: a row
 * still on the repository's default branch, as an agent that only read
 * leaves it, published nothing either; otherwise the newest pull request
 * from the branch, else whether the branch was pushed at all, with the
 * pull request's head's checks and, for an open one, whether GitHub's merge
 * queue holds it (`pull-request-merging.ts`'s `pullRequestQueued`), which the
 * REST pull request does not say. The pull request a read finds is linked
 * to the agent (`agent-pull-requests.ts`), with the head it was read at and
 * when it merged, and the one from the branch the agent stands on is what
 * the task list reads, so the sidebar says what the last read found without
 * asking GitHub itself. The answer is kept per
 * agent for `CODER.PUBLISHED_TTL` so a tab reading it beside every page of
 * a held transcript asks GitHub a few times a minute at most, under a key
 * that says whether the agent had ended, so the first read after a turn
 * ends is a fresh one rather than the running turn's kept answer; a read
 * that failed is kept for no time, so the next ask tries again. A read
 * that first finds the pull request merged, the row having kept it
 * unmerged or not at all, is one of the moments that may finish the
 * agent's task, so the task is asked to settle once the row is written
 * (`tasks/task-finish.ts`).
 *
 * The agent's row keeps when that read was and of which branch, so the kept
 * answers answer from the row rather than GitHub where it will not have
 * moved or was just read: an archived agent's, an ended agent's whose pull
 * request merged, or closed within `CODER.PUBLISHED_CLOSED_FRESH` of the
 * read, since a closed one may reopen and no sweep reads a closed one again,
 * and any read within `CODER.PUBLISHED_ROW_FRESH` of the last, on whichever
 * instance; and where GitHub refuses for its rate
 * limit, the row answers rather than a failure. The row answers only while
 * it stands on the branch read, and a change to the pull request lets the
 * read go (`forgetPublished`). Opening a task of a hundred agents once asked
 * GitHub some four hundred times at once and was refused for twenty minutes;
 * the webhook, the token sweep, the brain, and an opening still read GitHub.
 *
 * An agent that works in other repositories beside its own
 * (`readAgentRepositories`) has each pull request it opened in one read
 * again with every read of its own, on a token for that repository, and
 * linked as its own is, a merge first seen there counted and its task asked
 * to settle as its own would be; what a read answers stays the agent's own pull request, which
 * the Changes tab and the sidebar show. A read of an extra that fails is
 * logged and fails nothing else.
 *
 * Every pull request a read finds is linked to the agent, one row each
 * (`agent-pull-requests.ts`), in whichever of its repositories it stands, so
 * an agent that opens a second pull request from a new branch keeps the
 * first: its task waits on every one of them, and its rows list them all.
 * Each read of the agent reads again the pull requests it linked before
 * that may still move, those open or a draft, and those from a branch a
 * delivery from GitHub names whatever the row keeps, since a closed one may
 * reopen; one merged never moves again. A merge first written there is
 * counted and its task asked to settle as the newest's is. A read of one
 * that fails is logged and leaves it as it stood.
 */

/** The installation of the task's workspace no longer reaches the agent's repository, so nothing of it is read. */
class RepositoryNotReachable extends Data.TaggedError("RepositoryNotReachable")<{
  readonly repository: string;
}> {}

/** What a read of what an agent published may fail with: the store, GitHub, or a repository out of reach. */
type PublishedReadFailure = StoreFailure | GitHubWorkspaceReadFailure | RepositoryNotReachable;

type PublishedServices = DatabaseServices | HttpClient.HttpClient | GitHubApp;

/** How a pull request ended: merged, or closed unmerged. */
type PullRequestEnd = typeof PULL_REQUEST_STATE.MERGED | typeof PULL_REQUEST_STATE.CLOSED;

/** What one read found: the answer the wire carries, the pull request as the agent's row keeps it, null where none was found, and how it ended where the read is the first to find it so. */
interface Published {
  readonly answer: AgentPullRequestAnswer;
  readonly stored: StoredPullRequest | null;
  readonly ended: PullRequestEnd | undefined;
}

/** The wire's pull request from GitHub's, with its head's checks as read and whether the merge queue holds it. */
function wirePullRequestOf(
  found: GitHubPullRequest,
  checks: AgentPullRequest["checks"],
  queued: boolean,
): AgentPullRequest {
  return {
    number: found.number,
    title: found.title,
    url: found.url,
    state: found.state,
    checks,
    additions: found.additions,
    deletions: found.deletions,
    changedFiles: found.changedFiles,
    ...(queued && found.state === PULL_REQUEST_STATE.OPEN ? { queued: true } : undefined),
    ...pullRequestAuthorOf(found),
  };
}

/**
 * Whether GitHub's merge queue holds the pull request, asked only of an open
 * one, since a draft, a merged, and a closed one stand in no queue. Note
 * that a read that fails keeps what the row kept of that same pull request,
 * so a queue read GitHub could not answer neither fails the read it rides
 * with nor drops a queued mark the last read saw.
 */
function queuedOf(
  token: Redacted.Redacted,
  repository: string,
  found: GitHubPullRequest,
  kept: StoredPullRequest | null,
): Effect.Effect<boolean, never, HttpClient.HttpClient> {
  if (found.state !== PULL_REQUEST_STATE.OPEN) return Effect.succeed(false);
  const keptQueued = kept !== null && kept.number === found.number && kept.queued === true;
  return pullRequestQueued(token, repository, found.number).pipe(
    Effect.catch(() => Effect.succeed(keptQueued)),
  );
}

/** The wire's pull request from GitHub's, with its head's checks read beside it, and the row's with its head and when it merged beside that. */
function withChecks(
  token: Redacted.Redacted,
  repository: string,
  found: GitHubPullRequest,
  kept: StoredPullRequest | null,
): Effect.Effect<Published, PullRequestReadFailure, HttpClient.HttpClient> {
  const read = Effect.all([
    checkSummaryOf(token, repository, found.headSha),
    queuedOf(token, repository, found, kept),
  ]);
  return Effect.map(read, ([checks, queued]) => {
    const pullRequest = wirePullRequestOf(found, checks, queued);
    const stored: StoredPullRequest = {
      ...pullRequest,
      headSha: found.headSha,
      ...(found.mergedAt === undefined ? undefined : { mergedAt: found.mergedAt }),
    };
    return {
      answer: { repository, branch: found.headRef, pullRequest },
      stored,
      ended: firstSeenEnd(found, kept),
    };
  });
}

/** How the pull request ended, where the read is the first to find it so: GitHub says merged or closed, and the row kept it otherwise, or kept none. */
function firstSeenEnd(
  found: GitHubPullRequest,
  kept: StoredPullRequest | null,
): PullRequestEnd | undefined {
  if (found.state !== PULL_REQUEST_STATE.MERGED && found.state !== PULL_REQUEST_STATE.CLOSED) {
    return undefined;
  }
  const seen = kept !== null && kept.number === found.number && kept.state === found.state;
  return seen ? undefined : found.state;
}

/** Nothing published: neither a branch GitHub holds nor a pull request. */
function nothing(agent: Agent): Published {
  return {
    answer: { repository: agent.repository, branch: null, pullRequest: null },
    stored: null,
    ended: undefined,
  };
}

/**
 * A token that reads the agent's pull requests, minted for its one
 * repository, or the one named of those it works in beside it, on the
 * installation of its workspace, as the account asking is a member of it;
 * refused as out of reach where either no longer stands.
 */
export const agentPullRequestReach = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: WithRepository<Agent>,
  repository: string = agent.repository,
): Effect.fn.Return<GitHubRepositoryToken, PublishedReadFailure, PublishedServices> {
  const workspace = yield* agentWorkspace(userId, agent);
  const app = yield* GitHubApp;
  const reached = Option.isNone(workspace)
    ? Option.none()
    : yield* app.repositoryPullRequestToken(workspace.value, repository, agentMember(agent));
  if (Option.isNone(reached)) {
    return yield* new RepositoryNotReachable({ repository });
  }
  return reached.value;
});

/**
 * What the agent published as GitHub holds it now: the newest pull request
 * from the branch its row holds, else the branch alone where GitHub holds
 * it, else nothing.
 */
const publishedOnGitHub = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: Agent,
): Effect.fn.Return<Published, PublishedReadFailure, PublishedServices> {
  // No branch on the row, no publication: no turn has ended in the sandbox, or its checkout stood detached.
  if (agent.branch === null) return nothing(agent);
  if (!hasRepository(agent)) return nothing(agent);
  const reached = yield* agentPullRequestReach(userId, agent);
  // The default branch is the checkout's own, not a branch the agent cut: nothing published from it.
  if (agent.branch === reached.repository.defaultBranch) return nothing(agent);
  const { token } = reached;
  const ofBranch = yield* pullRequestOfBranch(token, agent.repository, agent.branch);
  if (Option.isSome(ofBranch)) {
    const kept = yield* readAgentPublished(userId, agent.id);
    return yield* withChecks(token, agent.repository, ofBranch.value, kept);
  }
  const pushed = yield* branchStands(token, agent.repository, agent.branch);
  return pushed
    ? {
        answer: { repository: agent.repository, branch: agent.branch, pullRequest: null },
        stored: null,
        ended: undefined,
      }
    : nothing(agent);
});

/** A pull request the agent linked before, read again: as GitHub answered it, and how it ended where the read is the first to find it so. */
interface LinkedRead {
  readonly read: AgentPullRequestRead;
  readonly ended: PullRequestEnd | undefined;
}

/**
 * Whether a linked pull request is read again: one open or a draft, which
 * may yet merge or close, and a closed one from a branch a delivery from
 * GitHub names (`delivered`), since it may have reopened. Note that a merged
 * one never moves again.
 */
function readAgain(row: AgentPullRequestRow, delivered: readonly string[]): boolean {
  const { state } = row.pullRequest;
  if (state === PULL_REQUEST_STATE.MERGED) return false;
  return state !== PULL_REQUEST_STATE.CLOSED || delivered.includes(row.headBranch);
}

/**
 * The pull requests the agent linked in one of its repositories that
 * `readAgain` names, as GitHub holds them now, read by their numbers on a
 * token for that repository; one GitHub no longer holds is left as its row
 * keeps it. A read that fails, of the token or of one of them, is logged by
 * its kind and leaves what it would have read as its row keeps it.
 */
const linkedOnGitHub = (
  userId: string,
  agent: WithRepository<Agent>,
  repository: string,
  rows: readonly AgentPullRequestRow[],
  delivered: readonly string[],
): Effect.Effect<readonly LinkedRead[], never, PublishedServices> =>
  Effect.gen(function* () {
    const asked = rows.filter((row) => readAgain(row, delivered));
    if (asked.length === 0) return [];
    const { token } = yield* agentPullRequestReach(userId, agent, repository);
    const read = yield* Effect.forEach(
      asked,
      (row) =>
        Effect.gen(function* () {
          const found = yield* pullRequestByNumber(token, repository, row.pullRequest.number);
          if (Option.isNone(found)) return [];
          const { stored, ended } = yield* withChecks(
            token,
            repository,
            found.value,
            row.pullRequest,
          );
          if (stored === null) return [];
          return [{ read: { repository, headBranch: row.headBranch, pullRequest: stored }, ended }];
        }).pipe(Effect.catch(linkedUnread)),
      // Note that an agent opens few pull requests, so they are read together.
      { concurrency: "unbounded" },
    );
    return read.flat();
  }).pipe(Effect.catch(linkedUnread));

/** A read of the pull requests an agent linked before that failed, logged by its kind alone. */
function linkedUnread(failure: unknown): Effect.Effect<readonly LinkedRead[]> {
  return Effect.as(
    Effect.logWarning(
      `an agent's linked pull requests could not be read again: ${failureKind(failure)}`,
    ),
    [],
  );
}

/**
 * One repository's read linked and written (`recordAgentPullRequests`): the
 * pull request the read found from the branch the agent stands on there,
 * and those it linked there before read again beside it; then what the
 * writes leave to do (`afterRecorded`).
 */
const recordRepository = (
  userId: string,
  agent: WithRepository<Agent>,
  repository: string,
  found: Published,
  delivered: readonly string[],
) =>
  Effect.gen(function* () {
    const lowered = repository.toLowerCase();
    const current = found.stored?.number;
    const rows = (yield* readAgentPullRequests(userId, agent.id)).filter(
      (row) => row.repository.toLowerCase() === lowered && row.pullRequest.number !== current,
    );
    const linked = yield* linkedOnGitHub(userId, agent, repository, rows, delivered);
    const { stored, answer } = found;
    const newest =
      stored === null || answer.branch === null
        ? []
        : [{ repository, headBranch: answer.branch, pullRequest: stored }];
    const firstMerged = yield* recordAgentPullRequests(userId, agent.id, [
      ...newest,
      ...linked.map((each) => each.read),
    ]);
    yield* afterRecorded(agent, firstMerged, [found.ended, ...linked.map((each) => each.ended)]);
  });

/**
 * What the agent published as GitHub holds it now, linked to it with the
 * read stamped on its row, and every pull request it opened read again beside it
 * (`recordRepository`), those from a branch a delivery from GitHub names
 * (`delivered`) among them. The routes read it through the cache below; an
 * agent tool's read of one agent (`agents/agent-tools.ts`) reads it afresh,
 * once per ask.
 */
export const agentPublished = /* @__PURE__ */ Effect.fn("web/agentPublished")(function* (
  userId: string,
  agent: Agent,
  delivered: readonly string[] = [],
): Effect.fn.Return<AgentPullRequestAnswer, PublishedReadFailure, PublishedServices> {
  yield* extrasPublished(userId, agent, delivered);
  const found = yield* publishedOnGitHub(userId, agent);
  const at = yield* Clock.currentTimeMillis;
  const read = { at, branch: agent.branch, pushed: found.answer.branch !== null };
  // Note that the read is written last, because an ended agent's read answers from the pull request it
  // linked once it says merged: a write of the pull requests, or what it leaves to do, that fails reads again.
  if (hasRepository(agent))
    yield* recordRepository(userId, agent, agent.repository, found, delivered);
  yield* recordAgentPublishedRead(userId, agent.id, read);
  return found.answer;
});

/** What a write of pull requests leaves to do: each merge counted by the one write that first kept it, and the agent's automation run asked to archive where the read first saw one merged or closed. */
const afterRecorded = (
  agent: Agent,
  firstMerged: number,
  ended: readonly (PullRequestEnd | undefined)[],
) =>
  Effect.gen(function* () {
    // Counted once per pull request, by the one write that first kept it merged, under the agent's starter.
    yield* Effect.forEach(
      Array.from({ length: firstMerged }),
      () =>
        recordServerEvent(
          SERVER_EVENT.PULL_REQUEST_MERGE,
          { userId: agent.userId, workspaceId: agent.organizationId },
          {},
        ),
      { discard: true },
    );
    // Note that a pull request ending wakes no agent, so no settle of its turn would archive its run.
    const endedAny = firstMerged > 0 || ended.some((each) => each !== undefined);
    if (endedAny && agent.automationRunId !== null) yield* reconsiderRunArchive(agent.id);
  });

/**
 * What the agent published in one repository it works in beside its own,
 * as GitHub holds it now: the newest pull request from the head branch its
 * row holds, else none, as `publishedOnGitHub` reads its own; nothing read
 * for one with no head branch yet, or still on its default branch.
 */
const extraPublishedOnGitHub = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  agent: WithRepository<Agent>,
  extra: AgentRepositoryEntry & { readonly headBranch: string },
): Effect.fn.Return<Published, PublishedReadFailure, PublishedServices> {
  const none: Published = {
    answer: { repository: extra.repository, branch: null, pullRequest: null },
    stored: null,
    ended: undefined,
  };
  const reached = yield* agentPullRequestReach(userId, agent, extra.repository);
  if (extra.headBranch === reached.repository.defaultBranch) return none;
  const ofBranch = yield* pullRequestOfBranch(reached.token, extra.repository, extra.headBranch);
  if (Option.isNone(ofBranch)) return none;
  return yield* withChecks(reached.token, extra.repository, ofBranch.value, extra.pullRequest);
});

/**
 * Each pull request the agent opened in a repository it works in beside its
 * own (`readAgentRepositories`), read again from GitHub and linked as the
 * agent's own is, a merge first seen
 * counted and its task asked to settle; nothing for an agent in one
 * repository, nor for an extra that opened none. Each read that fails is
 * logged by its kind and leaves its pull requests as they stood, since the agent's own
 * pull request is still read and answered.
 */
const extrasPublished = (userId: string, agent: Agent, delivered: readonly string[]) =>
  Effect.gen(function* () {
    if (!hasRepository(agent)) return;
    const [, ...extras] = yield* readAgentRepositories(userId, agent.id);
    yield* Effect.forEach(
      extras,
      (extra) => {
        const { headBranch } = extra;
        if (headBranch === null) return Effect.void;
        return Effect.gen(function* () {
          const found = yield* extraPublishedOnGitHub(userId, agent, { ...extra, headBranch });
          yield* recordRepository(userId, agent, extra.repository, found, delivered);
        }).pipe(Effect.catch(extraUnread));
      },
      // Note that an agent's extras are bounded at its Start, so they are read together.
      { concurrency: "unbounded", discard: true },
    );
  }).pipe(Effect.catch(extraUnread));

/** A read of an extra repository's pull request that failed, logged by its kind alone. */
function extraUnread(failure: unknown): Effect.Effect<void> {
  return Effect.logWarning(
    `an extra repository's pull request could not be read again: ${failureKind(failure)}`,
  );
}

/**
 * A pull request of a repository by its number, as GitHub holds it now, on
 * a token already minted for the repository, with its head's checks and
 * whether the merge queue holds it; none where the repository holds no
 * such one. Note that it is read afresh on each ask and written nowhere.
 */
export const pullRequestOfNumber = /* @__PURE__ */ Effect.fnUntraced(function* (
  token: Redacted.Redacted,
  repository: string,
  number: number,
): Effect.fn.Return<
  Option.Option<{ readonly branch: string; readonly pullRequest: AgentPullRequest }>,
  PullRequestReadFailure,
  HttpClient.HttpClient
> {
  const found = yield* pullRequestByNumber(token, repository, number);
  if (Option.isNone(found)) return Option.none();
  const checks = yield* checkSummaryOf(token, repository, found.value.headSha);
  const queued = yield* queuedOf(token, repository, found.value, null);
  return Option.some({
    branch: found.value.headRef,
    pullRequest: wirePullRequestOf(found.value, checks, queued),
  });
});

/**
 * Another pull request of the agent's repository by its number
 * (`pullRequestOfNumber`): one the agent opened from a branch it has since
 * left, or one no agent opened, which a Pull request tab shows by its
 * number; none where the repository holds no such one. Note that it is
 * never linked to the agent, since only a read of the agent's own branches
 * links one.
 */
export const agentPullRequestOfNumber = /* @__PURE__ */ Effect.fn("web/agentPullRequestOfNumber")(
  function* (
    userId: string,
    agent: Agent,
    number: number,
  ): Effect.fn.Return<AgentPullRequestAnswer, PublishedReadFailure, PublishedServices> {
    if (!hasRepository(agent)) return nothing(agent).answer;
    const { token } = yield* agentPullRequestReach(userId, agent);
    const found = yield* pullRequestOfNumber(token, agent.repository, number);
    if (Option.isNone(found)) return nothing(agent).answer;
    return { repository: agent.repository, ...found.value };
  },
);

/** One agent of one account, as the kept answers are keyed, and whether it had ended as asked: the first ask after a turn ends is its own key, so it reads afresh. */
export class PublishedKey extends Data.Class<{
  readonly userId: string;
  readonly agentId: string;
  readonly ended: boolean;
}> {}

/** The kept answers of one function instance: an agent's answer for the TTL, a failure for no time. */
export type PublishedCache = Cache.Cache<
  PublishedKey,
  AgentPullRequestAnswer,
  PublishedReadFailure | NoSuchAgent,
  PublishedServices
>;

/** The key names an agent the account does not hold, which an ownership check before the ask already refused. */
class NoSuchAgent extends Data.TaggedError("NoSuchAgent")<{ readonly agentId: string }> {}

/** The most agents one instance keeps answers for at once. */
const KEPT_AGENTS = 1_024;

/** The answer the row keeps, as the read that wrote it answered: its pull request as the wire carries it, else the branch where GitHub held it. */
function keptAnswer(agent: Agent, kept: KeptPublished): AgentPullRequestAnswer {
  if (kept.published === null) {
    const branch = kept.read.pushed ? kept.read.branch : null;
    return { repository: agent.repository, branch, pullRequest: null };
  }
  const { headSha: _headSha, mergedAt: _mergedAt, ...pullRequest } = kept.published;
  return { repository: agent.repository, branch: kept.read.branch, pullRequest };
}

/** Whether the row answers in GitHub's place: the agent archived, or ended on a pull request that merged or closed a while ago at most, or the row read a moment ago. */
function keptStands(agent: Agent, ended: boolean, kept: KeptPublished, now: number): boolean {
  if (agent.archivedAt !== null) return true;
  const state = kept.published?.state;
  const age = now - kept.read.at;
  if (ended && state === PULL_REQUEST_STATE.MERGED) return true;
  if (ended && state === PULL_REQUEST_STATE.CLOSED) {
    return age < Duration.toMillis(CODER.PUBLISHED_CLOSED_FRESH);
  }
  return age < Duration.toMillis(CODER.PUBLISHED_ROW_FRESH);
}

/** Whether GitHub refused the read for its rate limit: a 429, the instance's own held answer among them, or a 403 it may answer one with. */
function rateLimited(failure: PublishedReadFailure): boolean {
  if (failure._tag !== "GitHubUnavailable") return false;
  return (
    failure.status === GITHUB_HTTP_STATUS.TOO_MANY_REQUESTS ||
    failure.status === GITHUB_HTTP_STATUS.FORBIDDEN
  );
}

/**
 * One agent's answer looked up afresh: the row, then what it keeps where
 * that answers in GitHub's place, else what GitHub holds now, the row again
 * where GitHub refused for its rate limit. A row that stands on another
 * branch than the one read keeps nothing of it.
 */
const lookupPublished = (
  key: PublishedKey,
): Effect.Effect<AgentPullRequestAnswer, PublishedReadFailure | NoSuchAgent, PublishedServices> =>
  Effect.gen(function* () {
    const found = yield* readAgent(key.userId, key.agentId);
    if (Option.isNone(found)) return yield* new NoSuchAgent({ agentId: key.agentId });
    const agent = found.value;
    const row = yield* readAgentKeptPublished(key.userId, agent.id);
    const kept = row !== null && row.read.branch === agent.branch ? row : null;
    const now = yield* Clock.currentTimeMillis;
    if (kept !== null && keptStands(agent, key.ended, kept, now)) return keptAnswer(agent, kept);
    return yield* agentPublished(key.userId, agent).pipe(
      Effect.catch((failure) =>
        kept !== null && rateLimited(failure)
          ? Effect.succeed(keptAnswer(agent, kept))
          : Effect.fail(failure),
      ),
    );
  });

/** The cache, made once per instance by `instancePublishedCache`. */
const publishedCache: Effect.Effect<PublishedCache> = Cache.makeWith(lookupPublished, {
  capacity: KEPT_AGENTS,
  requireServicesAt: "lookup",
  timeToLive: (exit) => (Exit.isSuccess(exit) ? CODER.PUBLISHED_TTL : Duration.zero),
});

/**
 * A cache of its own for procedures that are built with no Effect to build
 * one in: made on the first ask and kept for the instance's life, as a
 * route group's is. Note that two first asks at once each make one and the
 * first to land is the one kept, so every later ask shares it. The hosted
 * router makes one and hands it to every resource that reads the kept
 * answers or lets them go (`PublishedReach`), so a change to a pull request
 * lets go of what each of them read.
 */
export function instancePublishedCache(): Effect.Effect<PublishedCache> {
  let kept: PublishedCache | undefined;
  return Effect.suspend(() =>
    kept === undefined
      ? Effect.map(publishedCache, (made) => (kept ??= made))
      : Effect.succeed(kept),
  );
}

/** The kept published answers a resource's procedures read and let go of: the instance's one cache where the router hands it, one of their own otherwise. */
export interface PublishedReach {
  readonly published?: Effect.Effect<PublishedCache>;
}
