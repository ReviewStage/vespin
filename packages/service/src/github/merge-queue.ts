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
 * out rather than failing the rest. Each entry's pull request is joined to
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
  type MergeQueueEntryState,
  type MergeQueueRepository,
} from "@repo/features/merge-queue-wire";
import { EXPERIMENT } from "@repo/settings";
import { Effect, type Redacted, Schema } from "effect";
import type { HttpClient } from "effect/http";
import type { GitHubRepository } from "../core.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { GitHubApp, type GitHubUnavailable, githubPost, readBody, send } from "./github-app.js";
import { githubReadOrRefusal } from "./github-refusal.js";
import type { WorkspaceRepositoriesServices } from "./workspace-repositories.js";

/** The fields read of one queue, after the alias naming its repository. */
const QUEUE_FIELDS = `mergeQueue {
      url
      entries(first: ${MERGE_QUEUE_BOUNDS.MAX_ENTRIES}) {
        nodes {
          position
          state
          enqueuedAt
          pullRequest { number title url author { login avatarUrl } }
        }
      }
    }`;

const QueueEntrySchema = Schema.Struct({
  position: Schema.Number,
  state: Schema.String,
  enqueuedAt: Schema.DateFromString,
  pullRequest: Schema.NullOr(
    Schema.Struct({
      number: Schema.Number,
      title: Schema.String,
      url: Schema.String,
      author: Schema.NullOr(Schema.Struct({ login: Schema.String, avatarUrl: Schema.String })),
    }),
  ),
});

const QueuesAnswerSchema = Schema.Struct({
  data: Schema.NullOr(
    Schema.Record(
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
    ),
  ),
});

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

/** One entry as the wire carries it, its task left for the join; none for one whose pull request GitHub did not answer. */
function entryOf(read: QueueEntryRead | null) {
  if (read === null || read.pullRequest === null) return [];

  return [
    {
      position: read.position,
      state: GITHUB_ENTRY_STATE.get(read.state) ?? MERGE_QUEUE_ENTRY_STATE.QUEUED,
      enqueuedAt: read.enqueuedAt.getTime(),
      pullRequest: read.pullRequest,
      task: null,
    },
  ];
}

/** The queues of the repositories given, read on one token in one request, each repository that has one in the order given. */
const readQueues = /* @__PURE__ */ Effect.fnUntraced(function* (
  token: Redacted.Redacted,
  repositories: readonly GitHubRepository[],
): Effect.fn.Return<MergeQueueRepository[], GitHubUnavailable, HttpClient.HttpClient> {
  const answer = yield* Effect.scoped(
    Effect.flatMap(send(githubPost("/graphql", token, queuesRequest(repositories))), (response) =>
      readBody(response, QueuesAnswerSchema),
    ),
  );

  return repositories.flatMap((repository, index) => {
    const queue = answer.data?.[aliasAt(index)]?.mergeQueue;

    if (queue === null || queue === undefined) return [];

    return [
      {
        repository: repository.fullName,
        url: queue.url,
        entries: queue.entries.nodes.flatMap(entryOf).sort((a, b) => a.position - b.position),
      },
    ];
  });
});

/**
 * Every pull request GitHub's merge queues hold across the repositories the
 * workspace's tasks work in, each named with the task an agent of one of
 * them opened it for. A workspace the account is not a member of is not
 * found; an account with the Merge queue experiment off is not permitted;
 * a GitHub or a store the service could not reach is unavailable.
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

  const queues = yield* githubReadOrRefusal(
    Effect.flatMap(app.repositoriesPullRequestTokens(workspaceId, named), (tokens) =>
      Effect.forEach(tokens, (held) => readQueues(held.token, held.repositories)),
    ),
  );

  // Note that the queues keep the order the repositories were named in, the most recently changed first.
  const order = new Map(named.map((fullName, index) => [fullName.toLowerCase(), index]));
  const repositories = queues
    .flat()
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
