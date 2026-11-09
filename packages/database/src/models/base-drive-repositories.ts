/**
 * base-drive-repositories.ts -- every workspace's repository a base drive may stand for, read across accounts for the scheduled refresh alone.
 *
 * A base drive is filled for a workspace's repository by a cloud agent
 * started on its default branch on the workspace's installation
 * (`packages/service/src/agents/base-drive.ts`), and nothing records that it
 * was. So the scheduled refresh reads each workspace and repository such an
 * agent was ever started in, once, the repository matched as GitHub matches
 * one, its case aside, with the account of the newest such agent, whose
 * firewall the refill's sandbox writes under. Whether the drive stands is the
 * sandbox provider's to say.
 */

import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import type { AgentStoreEffect } from "./agent-store.js";

const BaseDriveRepositorySchema = Schema.Struct({
  workspaceId: Schema.String,
  /** `owner/name` as the newest such agent's row holds it. */
  repository: Schema.String,
  userId: Schema.String,
});

/** A workspace's repository a base drive may stand for, and the account of the newest agent that may have filled it. */
export type BaseDriveRepository = typeof BaseDriveRepositorySchema.Type;

const findBaseDriveRepositories = SqlSchema.findAll({
  Request: Schema.Void,
  Result: BaseDriveRepositorySchema,
  execute: () =>
    Database.use((db) =>
      db
        .selectDistinctOn([agentTable.organizationId, sql`lower(${agentTable.repository})`], {
          workspaceId: agentTable.organizationId,
          repository: sql<string>`${agentTable.repository}`,
          userId: agentTable.userId,
        })
        .from(agentTable)
        .where(
          and(
            isNotNull(agentTable.repository),
            isNull(agentTable.startBranch),
            eq(agentTable.machine, AGENT_MACHINE.VERCEL),
            eq(agentTable.githubAccess, GITHUB_ACCESS.APP),
          ),
        )
        .orderBy(
          agentTable.organizationId,
          sql`lower(${agentTable.repository})`,
          desc(agentTable.createdAt),
        ),
    ),
});

/** Every workspace's repository a base drive may stand for, of every account, for the scheduled refresh alone. */
export function listBaseDriveRepositories(): AgentStoreEffect<readonly BaseDriveRepository[]> {
  return findBaseDriveRepositories(undefined);
}
