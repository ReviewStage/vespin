/**
 * agent-repositories.ts -- the repositories an agent works in, its primary first, read as one list.
 *
 * An agent's primary repository is its own row's (`agent.repository`, its
 * start branch, its branch, and its pull request), and the repositories it
 * works in beside it are `agent_repository`'s rows, by position. Every
 * reader that must see an agent's extras reads them here, in that order,
 * and none reads the extras' table by itself: the token minted for the set
 * and `open_pull_request`. Starts no longer name extras, so only agents
 * started before then have any. An agent with no repository has none. The read is made as the
 * account the agent works for, as the agent reads itself (`agentReachableBy`),
 * so an account reads none of another's agent.
 *
 * An extra's head branch is written here too, on its own row: the branch
 * `open_pull_request` opened its pull request from. Each repository's pull
 * request is read from the pull requests the agent opened
 * (`agent_pull_request`), the one from the branch it stands on there. An
 * extra is named by its repository, matched as GitHub matches one, its case
 * aside, since an agent's repositories were each named once.
 */

import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable, type StoredPullRequest } from "../schemas/agent.js";
import { agentRepository } from "../schemas/agent-repository.js";
import {
  type AgentStoreEffect,
  PULL_REQUEST_OF_AGENT_BRANCH,
  PublishedColumnSchema,
  pullRequestOfBranch,
} from "./agent-store.js";
import { agentReachableBy } from "./workspace-store.js";

/** One repository an agent works in: `owner/name`, the branch its checkout is cloned at and its pull request opens against, its pull request's head, and that pull request as GitHub last answered. */
export interface AgentRepositoryEntry {
  readonly repository: string;
  /** None for the repository's default branch. */
  readonly baseBranch: string | null;
  /** None until a pull request opens. */
  readonly headBranch: string | null;
  /** None where it opened none from its head branch. */
  readonly pullRequest: StoredPullRequest | null;
}

const AgentRepositoryRowSchema = Schema.Struct({
  repository: Schema.NullOr(Schema.String),
  baseBranch: Schema.NullOr(Schema.String),
  headBranch: Schema.NullOr(Schema.String),
  pullRequest: Schema.NullOr(PublishedColumnSchema),
  extraPosition: Schema.NullOr(Schema.Number),
  extraRepository: Schema.NullOr(Schema.String),
  extraBaseBranch: Schema.NullOr(Schema.String),
  extraHeadBranch: Schema.NullOr(Schema.String),
  extraPullRequest: Schema.NullOr(PublishedColumnSchema),
});

/** The agent's row with each of its extras beside it, in their order: one row with no extra where it has none. */
const findAgentRepositories = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: AgentRepositoryRowSchema,
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({
          repository: agentTable.repository,
          baseBranch: agentTable.startBranch,
          headBranch: agentTable.branch,
          pullRequest: PULL_REQUEST_OF_AGENT_BRANCH,
          extraPosition: agentRepository.position,
          extraRepository: agentRepository.repository,
          extraBaseBranch: agentRepository.baseBranch,
          extraHeadBranch: agentRepository.headBranch,
          extraPullRequest: pullRequestOfBranch(
            agentTable.id,
            agentRepository.repository,
            agentRepository.headBranch,
          ),
        })
        .from(agentTable)
        .leftJoin(agentRepository, eq(agentRepository.agentId, agentTable.id))
        .where(and(eq(agentTable.id, agentId), agentReachableBy(userId)))
        .orderBy(asc(agentRepository.position)),
    ),
});

/**
 * The repositories the agent works in, as the account reaches the agent:
 * its primary, from its own row, then its extras by position; none for an
 * agent with no repository, and none where the account does not reach the
 * agent.
 */
export function readAgentRepositories(
  userId: string,
  agentId: string,
): AgentStoreEffect<readonly AgentRepositoryEntry[]> {
  return Effect.map(findAgentRepositories({ userId, agentId }), (rows) => {
    const [first] = rows;
    if (first === undefined || first.repository === null) return [];
    const primary: AgentRepositoryEntry = {
      repository: first.repository,
      baseBranch: first.baseBranch,
      headBranch: first.headBranch,
      pullRequest: first.pullRequest,
    };
    const extras = rows.flatMap((row): AgentRepositoryEntry[] =>
      row.extraRepository === null
        ? []
        : [
            {
              repository: row.extraRepository,
              baseBranch: row.extraBaseBranch,
              headBranch: row.extraHeadBranch,
              pullRequest: row.extraPullRequest,
            },
          ],
    );
    return [primary, ...extras];
  });
}

/** The condition that a row is the named extra of an agent the account reaches. */
function extraOf(userId: string, agentId: string, repository: string): SQL | undefined {
  return and(
    eq(agentRepository.agentId, agentId),
    eq(sql`lower(${agentRepository.repository})`, repository.toLowerCase()),
    inArray(
      agentRepository.agentId,
      queryBuilder
        .select({ id: agentTable.id })
        .from(agentTable)
        .where(and(eq(agentTable.id, agentId), agentReachableBy(userId))),
    ),
  );
}

const ExtraKeySchema = Schema.Struct({
  userId: Schema.String,
  agentId: Schema.String,
  repository: Schema.String,
});

const updateExtraHead = SqlSchema.void({
  Request: Schema.Struct({ ...ExtraKeySchema.fields, headBranch: Schema.String }),
  execute: ({ userId, agentId, repository, headBranch }) =>
    Database.use((db) =>
      db
        .update(agentRepository)
        .set({ headBranch })
        .where(extraOf(userId, agentId, repository)),
    ),
});

/** The head branch of the pull request the agent opened in a repository it works in beside its own, written on that repository's row; nothing written for a repository it does not work in, or an agent the account does not reach. */
export function recordAgentRepositoryHead(
  userId: string,
  agentId: string,
  repository: string,
  headBranch: string,
): AgentStoreEffect<void> {
  return updateExtraHead({ userId, agentId, repository, headBranch });
}
