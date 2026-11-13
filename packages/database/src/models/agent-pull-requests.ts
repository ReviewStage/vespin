/**
 * agent-pull-requests.ts -- every pull request a coding agent opened, written as a read of GitHub finds each and read back as one list.
 *
 * A read of what an agent published (`coder-host/published.ts`) writes each
 * pull request it found or read again, in any repository the agent works in,
 * on its own row (`agent_pull_request`), keyed by the repository as the
 * agent keeps it and the number: the first read to find one links it to the
 * agent, and every later read rewrites what GitHub answered of it. The
 * writes of one read go under the agent row's lock, so of two reads that
 * find the same merge at once only the first counts it, and a read begun
 * before another wrote a merge never writes that pull request back as open,
 * since GitHub never moves a merged pull request again. Every read is made
 * as the account the agent works for (`agentReachableBy`), so an account
 * reads and writes none of another's agent.
 */

import { PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { agentTable, type StoredPullRequest } from "../schemas/agent.js";
import { agentPullRequest } from "../schemas/agent-pull-request.js";
import { task } from "../schemas/task.js";
import { type AgentStoreEffect, newlyMerged, PublishedColumnSchema } from "./agent-store.js";
import { agentReachableBy, agentVisibleTo } from "./workspace-store.js";

/** One pull request a read of GitHub found or read again: the repository it is in as the agent keeps it, the branch it was opened from, and the pull request as GitHub answered. */
export interface AgentPullRequestRead {
  readonly repository: string;
  readonly headBranch: string;
  readonly pullRequest: StoredPullRequest;
}

/** One pull request an agent opened, as its row keeps it. */
export interface AgentPullRequestRow extends AgentPullRequestRead {
  readonly createdAt: Date;
}

const AgentPullRequestRowSchema = Schema.Struct({
  repository: Schema.String,
  headBranch: Schema.String,
  pullRequest: PublishedColumnSchema,
  createdAt: Schema.Date,
});

const AgentKeySchema = Schema.Struct({ userId: Schema.String, agentId: Schema.String });

/** One pull request by its repository, as `owner/name` in any case, and its number. */
export interface PullRequestKey {
  readonly repository: string;
  readonly number: number;
}

/** The task a pull request belongs to: the task of an agent that opened it. */
export interface PullRequestTask extends PullRequestKey {
  readonly taskId: string;
  readonly taskNumber: number;
  readonly taskName: string;
}

const PullRequestTaskSchema = Schema.Struct({
  repository: Schema.String,
  number: Schema.Number,
  taskId: Schema.String,
  taskNumber: Schema.Number,
  taskName: Schema.String,
});

/**
 * The tasks of the workspace whose agents opened a pull request of these
 * repositories under these numbers, as the account sees each agent and its
 * task (`agentVisibleTo`), each repository read lower case, the earliest
 * linked first. Note that the repositories and the numbers are matched
 * apart, so a caller keeps only the pairs it named.
 */
const findPullRequestTasks = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    workspaceId: Schema.String,
    repositories: Schema.Array(Schema.String),
    numbers: Schema.Array(Schema.Number),
  }),
  Result: PullRequestTaskSchema,
  execute: ({ userId, workspaceId, repositories, numbers }) =>
    Database.use((db) =>
      db
        .select({
          repository: sql<string>`lower(${agentPullRequest.repository})`,
          number: agentPullRequest.number,
          taskId: task.id,
          taskNumber: task.number,
          taskName: task.name,
        })
        .from(agentPullRequest)
        .innerJoin(agentTable, eq(agentTable.id, agentPullRequest.agentId))
        .innerJoin(task, eq(task.id, agentTable.taskId))
        .where(
          and(
            eq(task.organizationId, workspaceId),
            agentVisibleTo(userId),
            inArray(sql`lower(${agentPullRequest.repository})`, repositories),
            inArray(agentPullRequest.number, numbers),
          ),
        )
        .orderBy(asc(agentPullRequest.createdAt)),
    ),
});

/** The agent's row under its lock, as the account reaches the agent; none where it does not. */
const lockAgent = SqlSchema.findOneOption({
  Request: AgentKeySchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), agentReachableBy(userId)))
        .limit(1)
        .for("update", { of: agentTable }),
    ),
});

/** The agent's pull requests, newest linked first, as the account reaches the agent. */
const findAgentPullRequests = SqlSchema.findAll({
  Request: AgentKeySchema,
  Result: AgentPullRequestRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          repository: agentPullRequest.repository,
          headBranch: agentPullRequest.headBranch,
          pullRequest: agentPullRequest.pullRequest,
          createdAt: agentPullRequest.createdAt,
        })
        .from(agentPullRequest)
        .innerJoin(agentTable, eq(agentTable.id, agentPullRequest.agentId))
        .where(and(eq(agentPullRequest.agentId, agentId), agentReachableBy(userId)))
        .orderBy(desc(agentPullRequest.createdAt), desc(agentPullRequest.number)),
    ),
});

/** One pull request linked to its agent, or what GitHub answered of it written again. */
const upsertAgentPullRequest = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    repository: Schema.String,
    headBranch: Schema.String,
    pullRequest: PublishedColumnSchema,
  }),
  execute: ({ agentId, repository, headBranch, pullRequest }) =>
    Database.use((db) =>
      db
        .insert(agentPullRequest)
        .values({ agentId, repository, number: pullRequest.number, headBranch, pullRequest })
        .onConflictDoUpdate({
          target: [agentPullRequest.agentId, agentPullRequest.repository, agentPullRequest.number],
          set: {
            headBranch: sql`excluded.head_branch`,
            pullRequest: sql`excluded.pull_request`,
          },
        }),
    ),
});

/** Whether a row stands for the pull request a read names: the same number in the same repository, its case aside. */
function sameAs(row: AgentPullRequestRead, read: AgentPullRequestRead): boolean {
  return (
    row.pullRequest.number === read.pullRequest.number &&
    row.repository.toLowerCase() === read.repository.toLowerCase()
  );
}

/** The agent's pull requests, newest linked first; none for an agent the account does not reach. */
export function readAgentPullRequests(
  userId: string,
  agentId: string,
): AgentStoreEffect<readonly AgentPullRequestRow[]> {
  return findAgentPullRequests({ userId, agentId });
}

/**
 * The task each pull request named belongs to in the workspace, through the
 * pull requests its agents opened, as the account sees the agent and its
 * task; a pull request no agent of a task the account sees opened is left
 * out, and one opened from agents of several tasks answers the task that
 * linked it first. Each answer names the repository lower case.
 */
export function readPullRequestTasks(
  userId: string,
  workspaceId: string,
  pulls: readonly PullRequestKey[],
): AgentStoreEffect<readonly PullRequestTask[]> {
  if (pulls.length === 0) return Effect.succeed([]);

  // Note that pulls are keyed by repository and then number, each its own key, never one spelled of both.
  const named = new Map<string, Set<number>>();

  for (const pull of pulls) {
    const repository = pull.repository.toLowerCase();
    named.set(repository, (named.get(repository) ?? new Set()).add(pull.number));
  }

  return Effect.map(
    findPullRequestTasks({
      userId,
      workspaceId,
      repositories: [...named.keys()],
      numbers: [...new Set(pulls.map((pull) => pull.number))],
    }),
    (rows) => {
      const found = new Map<string, Map<number, PullRequestTask>>();

      for (const row of rows) {
        const inRepository = found.get(row.repository) ?? new Map<number, PullRequestTask>();

        if (named.get(row.repository)?.has(row.number) !== true || inRepository.has(row.number)) {
          continue;
        }

        found.set(row.repository, inRepository.set(row.number, row));
      }

      return [...found.values()].flatMap((inRepository) => [...inRepository.values()]);
    },
  );
}

/**
 * The pull requests one read of GitHub found or read again, each linked to
 * the agent where it was not yet and written as GitHub answered, under the
 * agent row's lock; nothing written for an agent the account does not reach.
 * A pull request the row keeps merged is left as it stands. Answers how many
 * merges this write is the first to keep.
 */
export function recordAgentPullRequests(
  userId: string,
  agentId: string,
  reads: readonly AgentPullRequestRead[],
): AgentStoreEffect<number> {
  if (reads.length === 0) return Effect.succeed(0);

  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        if (Option.isNone(yield* lockAgent({ userId, agentId }))) return 0;
        const kept = yield* findAgentPullRequests({ userId, agentId });
        let firstMerged = 0;

        for (const read of reads) {
          const before = kept.find((row) => sameAs(row, read));

          // Note that a merged pull request never moves again, so a read begun before its merge was written keeps it.
          if (before?.pullRequest.state === PULL_REQUEST_STATE.MERGED) continue;

          if (newlyMerged(before?.pullRequest ?? null, read.pullRequest)) firstMerged += 1;
          yield* upsertAgentPullRequest({
            agentId,
            repository: before?.repository ?? read.repository,
            headBranch: read.headBranch,
            pullRequest: read.pullRequest,
          });
        }

        return firstMerged;
      }),
    ),
  );
}
