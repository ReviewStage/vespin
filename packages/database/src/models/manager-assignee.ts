/**
 * manager-assignee.ts -- who a Manager's agent works for, read for its pull request: its task's assignee, where that is another member than the Manager's owner.
 *
 * An agent a Manager started opens its pull request as the person its task
 * is for, its assignee (`packages/service/src/agents/coder-host/pull-request.ts`).
 * Nothing is read for an agent no Manager of its own account started, for
 * a task with no assignee, for an assignee who is the Manager's owner, whose
 * pull requests open as they always did, or for an assignee no longer a
 * member of the agent's workspace, so taking someone out of the workspace
 * stops their account being used at once.
 *
 * Note that a Manager's start is already the asker's account (`turnAsker`),
 * so this reads something only for an agent of the Manager's owner: one
 * started in a turn the owner asked for or no member asked for, such as a
 * wakeup's, or one started before Managers acted for whoever asked.
 */

import { AGENT_KIND } from "@repo/features/agent-wire";
import { and, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { type Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { member, user } from "../schemas/auth.js";
import { task } from "../schemas/task.js";
import type { AgentStoreEffect } from "./agent-store.js";
import { agentReachableBy } from "./workspace-store.js";

const manager = alias(agentTable, "manager");

const findManagerAssignee = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String }),
  Result: Schema.Struct({ userId: Schema.String, name: Schema.String }),
  execute: ({ userId, agentId }) =>
    Database.use((db) =>
      db
        .select({ userId: user.id, name: user.name })
        .from(agentTable)
        .innerJoin(
          manager,
          and(
            eq(manager.id, agentTable.startedByAgentId),
            eq(manager.userId, agentTable.userId),
            eq(manager.kind, AGENT_KIND.MANAGER),
          ),
        )
        .innerJoin(task, eq(task.id, agentTable.taskId))
        .innerJoin(user, eq(user.id, task.assigneeId))
        .innerJoin(
          member,
          and(
            eq(member.organizationId, agentTable.organizationId),
            eq(member.userId, task.assigneeId),
          ),
        )
        .where(
          and(
            eq(agentTable.id, agentId),
            eq(agentTable.userId, userId),
            agentReachableBy(userId),
            ne(task.assigneeId, agentTable.userId),
          ),
        )
        .limit(1),
    ),
});

/** The member a Manager's agent works for, by id and name. */
export interface ManagerAssignee {
  readonly userId: string;
  readonly name: string;
}

/**
 * The assignee of the account's agent's task, where a Manager of the
 * account's started the agent and the task is assigned to another member of
 * its workspace; nothing otherwise, and nothing for an agent the account
 * does not own.
 */
export function managerAssigneeOf(
  userId: string,
  agentId: string,
): AgentStoreEffect<Option.Option<ManagerAssignee>> {
  return findManagerAssignee({ userId, agentId });
}
