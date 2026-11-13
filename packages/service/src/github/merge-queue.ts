/**
 * merge-queue.ts -- every pull request GitHub's merge queues hold across the repositories a workspace's tasks work in, read in one GraphQL request and joined to the tasks whose agents opened them.
 *
 * The repositories are the ones the workspace's tasks the member sees work
 * in, the most recently changed first (`readWorkspaceTaskRepositories`),
 * never every repository the installation reaches. Each installation of the
 * workspace that reaches any of them hands one pull request read token for
 * them (`repositoriesPullRequestTokens`), and one request on it names every
 * repository it reaches under an alias of its own, reading the queue of its
 * default branch, which a `mergeQueue` naming no branch reads
 * (https://docs.github.com/en/graphql/reference/objects#repository). A
 * repository with no queue answers a null `mergeQueue`, and one GitHub
 * would not resolve answers null whole beside an error, so both are left
 * out rather than failing the rest. Each entry carries GitHub's estimate of
 * when it merges and how the checks stand on the commit the queue builds for
 * it (`headCommit`, the merge group's, never the pull request's own head),
 * whose rollup is read to its first `MAX_CHECKS` checks and counted from
 * them, with its whole count beside. Each entry's pull request is joined to
 * a task through the pull requests the service records for agents
 * (`agent_pull_request`). The read stands behind the account's Merge queue
 * experiment.
 */

import { accountExperimentOn } from "@repo/database/models/account-store";
import { readPullRequestTasks } from "@repo/database/models/agent-pull-requests";
import { readWorkspaceTaskRepositories } from "@repo/database/models/task-store";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import {
  MERGE_QUEUE_BOUNDS,
  MERGE_QUEUE_ENTRY_STATE,
  type MergeQueueAnswer,
  type MergeQueueChecks,
  type MergeQueueEntryState,
  type MergeQueueRepository,
} from "@repo/features/merge-queue-wire";
import type { GitHubFailure } from "@repo/github";
import { EXPERIMENT } from "@repo/settings";
import { Clock, Effect, Schema } from "effect";
import type { GitHubRepository } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  upstreamRefused,
} from "../http/http-effect.js";
import { GitHubApp, type GitHubBearer } from "./github-app.js";
import { githubReadOrRefusal } from "./github-refusal.js";
import type { WorkspaceRepositoriesServices } from "./workspace-repositories.js";

/** The most checks read of one entry's merge group, which its whole count still stands beside. */
const MAX_CHECKS = 50;

/**
 * A check run's conclusions that pass it, and those that fail it, as GraphQL
 * spells them; any other conclusion, or none yet, neither passes nor fails.
 * Note that a canceled run is neither, because the queue cancels a merge
 * group's runs when one ahead of it fails and it builds the group again, which
 * says nothing against this pull request.
 */
const CHECK_RUN_PASSED = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

const CHECK_RUN_FAILED = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
  "STALE",
]);

/** A commit status's states that pass it, and those that fail it; `PENDING` and `EXPECTED` are still running. */
const STATUS_PASSED = new Set(["SUCCESS"]);

const STATUS_FAILED = new Set(["FAILURE", "ERROR"]);

/** The fields read of one queue, after the alias naming its repository. */
const QUEUE_FIELDS = `mergeQueue {
      url
      entries(first: ${MERGE_QUEUE_BOUNDS.MAX_ENTRIES}) {
        nodes {
          position
          state
          enqueuedAt
          estimatedTimeToMerge
          pullRequest { number title url author { login avatarUrl } }
          headCommit {
            statusCheckRollup {
              contexts(first: ${MAX_CHECKS}) {
                totalCount
                nodes {
                  __typename
                  ... on CheckRun { name conclusion }
                  ... on StatusContext { context state }
                }
              }
            }
          }
        }
      }
    }`;

/** GitHub's GraphQL type names for the two kinds of check a rollup holds. */
const CHECK_KIND = {
  CHECK_RUN: "CheckRun",
  STATUS: "StatusContext",
} as const;

/** One check on a merge group: a check run by its name and conclusion, none while it runs, or a commit status by its context and state. */
const CheckContextSchema = Schema.Union([
  Schema.Struct({
    __typename: Schema.Literal(CHECK_KIND.CHECK_RUN),
    name: Schema.String,
    conclusion: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    __typename: Schema.Literal(CHECK_KIND.STATUS),
    context: Schema.String,
    state: Schema.String,
  }),
]);

const QueueEntrySchema = Schema.Struct({
  position: Schema.Number,
  state: Schema.String,
  enqueuedAt: Schema.DateFromString,
  estimatedTimeToMerge: Schema.NullOr(Schema.Number),
  headCommit: Schema.NullOr(
    Schema.Struct({
      statusCheckRollup: Schema.NullOr(
        Schema.Struct({
          contexts: Schema.Struct({
            totalCount: Schema.Number,
            nodes: Schema.Array(Schema.NullOr(CheckContextSchema)),
          }),
        }),
      ),
    }),
  ),
  pullRequest: Schema.NullOr(
    Schema.Struct({
      number: Schema.Number,
      title: Schema.String,
      url: Schema.String,
      author: Schema.NullOr(Schema.Struct({ login: Schema.String, avatarUrl: Schema.String })),
    }),
  ),
});

/** GitHub's answer's data: each alias's repository, null where GitHub resolved none or refused it. */
const QueuesAnswerSchema = Schema.Record(
  Schema.String,
  Schema.NullOr(
    Schema.Struct({
      mergeQueue: Schema.NullOr(
        Schema.Struct({
          url: Schema.String,
          entries: Schema.Struct({ nodes: Schema.Array(Schema.NullOr(QueueEntrySchema)) }),
        }),
      ),
    }),
  ),
);

/** The status the wire refuses a queue GitHub kept from the App's token with. */
const FORBIDDEN = 403;

/**
 * GitHub's word for an alias whose repository it could not resolve, which
 * a rename, a transfer, or a delete since the task named it leaves; any
 * other error is GitHub refusing the read.
 */
const GITHUB_NOT_FOUND = "NOT_FOUND";

/** The queues one request read, and whether GitHub refused any of what it asked. */
interface QueuesRead {
  readonly queues: readonly MergeQueueRepository[];
  readonly refused: boolean;
}

type QueueEntryRead = typeof QueueEntrySchema.Type;

/** GitHub's word for each entry state, as GraphQL spells it. */
const GITHUB_ENTRY_STATE = new Map<string, MergeQueueEntryState>([
  ["QUEUED", MERGE_QUEUE_ENTRY_STATE.QUEUED],
  ["AWAITING_CHECKS", MERGE_QUEUE_ENTRY_STATE.AWAITING_CHECKS],
  ["MERGEABLE", MERGE_QUEUE_ENTRY_STATE.MERGEABLE],
  ["UNMERGEABLE", MERGE_QUEUE_ENTRY_STATE.UNMERGEABLE],
  ["LOCKED", MERGE_QUEUE_ENTRY_STATE.LOCKED],
]);

/** The alias the request names the repository at this place under. */
function aliasAt(index: number): string {
  return `r${index}`;
}

/** One request naming every repository given, each under its alias, its owner and name passed as variables. */
function queuesRequest(repositories: readonly GitHubRepository[]) {
  const variables: Record<string, string> = {};
  const declared: string[] = [];
  const selections: string[] = [];

  for (const [index, repository] of repositories.entries()) {
    const [owner = "", name = ""] = repository.fullName.split("/");
    variables[`${aliasAt(index)}Owner`] = owner;
    variables[`${aliasAt(index)}Name`] = name;
    declared.push(`$${aliasAt(index)}Owner: String!, $${aliasAt(index)}Name: String!`);
    selections.push(
      `${aliasAt(index)}: repository(owner: $${aliasAt(index)}Owner, name: $${aliasAt(index)}Name) {
    ${QUEUE_FIELDS}
  }`,
    );
  }

  return {
    query: `query MergeQueues(${declared.join(", ")}) {\n  ${selections.join("\n  ")}\n}`,
    variables,
  };
}

/** How the checks stand on an entry's merge group; none before the queue builds one or reports any check on it. */
function checksOf(read: QueueEntryRead): MergeQueueChecks | null {
  const contexts = read.headCommit?.statusCheckRollup?.contexts;

  if (contexts === undefined || contexts.totalCount === 0) return null;

  let passed = 0;
  const failed: string[] = [];

  for (const check of contexts.nodes) {
    if (check === null) continue;

    const [name, outcome, passes, fails] =
      check.__typename === CHECK_KIND.CHECK_RUN
        ? [check.name, check.conclusion ?? "", CHECK_RUN_PASSED, CHECK_RUN_FAILED]
        : [check.context, check.state, STATUS_PASSED, STATUS_FAILED];

    if (passes.has(outcome)) passed += 1;

    if (fails.has(outcome)) failed.push(name);
  }

  return { total: contexts.totalCount, passed, failed };
}

/** One entry as the wire carries it, read at `now`, its task left for the join; none for one whose pull request GitHub did not answer. */
function entryOf(read: QueueEntryRead | null, now: number) {
  if (read === null || read.pullRequest === null) return [];

  return [
    {
      position: read.position,
      state: GITHUB_ENTRY_STATE.get(read.state) ?? MERGE_QUEUE_ENTRY_STATE.QUEUED,
      enqueuedAt: read.enqueuedAt.getTime(),
      estimatedMergeAt:
        read.estimatedTimeToMerge === null ? null : now + read.estimatedTimeToMerge * 1000,
      checks: checksOf(read),
      pullRequest: read.pullRequest,
      task: null,
    },
  ];
}

/**
 * The queues of the repositories given, read on one token in one request,
 * each repository that has one in the order given, and whether GitHub
 * refused any of it: an error but an unresolved repository, or no data at
 * all. Note that a refusal answers its alias null as a repository with no
 * queue does, so only its error tells the two apart. A refusal GitHub
 * answers past 2xx, a rate limit among them, is GitHub not answering, and
 * fails as `@repo/github` says.
 */
const readQueues = /* @__PURE__ */ Effect.fnUntraced(function* (
  bearer: GitHubBearer,
  repositories: readonly GitHubRepository[],
): Effect.fn.Return<QueuesRead, GitHubFailure> {
  const { query, variables } = queuesRequest(repositories);
  const answer = yield* bearer.client.graphqlPartial(query, variables, QueuesAnswerSchema);
  const now = yield* Clock.currentTimeMillis;

  const queues = repositories.flatMap((repository, index) => {
    const queue = answer.data?.[aliasAt(index)]?.mergeQueue;

    if (queue === null || queue === undefined) return [];

    return [
      {
        repository: repository.fullName,
        url: queue.url,
        entries: queue.entries.nodes
          .flatMap((read) => entryOf(read, now))
          .sort((a, b) => a.position - b.position),
      },
    ];
  });

  return {
    queues,
    refused:
      answer.data === undefined || answer.errors.some((error) => error.type !== GITHUB_NOT_FOUND),
  };
});

/**
 * Every pull request GitHub's merge queues hold across the repositories the
 * workspace's tasks work in, each named with the task an agent of one of
 * them opened it for. A workspace the account is not a member of is not
 * found; an account with the Merge queue experiment off is not permitted;
 * GitHub refusing a queue to the App's token is an upstream error, never
 * an empty answer that reads as no queue; a GitHub or a store the service
 * could not reach is unavailable.
 */
export const readWorkspaceMergeQueue = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  workspaceId: string,
): Effect.fn.Return<MergeQueueAnswer, HostedRefusal, WorkspaceRepositoriesServices> {
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));

  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

  if (!(yield* hostedStoreOrUnavailable(accountExperimentOn(userId, EXPERIMENT.MERGE_QUEUE)))) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  }

  const named = yield* hostedStoreOrUnavailable(
    readWorkspaceTaskRepositories(userId, workspaceId, MERGE_QUEUE_BOUNDS.MAX_REPOSITORIES),
  );

  if (named.length === 0) return { repositories: [] };
  const app = yield* GitHubApp;

  const reads = yield* githubReadOrRefusal(
    Effect.flatMap(app.repositoriesPullRequestTokens(workspaceId, named), (tokens) =>
      Effect.forEach(tokens, (held) => readQueues(held.bearer, held.repositories)),
    ),
  );

  if (reads.some((read) => read.refused)) {
    yield* Effect.logWarning("GitHub refused a merge queue read to the App's token");

    return yield* Effect.fail(upstreamRefused(FORBIDDEN));
  }

  // Note that the queues keep the order the repositories were named in, the most recently changed first.
  const order = new Map(named.map((fullName, index) => [fullName.toLowerCase(), index]));

  const repositories = reads
    .flatMap((read) => read.queues)
    .sort(
      (a, b) =>
        (order.get(a.repository.toLowerCase()) ?? 0) - (order.get(b.repository.toLowerCase()) ?? 0),
    );

  const tasks = yield* hostedStoreOrUnavailable(
    readPullRequestTasks(
      userId,
      workspaceId,
      repositories.flatMap((queue) =>
        queue.entries.map((entry) => ({
          repository: queue.repository,
          number: entry.pullRequest.number,
        })),
      ),
    ),
  );

  const byRepository = new Map<string, Map<number, (typeof tasks)[number]>>();

  for (const found of tasks) {
    const inRepository = byRepository.get(found.repository) ?? new Map();
    byRepository.set(found.repository, inRepository.set(found.number, found));
  }

  return {
    repositories: repositories.map((queue) => ({
      ...queue,
      entries: queue.entries.map((entry) => {
        const found = byRepository
          .get(queue.repository.toLowerCase())
          ?.get(entry.pullRequest.number);

        return {
          ...entry,
          task:
            found === undefined
              ? null
              : { id: found.taskId, number: found.taskNumber, name: found.taskName },
        };
      }),
    })),
  };
});
