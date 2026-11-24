/**
 * agent-followers.ts -- one Manager's followers, bound: its two statements, the tables they read, the topics that wake it, and who it admits.
 *
 * The statements read what `listAgentFollowers` reads: the owner of an agent
 * on no task that the account reaches (`agentReachableBy`, which for an
 * agent on no task is `agentVisibleTo`), while they are a member of its
 * workspace, and every other follower who still is, with their switch. The
 * account's membership of the agent's workspace is joined, so a member taken
 * out of it stops hearing the followers at once rather than at the next
 * seal. They read no clock, as a live read must (`live-statement.ts`).
 *
 * It is woken by a follow, an unfollow, or a switch, and by the agent's own
 * row, all of which name the agent, and by the account's membership, which
 * names the account. Note that a follower who leaves the workspace names
 * neither, so they drop out at the read's next look.
 */

import { queryBuilder } from "@repo/database/core/query";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import { agentReachableBy } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { agentFollower } from "@repo/database/schemas/agent-follower";
import { member } from "@repo/database/schemas/auth";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentFollowerSync,
  agentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
} from "@repo/database/sync/tables";
import { AGENT_FOLLOWERS_READ } from "@repo/features/agent-followers-live";
import { and, eq, exists, isNull, ne, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

/** The membership a follower or the owner holds in the agent's workspace, beside the reader's own. */
const theirs = alias(member, "their_member");

/** The condition that the account the column names is a member of the agent's workspace. */
function memberOfAgentWorkspace(userId: typeof agentTable.userId | typeof agentFollower.userId) {
  return exists(
    queryBuilder
      .select({ one: theirs.id })
      .from(theirs)
      .where(and(eq(theirs.userId, userId), eq(theirs.organizationId, agentTable.organizationId))),
  );
}

/** The agent on no task under this id, where the account reaches it as a member of its workspace. */
function reachedAgent(userId: string, agentId: string): SQL | undefined {
  return and(eq(agentTable.id, agentId), isNull(agentTable.taskId), agentReachableBy(userId));
}

/** The reader's own membership of the agent's workspace, joined. */
function readerJoin(userId: string) {
  return and(eq(member.organizationId, agentTable.organizationId), eq(member.userId, userId));
}

/** The agent's owner, while a member of its workspace. */
function ownerStatement(userId: string, agentId: string) {
  return liveRowsStatement(
    AGENT_FOLLOWERS_READ.parts.owner,
    { columns: { userId: agentTable.userId }, instants: { startedAt: agentTable.createdAt } },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(agentTable)
        .innerJoin(member, readerJoin(userId))
        .where(and(reachedAgent(userId, agentId), memberOfAgentWorkspace(agentTable.userId))),
  );
}

/** Every follower of the agent but its owner, while a member of its workspace, with their switch. */
function followersStatement(userId: string, agentId: string) {
  return liveRowsStatement(
    AGENT_FOLLOWERS_READ.parts.followers,
    {
      columns: { userId: agentFollower.userId, machines: agentFollower.machines },
      instants: { followedAt: agentFollower.createdAt },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(agentFollower)
        .innerJoin(agentTable, eq(agentTable.id, agentFollower.agentId))
        .innerJoin(member, readerJoin(userId))
        .where(
          and(
            reachedAgent(userId, agentId),
            ne(agentFollower.userId, agentTable.userId),
            memberOfAgentWorkspace(agentFollower.userId),
          ),
        ),
  );
}

export const agentFollowersRead = bindLiveRead(AGENT_FOLLOWERS_READ, {
  reads: [
    agentFollowerSync,
    agentSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, id }) => [
    [TOPIC.AGENT, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id }) => ({
    owner: ownerStatement(userId, id),
    followers: followersStatement(userId, id),
  }),
  admit: ({ userId, id }) =>
    Effect.flatMap(hostedStoreOrUnavailable(readVisibleAgent(userId, id)), (agent) =>
      Option.isSome(agent) && agent.value.taskId === null
        ? Effect.void
        : Effect.fail(HOSTED_REFUSAL.NOT_FOUND),
    ),
});
